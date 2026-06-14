import type Database from 'better-sqlite3';
import type { Context } from 'hono';
import { checkFallbackError } from '../accounts/errorRules.js';
import { clearExpiredModelLocks, getModelLock, setModelLock } from '../accounts/locks.js';
import { selectAccount } from '../accounts/selection.js';
import { isModelLockActive } from '../accounts/state.js';
import type { AccountState, SelectionMode } from '../accounts/types.js';
import { augmentRequest } from '../cache-injection.js';
import { consoleBus } from '../console/bus.js';
import {
  buildAccount,
  buildDone,
  buildError,
  buildStart,
  buildTransport,
  buildTransportFail,
  genReqId,
} from '../console/flow.js';
import { disableAccount, listEnabledAccounts, updateAccount } from '../db/repos/accounts.js';
import { getCombo } from '../db/repos/combos.js';
import { insertRequestLogDeferred } from '../db/repos/requestLogs.js';
import { getAllSettings, getSetting } from '../db/repos/settings.js';
import { resolveModel } from '../providers/alias.js';
import { getUpstreamFormat } from '../providers/format/negotiate.js';
import {
  bodyAddsOpenAIStreamUsage,
  bodyAnthropicToOpenAI,
  bodyOpenAIToAnthropic,
  responseAnthropicToOpenAI,
  responseOpenAIToAnthropic,
} from '../providers/format/transform.js';
import { PROVIDER, upstreamHeaders, upstreamUrl } from '../providers/minimax.js';
import { parseError } from '../providers/parseError.js';
import { calculateCost } from '../providers/pricing.js';
import { upstreamFetch } from '../providers/upstreamFetch.js';
import { compressMessages, formatRtkLog, rtkBytesSaved } from '../rtk/index.js';
import { markHotPath } from '../runtime/hotPathMetrics.js';
import { pipeWithUsage } from '../streaming/pipeWithUsage.js';
import { getProxyFailureMode, resolveTransportForAccount } from '../transport/resolve.js';
import { log } from '../util/log.js';
import { headersToJson, truncateBody } from './capture.js';
import { handleCodeBuddyProxy } from './codebuddy.js';
import { handleComboProxy } from './combo.js';
import { errorMessage, safeJsonParse, statusCode, stringValue } from './helpers.js';
import { type CursorRef, handleKiroProxy } from './kiro.js';

export async function handleProxy(
  c: Context,
  format: 'openai' | 'anthropic',
  upstreamPath: string,
  rrCursorRef: { value: number },
  stickyMap: Map<number, string>,
  db: Database.Database
): Promise<Response> {
  markHotPath('proxy:start');
  const clientKey = c.get('clientKey');
  const text = await c.req.text();
  if (text.length > 10 * 1024 * 1024) {
    return c.json({ error: 'request body exceeds 10MB limit' }, 413);
  }
  let body: Record<string, unknown> = {};
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch (e: unknown) {
      return c.json({ error: `invalid JSON: ${errorMessage(e)}` }, 400);
    }
  }
  let bodyDirty = false;
  markHotPath('proxy:body-parsed');
  const allSettings = getAllSettings(db);

  // Combo/fallback chain: if the requested model matches a combo name, handle
  // it via the combo fallback loop (try each model in sequence).
  const comboName = stringValue(body.model);
  const combo = getCombo(db, comboName);
  if (combo) {
    const comboCursorRef: CursorRef = { value: rrCursorRef.value };
    const comboResp = await handleComboProxy(
      c,
      format,
      upstreamPath,
      body,
      text,
      db,
      combo,
      comboCursorRef,
      stickyMap
    );
    rrCursorRef.value = comboCursorRef.value;
    return comboResp;
  }

  // Provider routing: if the requested model belongs to a non-MiniMax provider,
  // branch to that provider's path. Unknown models fall through to the MiniMax
  // path, which surfaces the canonical 400 from resolveModel below.
  try {
    const peek = resolveModel(db, stringValue(body.model), body);
    if (peek.provider === 'kiro') {
      const kiroCursorRef: CursorRef = { value: rrCursorRef.value };
      const kiroResp = await handleKiroProxy(
        c,
        format,
        upstreamPath,
        body,
        db,
        kiroCursorRef,
        stickyMap
      );
      rrCursorRef.value = kiroCursorRef.value;
      return kiroResp;
    }
    if (peek.provider === 'codebuddy') {
      const cbCursorRef: CursorRef = { value: rrCursorRef.value };
      const cbResp = await handleCodeBuddyProxy(
        c,
        format,
        upstreamPath,
        body,
        db,
        cbCursorRef,
        stickyMap
      );
      rrCursorRef.value = cbCursorRef.value;
      return cbResp;
    }
  } catch {
    /* unknown model — defer to the MiniMax path for the canonical error */
  }

  const caveman = allSettings.caveman as { level: string } | undefined;
  const caching = allSettings.caching as
    | { autoBreakpoints: boolean; respectCallerMarkers: boolean }
    | undefined;
  const rtkSetting = allSettings.rtk as { enabled: boolean } | undefined;
  const minimax = allSettings.minimax as { upstreamFormat?: string } | undefined;
  const cavemanOn = !!caveman?.level && caveman.level !== 'off';
  const cachingOn = !!caching?.autoBreakpoints;
  if (cavemanOn || cachingOn) {
    await augmentRequest(body, allSettings as Parameters<typeof augmentRequest>[1]);
    bodyDirty = true;
  }

  let rtkSaved = 0;
  if (rtkSetting?.enabled) {
    const stats = compressMessages(body, true);
    rtkSaved = rtkBytesSaved(stats);
    const rtkLog = formatRtkLog(stats);
    if (rtkLog) console.log(rtkLog);
    // compressMessages mutates messages in-place (even when it ultimately returns
    // null), so any rtk-enabled request may have a changed body — mark dirty.
    bodyDirty = true;
  }

  // Determine upstream format. Default = same as client. Override via
  // settings.minimax.upstreamFormat or ROUTER_UPSTREAM_FORMAT env.
  const overrideRaw = minimax?.upstreamFormat ?? process.env.ROUTER_UPSTREAM_FORMAT ?? 'auto';
  const upstreamFormat = getUpstreamFormat(format, overrideRaw as 'auto' | 'openai' | 'anthropic');

  // OpenAI streaming: ensure include_usage so the final chunk carries usage.
  // bodyAddsOpenAIStreamUsage returns a NEW object (only when stream===true and
  // include_usage not already set); capture it and mark dirty so the fast path
  // re-serializes the injected body.
  if (upstreamFormat === 'openai') {
    const withUsage = bodyAddsOpenAIStreamUsage(body);
    if (withUsage !== body) {
      Object.assign(body, withUsage);
      bodyDirty = true;
    }
  }

  // Cross-format body conversion (only when client != upstream).
  if (format !== upstreamFormat) {
    if (format === 'openai' && upstreamFormat === 'anthropic') {
      Object.assign(body, bodyOpenAIToAnthropic(body));
    } else if (format === 'anthropic' && upstreamFormat === 'openai') {
      Object.assign(body, bodyAnthropicToOpenAI(body));
    }
    bodyDirty = true;
  }

  // Pool: ALL enabled MiniMax accounts (shared across all client keys).
  const allAccounts = listEnabledAccounts(db);
  if (allAccounts.length === 0) {
    return c.json({ error: 'no upstream accounts configured' }, 503);
  }
  const accountStates: AccountState[] = allAccounts.map((a) => ({
    id: a.id,
    backoffLevel: a.backoff_level,
    rateLimitedUntil: a.rate_limited_until,
    lastError: a.last_error ? (safeJsonParse(a.last_error) as AccountState['lastError']) : null,
    status: a.status as AccountState['status'],
    enabled: !!a.enabled,
  }));
  const sel = getSetting<{ mode: SelectionMode; step?: number }>(db, 'selection.minimax') ?? {
    mode: 'lowest-backoff' as SelectionMode,
    step: 1,
  };
  const { account, reason, nextCursor } = selectAccount(accountStates, {
    mode: sel.mode,
    step: sel.step ?? 1,
    cursor: rrCursorRef.value,
    clientKeyId: clientKey?.id,
    stickyMap,
  });
  if (nextCursor != null) rrCursorRef.value = nextCursor;
  if (!account) return c.json({ error: 'all accounts unavailable' }, 503);
  const acc = allAccounts.find((a) => a.id === account.id)!;
  markHotPath('proxy:account-selected');

  let resolved;
  try {
    resolved = resolveModel(db, stringValue(body.model), body);
    const origModel = body.model;
    // NOTE: this snapshot must list EVERY field resolved.bodyTransform may write.
    // bodyTransform currently writes: thinking, max_completion_tokens, reasoning_split.
    // If you add a field there, add it here too or the fast path will skip re-serialization.
    const beforeThinking = body.thinking;
    const beforeMaxCT = body.max_completion_tokens;
    const beforeReasoning = body.reasoning_split;
    body.model = resolved.upstreamModel;
    resolved.bodyTransform(body);
    if (
      body.model !== origModel ||
      body.thinking !== beforeThinking ||
      body.max_completion_tokens !== beforeMaxCT ||
      body.reasoning_split !== beforeReasoning
    ) {
      bodyDirty = true;
    }
  } catch (e: unknown) {
    return c.json({ error: errorMessage(e) }, 400);
  }
  const requestedModel = resolved.requestedModel;
  markHotPath('proxy:model-resolved');

  const reqId = genReqId();
  c.set('reqId', reqId);
  consoleBus.emit(
    buildStart(
      reqId,
      new Date().toISOString(),
      c.req.method,
      upstreamPath,
      resolved.upstreamModel,
      requestedModel && requestedModel !== resolved.upstreamModel ? requestedModel : null
    )
  );
  consoleBus.emit(buildAccount(reqId, new Date().toISOString(), acc.label, reason));

  clearExpiredModelLocks(db);
  if (isModelLockActive(getModelLock(db, account.id, resolved.upstreamModel))) {
    return c.json({ error: `model ${resolved.upstreamModel} temporarily locked` }, 429);
  }

  const url = upstreamUrl(
    { provider: PROVIDER, apiKey: acc.api_key, baseUrl: acc.base_url },
    upstreamFormat,
    upstreamPath
  );
  const headers = upstreamHeaders(
    { provider: PROVIDER, apiKey: acc.api_key, baseUrl: acc.base_url },
    body.stream === true,
    upstreamFormat
  );
  const transport = resolveTransportForAccount(db, acc);
  markHotPath('proxy:transport-resolved');
  if (transport) {
    if (transport.relay) {
      consoleBus.emit(
        buildTransport(reqId, new Date().toISOString(), 'relay', transport.relay.url)
      );
    } else if (transport.proxy) {
      consoleBus.emit(
        buildTransport(reqId, new Date().toISOString(), 'proxy', transport.proxy.url)
      );
    }
  }

  const proxyOpts = {
    failureMode: getProxyFailureMode(db),
    onProxyFailure: (message: string, fellBack: boolean) =>
      consoleBus.emit(buildTransportFail(reqId, new Date().toISOString(), fellBack, message)),
  };

  try {
    const upstreamBody = bodyDirty ? body : text || '{}';
    markHotPath('proxy:upstream-fetch-start');
    const resp = await upstreamFetch(url, upstreamBody, headers, transport, proxyOpts);
    markHotPath('proxy:upstream-fetch-response');
    if (!resp.ok) {
      const errBody = await resp.text();
      const parsed = parseError(resp, errBody);
      const decision = checkFallbackError(
        resp.status,
        parsed.message,
        parsed.baseRespCode,
        acc.backoff_level,
        parsed.windowResetMs,
        parsed.retryAfterSec ? parsed.retryAfterSec * 1000 : undefined
      );
      const rateLimitedUntil =
        decision.cooldownMs > 0 ? new Date(Date.now() + decision.cooldownMs).toISOString() : null;
      updateAccount(db, account.id, {
        rate_limited_until: rateLimitedUntil,
        backoff_level: decision.newBackoffLevel ?? 0,
        last_error: JSON.stringify({
          status: resp.status,
          message: errBody.slice(0, 500),
          timestamp: new Date().toISOString(),
          baseRespCode: parsed.baseRespCode,
        }),
        status: resp.status === 401 ? 'error' : 'active',
      });
      if (decision.cooldownMs > 0) {
        setModelLock(db, account.id, resolved.upstreamModel, decision.cooldownMs);
      }
      if (decision.source === 'balance') {
        disableAccount(db, account.id);
      }
      consoleBus.emit(
        buildError(reqId, new Date().toISOString(), resp.status, errBody.slice(0, 200))
      );
      return c.body(errBody, statusCode(resp.status), {
        'content-type': resp.headers.get('content-type') ?? 'application/json',
      });
    }
    if (
      acc.backoff_level !== 0 ||
      acc.status !== 'active' ||
      acc.rate_limited_until !== null ||
      acc.last_error !== null
    ) {
      updateAccount(db, account.id, {
        rate_limited_until: null,
        backoff_level: 0,
        last_error: null,
        status: 'active',
      });
    }

    if (body.stream === true) {
      const startMs = c.get('startTime');
      const clientKeyId = clientKey.id;
      const accountId = account.id;
      const modelName = stringValue(body.model);
      const piped = await pipeWithUsage(resp, format, (usage, raw) => {
        const prompt = usage?.prompt_tokens ?? 0;
        const completion = usage?.completion_tokens ?? 0;
        const cacheCreate = usage?.cache_creation_tokens ?? 0;
        const cacheRead = usage?.cache_read_tokens ?? 0;
        const total = usage?.total_tokens ?? prompt + completion;
        const cost = calculateCost(db, modelName, {
          prompt_tokens: prompt,
          completion_tokens: completion,
          cache_creation_tokens: cacheCreate,
          cache_read_tokens: cacheRead,
        });
        insertRequestLogDeferred(db, {
          client_key_id: clientKeyId,
          account_id: accountId,
          model: modelName,
          requested_model: requestedModel,
          endpoint: upstreamPath,
          format: upstreamFormat,
          prompt_tokens: prompt,
          completion_tokens: completion,
          cache_creation_tokens: cacheCreate,
          cache_read_tokens: cacheRead,
          total_tokens: total,
          cost_usd: cost,
          latency_ms: Date.now() - startMs,
          status_code: resp.status,
          base_resp_code: undefined,
          stream: 1,
          rtk_bytes_saved: rtkSaved,
          request_body: truncateBody(text),
          response_body: truncateBody(raw),
          request_headers: headersToJson(c.req.raw.headers),
          response_headers: headersToJson(resp.headers),
          req_id: reqId,
        });
        consoleBus.emit(
          buildDone(
            reqId,
            new Date().toISOString(),
            resp.status,
            null,
            prompt,
            completion,
            cacheRead,
            cost,
            Date.now() - startMs,
            rtkSaved
          )
        );
      });
      return piped;
    }

    let respBody = await resp.text();
    let usage: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cache_creation_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    } = {};
    try {
      // Parse once, reuse for both cross-format conversion (if needed) and
      // usage extraction. Avoids a second JSON.parse on the same body.
      const parsed = JSON.parse(respBody) as { usage?: typeof usage } & Record<string, unknown>;
      if (format !== upstreamFormat) {
        const converted =
          upstreamFormat === 'anthropic'
            ? responseAnthropicToOpenAI(parsed as Parameters<typeof responseAnthropicToOpenAI>[0])
            : responseOpenAIToAnthropic(parsed as Parameters<typeof responseOpenAIToAnthropic>[0]);
        respBody = JSON.stringify(converted);
        const convUsage = (converted as { usage?: typeof usage }).usage;
        usage = convUsage ?? parsed.usage ?? {};
      } else {
        usage = parsed.usage ?? {};
      }
    } catch {
      /* non-JSON or malformed; pass through */
    }
    const cost = calculateCost(db, stringValue(body.model), {
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      cache_creation_tokens: usage.cache_creation_tokens ?? 0,
      cache_read_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    });
    insertRequestLogDeferred(db, {
      client_key_id: clientKey.id,
      account_id: account.id,
      model: stringValue(body.model),
      requested_model: requestedModel,
      endpoint: upstreamPath,
      format: upstreamFormat,
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      cache_creation_tokens: usage.cache_creation_tokens ?? 0,
      cache_read_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
      cost_usd: cost,
      latency_ms: Date.now() - c.get('startTime'),
      status_code: resp.status,
      base_resp_code: undefined,
      stream: 0,
      rtk_bytes_saved: rtkSaved,
      request_body: truncateBody(text),
      response_body: truncateBody(respBody),
      request_headers: headersToJson(c.req.raw.headers),
      response_headers: headersToJson(resp.headers),
      req_id: reqId,
    });
    consoleBus.emit(
      buildDone(
        reqId,
        new Date().toISOString(),
        resp.status,
        null,
        usage.prompt_tokens ?? 0,
        usage.completion_tokens ?? 0,
        usage.prompt_tokens_details?.cached_tokens ?? 0,
        cost,
        Date.now() - c.get('startTime'),
        rtkSaved
      )
    );
    return c.body(respBody, statusCode(resp.status), {
      'content-type': resp.headers.get('content-type') ?? 'application/json',
    });
  } catch (e: unknown) {
    const message = errorMessage(e);
    log.error({ err: message }, 'upstream unreachable');
    const rid = c.get('reqId') ?? '----';
    consoleBus.emit(buildError(rid, new Date().toISOString(), 502, message));
    return c.json({ error: `upstream unreachable: ${message}` }, 502);
  }
}
