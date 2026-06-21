import type Database from 'better-sqlite3';
import type { Context } from 'hono';
import { checkFallbackError } from '../accounts/errorRules.js';
import { clearExpiredModelLocks, getModelLock, setModelLock } from '../accounts/locks.js';
import { selectAccount } from '../accounts/selection.js';
import { isModelLockActive } from '../accounts/state.js';
import type { SelectionMode } from '../accounts/types.js';
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
import {
  disableAccount,
  listEnabledAccountsByProvider,
  updateAccount,
} from '../db/repos/accounts.js';
import { getCombo } from '../db/repos/combos.js';
import { insertRequestLogDeferred } from '../db/repos/requestLogs.js';
import { getAllSettings, getSettingT } from '../db/repos/settings.js';
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
import { getUpstreamFormat as getUpstreamFormatEnv } from '../util/env.js';
import { log } from '../util/log.js';
import { handleCodeBuddyProxy } from './codebuddy.js';
import { handleComboProxy } from './combo.js';
import { errorMessage, statusCode, stringValue } from './helpers.js';
import { type CursorRef, handleKiroProxy } from './kiro.js';
import { handleNotionProxy } from './notion.js';
import { handlePioneerProxy } from './pioneer.js';
import type { Db } from './pipeline.js';
import { applyErrorState, buildAccountStates, buildLogRow, clearErrorState } from './pipeline.js';
import { handleZaiProxy } from './zai.js';

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
  // Hoist reqId to the very top so every downstream emit (buildStart,
  // buildAccount, buildError) and the outer catch share one stable id —
  // matches kiro/codebuddy/pioneer/combo ordering and guarantees the catch
  // never falls back to '----' if an early throw escapes a nested try.
  const reqId = genReqId();
  c.set('reqId', reqId);
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
    if (peek.provider === 'pioneer') {
      const pioCursorRef: CursorRef = { value: rrCursorRef.value };
      const pioResp = await handlePioneerProxy(
        c,
        format,
        upstreamPath,
        body,
        db,
        pioCursorRef,
        stickyMap
      );
      rrCursorRef.value = pioCursorRef.value;
      return pioResp;
    }
    if (peek.provider === 'notion') {
      const notionCursorRef: CursorRef = { value: rrCursorRef.value };
      const notionResp = await handleNotionProxy(
        c,
        format,
        upstreamPath,
        body,
        db,
        notionCursorRef,
        stickyMap
      );
      rrCursorRef.value = notionCursorRef.value;
      return notionResp;
    }
    if (peek.provider === 'zai') {
      const zaiCursorRef: CursorRef = { value: rrCursorRef.value };
      const zaiResp = await handleZaiProxy(
        c,
        format,
        upstreamPath,
        body,
        db,
        zaiCursorRef,
        stickyMap
      );
      rrCursorRef.value = zaiCursorRef.value;
      return zaiResp;
    }
  } catch {
    /* unknown model — defer to the MiniMax path for the canonical error */
  }

  const caveman = allSettings.caveman as { level: string } | undefined;
  const caching = allSettings.caching as
    | { autoBreakpoints: boolean; respectCallerMarkers: boolean }
    | undefined;
  const rtkSetting = allSettings.rtk as { enabled: boolean } | undefined;
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
    if (rtkLog) log.info({ rtkLog }, rtkLog);
    // compressMessages mutates messages in-place (even when it ultimately returns
    // null), so any rtk-enabled request may have a changed body — mark dirty.
    bodyDirty = true;
  }
  // Determine upstream format. Default = same as client. Override via
  // settings.minimax.upstreamFormat (first), ROUTER_UPSTREAM_FORMAT env (fallback).
  const upstreamFormat = getUpstreamFormat(format, getUpstreamFormatEnv(db));

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

  // Pool: only MiniMax accounts. The previous `listEnabledAccounts` returned
  // every provider's rows, so a sticky-pinned Pioneer/Kiro account could be
  // selected here and a MiniMax request sent upstream with a foreign key.
  const allAccounts = listEnabledAccountsByProvider(db, 'minimax');
  if (allAccounts.length === 0) {
    return c.json({ error: 'no minimax accounts configured' }, 503);
  }
  const accountStates = buildAccountStates(allAccounts);
  const sel = getSettingT(db, 'selection.minimax') ?? {
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

  // Emit buildStart AFTER model resolution (so it carries the resolved
  // upstream model, not a placeholder). minimax selects the account before
  // resolving the model (unlike kiro), so buildAccount also fires here —
  // both need reqId, which is now hoisted to the top. The key invariant vs.
  // the old code: buildStart no longer lives after a gap where reqId could
  // be unset if resolveModel threw; resolveModel's own throw returns early
  // with a 400 and never reaches this emit.
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
  const stateDb: Db = { updateAccount: (id, patch) => updateAccount(db, id, patch) };

  try {
    const upstreamBody = bodyDirty ? body : text || '{}';
    markHotPath('proxy:upstream-fetch-start');
    const resp = await upstreamFetch(
      url,
      upstreamBody,
      headers,
      transport,
      proxyOpts,
      c.req.raw.signal
    );
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
      applyErrorState(stateDb, account, decision, errBody, {
        status: resp.status,
        baseRespCode: parsed.baseRespCode,
      });
      if (decision.cooldownMs > 0)
        setModelLock(db, account.id, resolved.upstreamModel, decision.cooldownMs);
      if (decision.source === 'balance') disableAccount(db, account.id);
      consoleBus.emit(
        buildError(reqId, new Date().toISOString(), resp.status, errBody.slice(0, 200))
      );
      // Parity with CodeBuddy/Pioneer/Notion: log the failed request so it
      // surfaces in the Request log. Tokens/cost are 0 — it's an error.
      // biome-ignore format: long line
      insertRequestLogDeferred(db, buildLogRow({ clientKeyId: clientKey.id, accountId: account.id, model: resolved.upstreamModel, requestedModel, endpoint: upstreamPath, format: upstreamFormat, promptTokens: 0, completionTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, costUsd: 0, latencyMs: Date.now() - c.get('startTime'), statusCode: resp.status, baseRespCode: parsed.baseRespCode, stream: body.stream === true ? 1 : 0, rtkBytesSaved: rtkSaved, requestBody: text, responseBody: errBody, requestHeaders: c.req.raw.headers, responseHeaders: resp.headers, reqId }));
      return c.body(errBody, statusCode(resp.status), {
        'content-type': resp.headers.get('content-type') ?? 'application/json',
      });
    }
    clearErrorState(stateDb, account);

    if (body.stream === true) {
      const startMs = c.get('startTime');
      const modelName = stringValue(body.model);
      const piped = await pipeWithUsage(
        resp,
        format,
        (usage, raw) => {
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
          // biome-ignore format: long line
          insertRequestLogDeferred(db, buildLogRow({ clientKeyId: clientKey.id, accountId: account.id, model: modelName, requestedModel, endpoint: upstreamPath, format: upstreamFormat, promptTokens: prompt, completionTokens: completion, cacheCreationTokens: cacheCreate, cacheReadTokens: cacheRead, totalTokens: total, costUsd: cost, latencyMs: Date.now() - startMs, statusCode: resp.status, baseRespCode: undefined, stream: 1, rtkBytesSaved: rtkSaved, requestBody: text, responseBody: raw, requestHeaders: c.req.raw.headers, responseHeaders: resp.headers, reqId }));
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
        },
        c.req.raw.signal
      );
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
    insertRequestLogDeferred(
      db,
      buildLogRow({
        clientKeyId: clientKey.id,
        accountId: account.id,
        model: stringValue(body.model),
        requestedModel,
        endpoint: upstreamPath,
        format: upstreamFormat,
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
        cacheCreationTokens: usage.cache_creation_tokens ?? 0,
        cacheReadTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        totalTokens: usage.total_tokens ?? 0,
        costUsd: cost,
        latencyMs: Date.now() - c.get('startTime'),
        statusCode: resp.status,
        baseRespCode: undefined,
        stream: 0,
        rtkBytesSaved: rtkSaved,
        requestBody: text,
        responseBody: respBody,
        requestHeaders: c.req.raw.headers,
        responseHeaders: resp.headers,
        reqId,
      })
    );
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
    // reqId is hoisted to the top of handleProxy, so it is always in scope here.
    consoleBus.emit(buildError(reqId, new Date().toISOString(), 502, message));
    // transport throw (DNS/refused/timeout) previously wrote no request_log row.
    // Log zeros + 502 so the failure is observable.
    insertRequestLogDeferred(
      db,
      buildLogRow({
        clientKeyId: clientKey.id,
        accountId: account.id,
        model: resolved.upstreamModel,
        requestedModel,
        endpoint: upstreamPath,
        format: upstreamFormat,
        promptTokens: 0,
        completionTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        latencyMs: Date.now() - c.get('startTime'),
        statusCode: 502,
        baseRespCode: undefined,
        stream: body.stream === true ? 1 : 0,
        rtkBytesSaved: rtkSaved,
        requestBody: text,
        responseBody: message,
        requestHeaders: c.req.raw.headers,
        responseHeaders: new Headers(),
        reqId,
      })
    );
    return c.json({ error: `upstream unreachable: ${message}` }, 502);
  }
}
