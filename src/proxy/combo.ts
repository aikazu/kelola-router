import type Database from 'better-sqlite3';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { checkFallbackError } from '../accounts/errorRules.js';
import { clearExpiredModelLocks, getModelLock, setModelLock } from '../accounts/locks.js';
import { selectAccount } from '../accounts/selection.js';
import { isModelLockActive } from '../accounts/state.js';
import type { AccountState, SelectionMode } from '../accounts/types.js';
import { consoleBus } from '../console/bus.js';
import {
  buildAccount,
  buildDone,
  buildError,
  buildStart,
  buildTransportFail,
  genReqId,
} from '../console/flow.js';
import { disableAccount, listEnabledAccounts, updateAccount } from '../db/repos/accounts.js';
import type { Combo } from '../db/repos/combos.js';
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
import { compressMessages, rtkBytesSaved } from '../rtk/index.js';
import { pipeWithUsage } from '../streaming/pipeWithUsage.js';
import { getProxyFailureMode, resolveTransportForAccount } from '../transport/resolve.js';
import { log } from '../util/log.js';
import { headersToJson, truncateBody } from './capture.js';
import { type CursorRef, handleKiroProxy } from './kiro.js';

// Tiny helpers duplicated here to avoid a circular import with server.ts.
// server.ts imports handleComboProxy from this file; if this file imported from
// server.ts, the ESM loader would see a cycle that can break at runtime.
function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function statusCode(value: number): ContentfulStatusCode {
  return value as ContentfulStatusCode;
}

export async function handleComboProxy(
  c: Context,
  format: 'openai' | 'anthropic',
  upstreamPath: string,
  body: Record<string, unknown>,
  originalText: string,
  db: Database.Database,
  combo: Combo,
  cursorRef: CursorRef,
  stickyMap: Map<number, string>
): Promise<Response> {
  const clientKey = c.get('clientKey');
  const startMs = c.get('startTime');
  const allSettings = getAllSettings(db);
  const minimax = allSettings.minimax as { upstreamFormat?: string } | undefined;
  const overrideRaw = minimax?.upstreamFormat ?? process.env.ROUTER_UPSTREAM_FORMAT ?? 'auto';
  const upstreamFormat = getUpstreamFormat(format, overrideRaw as 'auto' | 'openai' | 'anthropic');

  const reqId = genReqId();
  c.set('reqId', reqId);
  consoleBus.emit(
    buildStart(
      reqId,
      new Date().toISOString(),
      c.req.method,
      upstreamPath,
      `combo:${combo.name}`,
      combo.name
    )
  );

  // Augment body (caveman, caching, rtk) just like handleProxy does.
  const caveman = allSettings.caveman as { level: string } | undefined;
  const caching = allSettings.caching as
    | { autoBreakpoints: boolean; respectCallerMarkers: boolean }
    | undefined;
  const rtkSetting = allSettings.rtk as { enabled: boolean } | undefined;
  const cavemanOn = !!caveman?.level && caveman.level !== 'off';
  const cachingOn = !!caching?.autoBreakpoints;
  if (cavemanOn || cachingOn) {
    const { augmentRequest } = await import('../cache-injection.js');
    await augmentRequest(body, allSettings as Parameters<typeof augmentRequest>[1]);
  }
  let rtkSaved = 0;
  if (rtkSetting?.enabled) {
    rtkSaved = rtkBytesSaved(compressMessages(body, true));
  }

  // OpenAI streaming: ensure include_usage
  if (upstreamFormat === 'openai') {
    const withUsage = bodyAddsOpenAIStreamUsage(body);
    if (withUsage !== body) {
      Object.assign(body, withUsage);
    }
  }

  // Cross-format body conversion
  if (format !== upstreamFormat) {
    if (format === 'openai' && upstreamFormat === 'anthropic') {
      Object.assign(body, bodyOpenAIToAnthropic(body));
    } else if (format === 'anthropic' && upstreamFormat === 'openai') {
      Object.assign(body, bodyAnthropicToOpenAI(body));
    }
  }

  // Pre-check: ada akun tersedia
  if (listEnabledAccounts(db).length === 0) {
    return c.json({ error: 'no upstream accounts configured' }, 503);
  }

  // Selection mode dibaca sekali — tidak berubah per iterasi
  const sel = getSetting<{ mode: SelectionMode; step?: number }>(db, 'selection.minimax') ?? {
    mode: 'lowest-backoff' as SelectionMode,
    step: 1,
  };

  let lastErrorResponse: Response | null = null;

  for (let i = 0; i < combo.models.length; i++) {
    const modelName = combo.models[i]!;

    // Re-select account each iteration so recently-backoffed accounts are skipped
    const allAccounts = listEnabledAccounts(db);
    const accountStates: AccountState[] = allAccounts.map((a) => ({
      id: a.id,
      backoffLevel: a.backoff_level,
      rateLimitedUntil: a.rate_limited_until,
      lastError: a.last_error ? (safeJsonParse(a.last_error) as AccountState['lastError']) : null,
      status: a.status as AccountState['status'],
      enabled: !!a.enabled,
    }));
    const { account, reason, nextCursor } = selectAccount(accountStates, {
      mode: sel.mode,
      step: sel.step ?? 1,
      cursor: cursorRef.value,
      clientKeyId: clientKey?.id,
      stickyMap,
    });
    if (nextCursor != null) cursorRef.value = nextCursor;
    if (!account) {
      log.warn(
        { combo: combo.name, model: modelName },
        'combo: no accounts available for this model, trying next'
      );
      continue;
    }
    const acc = allAccounts.find((a) => a.id === account.id)!;
    if (i === 0) {
      consoleBus.emit(buildAccount(reqId, new Date().toISOString(), acc.label, reason));
    }
    let resolved;
    try {
      resolved = resolveModel(db, modelName, body);
    } catch {
      // Model not found/disabled — skip to next in chain
      log.warn({ combo: combo.name, model: modelName }, 'combo: model not resolvable, skipping');
      continue;
    }

    // Apply model body transform
    const attemptBody = { ...body };
    attemptBody.model = resolved.upstreamModel;
    resolved.bodyTransform(attemptBody);

    // Check model lock
    clearExpiredModelLocks(db);
    if (isModelLockActive(getModelLock(db, account.id, resolved.upstreamModel))) {
      log.info({ combo: combo.name, model: modelName }, 'combo: model locked, trying next');
      continue;
    }

    // Kiro provider: delegate to handleKiroProxy for this model
    if (resolved.provider === 'kiro') {
      try {
        const kiroBody = { ...body, model: modelName };
        const kiroCursorRef: CursorRef = { value: cursorRef.value };
        const kiroResp = await handleKiroProxy(
          c,
          format,
          upstreamPath,
          kiroBody,
          db,
          kiroCursorRef,
          stickyMap
        );
        cursorRef.value = kiroCursorRef.value;
        // If we get here without throw, check status
        if (
          kiroResp.status === 429 ||
          kiroResp.status === 502 ||
          kiroResp.status === 503 ||
          kiroResp.status === 504 ||
          kiroResp.status === 401 ||
          kiroResp.status === 402 ||
          kiroResp.status === 403
        ) {
          log.info(
            { combo: combo.name, model: modelName, status: kiroResp.status },
            'combo: kiro retryable error, trying next model'
          );
          lastErrorResponse = kiroResp;
          continue;
        }
        // Success or non-retryable error
        log.info({ combo: combo.name, model: modelName, index: i }, 'combo: kiro success on model');
        return kiroResp;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.warn(
          { combo: combo.name, model: modelName, error: msg },
          'combo: kiro model failed, trying next'
        );
        lastErrorResponse = c.json({ error: msg }, 502);
        continue;
      }
    }

    const url = upstreamUrl(
      { provider: PROVIDER, apiKey: acc.api_key, baseUrl: acc.base_url },
      upstreamFormat,
      upstreamPath
    );
    const headers = upstreamHeaders(
      { provider: PROVIDER, apiKey: acc.api_key, baseUrl: acc.base_url },
      attemptBody.stream === true,
      upstreamFormat
    );
    const transport = resolveTransportForAccount(db, acc);
    const proxyOpts = {
      failureMode: getProxyFailureMode(db),
      onProxyFailure: (message: string, fellBack: boolean) =>
        consoleBus.emit(buildTransportFail(reqId, new Date().toISOString(), fellBack, message)),
    };

    try {
      const upstreamBody = JSON.stringify(attemptBody);
      const resp = await upstreamFetch(url, upstreamBody, headers, transport, proxyOpts);

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

        // Apply account error state
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

        // Retry on 429 (rate limit), retryable 5xx (502, 503, 504), and auth/payment errors (401, 402, 403).
        const isRetryable =
          resp.status === 429 ||
          resp.status === 502 ||
          resp.status === 503 ||
          resp.status === 504 ||
          resp.status === 401 ||
          resp.status === 402 ||
          resp.status === 403;
        if (isRetryable) {
          log.info(
            { combo: combo.name, model: modelName, status: resp.status },
            'combo: retryable error, trying next model'
          );
          lastErrorResponse = c.body(errBody, statusCode(resp.status), {
            'content-type': resp.headers.get('content-type') ?? 'application/json',
          });
          continue;
        }

        // Non-retryable error — return immediately
        consoleBus.emit(
          buildError(reqId, new Date().toISOString(), resp.status, errBody.slice(0, 200))
        );
        return c.body(errBody, statusCode(resp.status), {
          'content-type': resp.headers.get('content-type') ?? 'application/json',
        });
      }

      // Success! Clear account errors.
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

      log.info({ combo: combo.name, model: modelName, index: i }, 'combo: success on model');

      // Handle streaming response
      if (attemptBody.stream === true) {
        const piped = await pipeWithUsage(resp, format, (usage, raw) => {
          const prompt = usage?.prompt_tokens ?? 0;
          const completion = usage?.completion_tokens ?? 0;
          const cacheCreate = usage?.cache_creation_tokens ?? 0;
          const cacheRead = usage?.cache_read_tokens ?? 0;
          const total = usage?.total_tokens ?? prompt + completion;
          const cost = calculateCost(db, resolved.upstreamModel, {
            prompt_tokens: prompt,
            completion_tokens: completion,
            cache_creation_tokens: cacheCreate,
            cache_read_tokens: cacheRead,
          });
          insertRequestLogDeferred(db, {
            client_key_id: clientKey.id,
            account_id: account.id,
            model: resolved.upstreamModel,
            requested_model: combo.name,
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
            request_body: truncateBody(originalText),
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

      // Handle buffered response
      let respBody = await resp.text();
      let usage: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        cache_creation_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      } = {};
      try {
        const parsedResp = JSON.parse(respBody) as { usage?: typeof usage } & Record<
          string,
          unknown
        >;
        if (format !== upstreamFormat) {
          const converted =
            upstreamFormat === 'anthropic'
              ? responseAnthropicToOpenAI(
                  parsedResp as Parameters<typeof responseAnthropicToOpenAI>[0]
                )
              : responseOpenAIToAnthropic(
                  parsedResp as Parameters<typeof responseOpenAIToAnthropic>[0]
                );
          respBody = JSON.stringify(converted);
          const convUsage = (converted as { usage?: typeof usage }).usage;
          usage = convUsage ?? parsedResp.usage ?? {};
        } else {
          usage = parsedResp.usage ?? {};
        }
      } catch {
        /* non-JSON; pass through */
      }
      const cost = calculateCost(db, resolved.upstreamModel, {
        prompt_tokens: usage.prompt_tokens ?? 0,
        completion_tokens: usage.completion_tokens ?? 0,
        cache_creation_tokens: usage.cache_creation_tokens ?? 0,
        cache_read_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
      });
      insertRequestLogDeferred(db, {
        client_key_id: clientKey.id,
        account_id: account.id,
        model: resolved.upstreamModel,
        requested_model: combo.name,
        endpoint: upstreamPath,
        format: upstreamFormat,
        prompt_tokens: usage.prompt_tokens ?? 0,
        completion_tokens: usage.completion_tokens ?? 0,
        cache_creation_tokens: usage.cache_creation_tokens ?? 0,
        cache_read_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        total_tokens: usage.total_tokens ?? 0,
        cost_usd: cost,
        latency_ms: Date.now() - startMs,
        status_code: resp.status,
        base_resp_code: undefined,
        stream: 0,
        rtk_bytes_saved: rtkSaved,
        request_body: truncateBody(originalText),
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
          Date.now() - startMs,
          rtkSaved
        )
      );
      return c.body(respBody, statusCode(resp.status), {
        'content-type': resp.headers.get('content-type') ?? 'application/json',
      });
    } catch (e: unknown) {
      const message = errorMessage(e);
      log.warn({ combo: combo.name, model: modelName, err: message }, 'combo: upstream error');
      lastErrorResponse = c.json({ error: `upstream unreachable: ${message}` }, 502);
    }
  }

  // All models in the combo exhausted
  consoleBus.emit(buildError(reqId, new Date().toISOString(), 429, 'combo: all models exhausted'));
  if (lastErrorResponse) return lastErrorResponse;
  return c.json({ error: `combo ${combo.name}: all models exhausted` }, 429);
}
