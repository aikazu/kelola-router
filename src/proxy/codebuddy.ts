import type Database from 'better-sqlite3';
import type { Context } from 'hono';
import { checkFallbackError } from '../accounts/errorRules.js';
import { selectAccount } from '../accounts/selection.js';
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
import { listEnabledAccountsByProvider, updateAccount } from '../db/repos/accounts.js';
import { insertRequestLogDeferred } from '../db/repos/requestLogs.js';
import { getSetting } from '../db/repos/settings.js';
import { executeCodeBuddy } from '../providers/codebuddy/index.js';
import { calculateCost } from '../providers/pricing.js';
import { pipeWithUsage } from '../streaming/pipeWithUsage.js';
import { getProxyFailureMode, resolveTransportForAccount } from '../transport/resolve.js';
import { log } from '../util/log.js';
import { headersToJson, truncateBody } from './capture.js';
import { errorMessage, safeJsonParse, statusCode, stringValue } from './helpers.js';
import type { CursorRef } from './kiro.js';

/**
 * Handle a CodeBuddy provider request. Pure Anthropic SSE passthrough:
 * client sends Anthropic Messages → we inject defaults → forward to
 * CodeBuddy /v2/chat/completions → pipe response back unchanged.
 */
export async function handleCodeBuddyProxy(
  c: Context,
  _format: 'openai' | 'anthropic',
  upstreamPath: string,
  body: Record<string, unknown>,
  db: Database.Database,
  cursorRef: CursorRef,
  stickyMap: Map<number, string>
): Promise<Response> {
  const clientKey = c.get('clientKey');
  const startMs = c.get('startTime');

  const reqId = genReqId();
  c.set('reqId', reqId);
  consoleBus.emit(
    buildStart(reqId, new Date().toISOString(), c.req.method, upstreamPath, 'codebuddy', 'codebuddy')
  );

  // Get CodeBuddy accounts
  const allAccounts = listEnabledAccountsByProvider(db, 'codebuddy');
  if (allAccounts.length === 0) {
    consoleBus.emit(buildError(reqId, new Date().toISOString(), 503, 'no codebuddy accounts'));
    return c.json({ error: { message: 'No active CodeBuddy accounts available' } }, 503);
  }

  // Account selection (round-robin)
  const sel = getSetting<{ mode: SelectionMode; step?: number }>(db, 'selection.codebuddy') ?? {
    mode: 'round-robin' as SelectionMode,
    step: 1,
  };
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
    consoleBus.emit(buildError(reqId, new Date().toISOString(), 503, 'no available codebuddy account'));
    return c.json({ error: { message: 'All CodeBuddy accounts exhausted' } }, 503);
  }

  const acc = allAccounts.find((a) => a.id === account.id)!;
  consoleBus.emit(buildAccount(reqId, new Date().toISOString(), acc.label, reason));

  // Parse provider_data for per-account overrides (e.g. chat_endpoint)
  let providerData: Record<string, unknown> = {};
  if (acc.provider_data) {
    try { providerData = JSON.parse(acc.provider_data); } catch { /* ignore */ }
  }

  // Resolve transport (proxy pool for residential proxy)
  const transport = resolveTransportForAccount(db, acc);
  const proxyOpts = {
    failureMode: getProxyFailureMode(db),
    onProxyFailure: (message: string, fellBack: boolean) =>
      consoleBus.emit(buildTransportFail(reqId, new Date().toISOString(), fellBack, message)),
  };

  const originalText = JSON.stringify(body);

  try {
    const resp = await executeCodeBuddy({
      body,
      account: {
        api_key: acc.api_key,
        base_url: acc.base_url,
        chat_endpoint: (providerData.chat_endpoint as string) || null,
      },
      transport,
      proxyOpts,
      skipModelStrip: !!providerData.skip_model_strip,
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      const parsed = { message: errBody.slice(0, 500), baseRespCode: undefined, windowResetMs: undefined, retryAfterSec: undefined };

      // Try parse CodeBuddy error format: {"error":{"data":{"code":N,"msg":"..."}}}
      try {
        const errJson = JSON.parse(errBody);
        if (errJson?.error?.data?.msg) {
          parsed.message = errJson.error.data.msg;
        } else if (errJson?.error?.message) {
          parsed.message = errJson.error.message;
        }
      } catch { /* non-JSON error */ }

      const decision = checkFallbackError(
        resp.status,
        parsed.message,
        parsed.baseRespCode,
        acc.backoff_level,
        parsed.windowResetMs,
        parsed.retryAfterSec ? parsed.retryAfterSec * 1000 : undefined
      );

      // Update account error state
      const rateLimitedUntil =
        decision.cooldownMs > 0 ? new Date(Date.now() + decision.cooldownMs).toISOString() : null;
      updateAccount(db, account.id, {
        rate_limited_until: rateLimitedUntil,
        backoff_level: decision.newBackoffLevel ?? 0,
        last_error: JSON.stringify({
          status: resp.status,
          message: parsed.message.slice(0, 500),
          timestamp: new Date().toISOString(),
        }),
        status: resp.status === 401 ? 'error' : 'active',
      });

      consoleBus.emit(buildError(reqId, new Date().toISOString(), resp.status, parsed.message.slice(0, 200)));
      insertRequestLogDeferred(db, {
        client_key_id: clientKey.id,
        account_id: account.id,
        model: stringValue(body.model) || 'codebuddy/claude-opus-4.6',
        requested_model: stringValue(body.model) || 'codebuddy/claude-opus-4.6',
        endpoint: upstreamPath,
        format: 'anthropic',
        prompt_tokens: 0,
        completion_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        total_tokens: 0,
        cost_usd: 0,
        latency_ms: Date.now() - startMs,
        status_code: resp.status,
        base_resp_code: undefined,
        stream: body.stream ? 1 : 0,
        rtk_bytes_saved: 0,
        request_body: truncateBody(originalText),
        response_body: truncateBody(errBody),
        request_headers: headersToJson(c.req.raw.headers),
        response_headers: headersToJson(resp.headers),
        req_id: reqId,
      });

      return c.body(errBody, statusCode(resp.status), {
        'content-type': resp.headers.get('content-type') ?? 'application/json',
      });
    }

    // Success — clear account errors
    if (acc.backoff_level !== 0 || acc.status !== 'active' || acc.rate_limited_until !== null || acc.last_error !== null) {
      updateAccount(db, account.id, {
        rate_limited_until: null,
        backoff_level: 0,
        last_error: null,
        status: 'active',
      });
    }

    // Streaming passthrough — zero conversion
    if (body.stream === true) {
      const piped = await pipeWithUsage(resp, 'anthropic', (usage, raw) => {
        const prompt = usage?.prompt_tokens ?? 0;
        const completion = usage?.completion_tokens ?? 0;
        const cacheCreate = usage?.cache_creation_tokens ?? 0;
        const cacheRead = usage?.cache_read_tokens ?? 0;
        const total = usage?.total_tokens ?? prompt + completion;
        const model = stringValue(body.model) || 'codebuddy/claude-opus-4.6';
        const cost = calculateCost(db, model, {
          prompt_tokens: prompt,
          completion_tokens: completion,
          cache_creation_tokens: cacheCreate,
          cache_read_tokens: cacheRead,
        });
        insertRequestLogDeferred(db, {
          client_key_id: clientKey.id,
          account_id: account.id,
          model,
          requested_model: model,
          endpoint: upstreamPath,
          format: 'anthropic',
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
          rtk_bytes_saved: 0,
          request_body: truncateBody(originalText),
          response_body: truncateBody(raw),
          request_headers: headersToJson(c.req.raw.headers),
          response_headers: headersToJson(resp.headers),
          req_id: reqId,
        });
        consoleBus.emit(
          buildDone(reqId, new Date().toISOString(), resp.status, null, prompt, completion, cacheRead, cost, Date.now() - startMs, 0)
        );
      });
      return piped;
    }

    // Non-stream passthrough
    let respBody = await resp.text();
    let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cache_creation_tokens?: number; input_tokens?: number; output_tokens?: number } = {};
    try {
      const parsed = JSON.parse(respBody);
      // CodeBuddy Anthropic format uses input_tokens/output_tokens
      if (parsed.usage) {
        usage = {
          prompt_tokens: parsed.usage.input_tokens ?? parsed.usage.prompt_tokens ?? 0,
          completion_tokens: parsed.usage.output_tokens ?? parsed.usage.completion_tokens ?? 0,
          total_tokens: (parsed.usage.input_tokens ?? 0) + (parsed.usage.output_tokens ?? 0),
        };
      }
    } catch { /* non-JSON; pass through */ }

    const model = stringValue(body.model) || 'codebuddy/claude-opus-4.6';
    const cost = calculateCost(db, model, {
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      cache_creation_tokens: usage.cache_creation_tokens ?? 0,
      cache_read_tokens: 0,
    });
    insertRequestLogDeferred(db, {
      client_key_id: clientKey.id,
      account_id: account.id,
      model,
      requested_model: model,
      endpoint: upstreamPath,
      format: 'anthropic',
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      cache_creation_tokens: usage.cache_creation_tokens ?? 0,
      cache_read_tokens: 0,
      total_tokens: usage.total_tokens ?? 0,
      cost_usd: cost,
      latency_ms: Date.now() - startMs,
      status_code: resp.status,
      base_resp_code: undefined,
      stream: 0,
      rtk_bytes_saved: 0,
      request_body: truncateBody(originalText),
      response_body: truncateBody(respBody),
      request_headers: headersToJson(c.req.raw.headers),
      response_headers: headersToJson(resp.headers),
      req_id: reqId,
    });
    consoleBus.emit(
      buildDone(reqId, new Date().toISOString(), resp.status, null, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0, 0, cost, Date.now() - startMs, 0)
    );
    return c.body(respBody, statusCode(resp.status), {
      'content-type': resp.headers.get('content-type') ?? 'application/json',
    });
  } catch (e: unknown) {
    const message = errorMessage(e);
    log.warn({ provider: 'codebuddy', err: message }, 'codebuddy: upstream error');
    consoleBus.emit(buildError(reqId, new Date().toISOString(), 502, message));
    return c.json({ error: { message: `upstream unreachable: ${message}` } }, 502);
  }
}
