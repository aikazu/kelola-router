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
import {
  aggregateOpenAISSE,
  openaiSSEToAnthropicSSE,
} from '../providers/codebuddy/streamConvert.js';
import { responseOpenAIToAnthropic } from '../providers/format/transform.js';
import { calculateCost } from '../providers/pricing.js';
import { pipeWithUsage } from '../streaming/pipeWithUsage.js';
import { getProxyFailureMode, resolveTransportForAccount } from '../transport/resolve.js';
import { log } from '../util/log.js';
import { headersToJson, truncateBody } from './capture.js';
import { errorMessage, safeJsonParse, statusCode, stringValue } from './helpers.js';
import type { CursorRef } from './kiro.js';

/**
 * Handle a CodeBuddy provider request. Bridges the client's format to the
 * upstream OpenAI-SSE stream and converts back to the client's requested format:
 *   - anthropic + stream  → OpenAI upstream SSE converted to Anthropic Messages SSE
 *   - openai   + stream  → OpenAI upstream SSE passed through with usage tee
 *   - anthropic + non-stream → aggregate upstream SSE, convert to Anthropic response
 *   - openai   + non-stream → aggregate upstream SSE, return OpenAI response
 */
export async function handleCodeBuddyProxy(
  c: Context,
  format: 'openai' | 'anthropic',
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
    buildStart(
      reqId,
      new Date().toISOString(),
      c.req.method,
      upstreamPath,
      'codebuddy',
      'codebuddy'
    )
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
    consoleBus.emit(
      buildError(reqId, new Date().toISOString(), 503, 'no available codebuddy account')
    );
    return c.json({ error: { message: 'All CodeBuddy accounts exhausted' } }, 503);
  }

  const acc = allAccounts.find((a) => a.id === account.id)!;
  consoleBus.emit(buildAccount(reqId, new Date().toISOString(), acc.label, reason));

  // Parse provider_data for per-account overrides (e.g. chat_endpoint)
  let providerData: Record<string, unknown> = {};
  if (acc.provider_data) {
    try {
      providerData = JSON.parse(acc.provider_data);
    } catch {
      /* ignore */
    }
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
      clientFormat: format,
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      const parsed = {
        message: errBody.slice(0, 500),
        baseRespCode: undefined,
        windowResetMs: undefined,
        retryAfterSec: undefined,
      };

      // Try parse CodeBuddy error format: {"error":{"data":{"code":N,"msg":"..."}}}
      try {
        const errJson = JSON.parse(errBody);
        if (errJson?.error?.data?.msg) {
          parsed.message = errJson.error.data.msg;
        } else if (errJson?.error?.message) {
          parsed.message = errJson.error.message;
        }
      } catch {
        /* non-JSON error */
      }

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

      consoleBus.emit(
        buildError(reqId, new Date().toISOString(), resp.status, parsed.message.slice(0, 200))
      );
      insertRequestLogDeferred(db, {
        client_key_id: clientKey.id,
        account_id: account.id,
        model: stringValue(body.model) || 'cb/claude-opus-4.6',
        requested_model: stringValue(body.model) || 'cb/claude-opus-4.6',
        endpoint: upstreamPath,
        format,
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

    // Dispatch based on client format and streaming preference
    const clientWantsStream = body.stream === true;
    const model = stringValue(body.model) || 'cb/claude-opus-4.6';

    const logUsage = (
      prompt: number,
      completion: number,
      cacheRead: number,
      isStream: boolean,
      rawResp: string
    ): void => {
      const cost = calculateCost(db, model, {
        prompt_tokens: prompt,
        completion_tokens: completion,
        cache_creation_tokens: 0,
        cache_read_tokens: cacheRead,
      });
      insertRequestLogDeferred(db, {
        client_key_id: clientKey.id,
        account_id: account.id,
        model,
        requested_model: model,
        endpoint: upstreamPath,
        format,
        prompt_tokens: prompt,
        completion_tokens: completion,
        cache_creation_tokens: 0,
        cache_read_tokens: cacheRead,
        total_tokens: prompt + completion,
        cost_usd: cost,
        latency_ms: Date.now() - startMs,
        status_code: resp.status,
        base_resp_code: undefined,
        stream: isStream ? 1 : 0,
        rtk_bytes_saved: 0,
        request_body: truncateBody(originalText),
        response_body: truncateBody(rawResp),
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
          0
        )
      );
    };

    if (clientWantsStream) {
      if (format === 'anthropic') {
        return openaiSSEToAnthropicSSE(resp, model, (u) =>
          logUsage(u.prompt_tokens, u.completion_tokens, u.cache_read, true, '[anthropic-sse]')
        );
      }
      // openai client: passthrough OpenAI SSE, tee usage
      return pipeWithUsage(resp, 'openai', (usage, raw) =>
        logUsage(
          usage?.prompt_tokens ?? 0,
          usage?.completion_tokens ?? 0,
          usage?.cache_read_tokens ?? 0,
          true,
          raw
        )
      );
    }

    // Non-stream client: aggregate the forced upstream stream.
    const aggregated = await aggregateOpenAISSE(resp);
    const u = aggregated.usage;
    logUsage(
      u?.prompt_tokens ?? 0,
      u?.completion_tokens ?? 0,
      u?.prompt_tokens_details?.cached_tokens ?? 0,
      false,
      JSON.stringify(aggregated).slice(0, 2000)
    );
    if (format === 'anthropic') {
      return c.json(responseOpenAIToAnthropic(aggregated));
    }
    return c.json(aggregated);
  } catch (e: unknown) {
    const message = errorMessage(e);
    log.warn({ provider: 'codebuddy', err: message }, 'codebuddy: upstream error');
    consoleBus.emit(buildError(reqId, new Date().toISOString(), 502, message));
    return c.json({ error: { message: `upstream unreachable: ${message}` } }, 502);
  }
}
