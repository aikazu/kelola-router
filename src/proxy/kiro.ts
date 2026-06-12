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
  buildTransport,
  buildTransportFail,
  genReqId,
} from '../console/flow.js';
import { listEnabledAccountsByProvider, updateAccount } from '../db/repos/accounts.js';
import { insertRequestLogDeferred } from '../db/repos/requestLogs.js';
import { getSetting } from '../db/repos/settings.js';
import { resolveModel } from '../providers/alias.js';
import { bodyAnthropicToOpenAI, responseOpenAIToAnthropic } from '../providers/format/transform.js';
import { kiroResponseToAnthropicSSE } from '../providers/kiro/anthropicSse.js';
import { kiroResponseToOpenAISSE } from '../providers/kiro/assembler.js';
import { executeKiro } from '../providers/kiro/index.js';
import { calculateCost } from '../providers/pricing.js';
import { pipeWithUsage } from '../streaming/pipeWithUsage.js';
import { getProxyFailureMode, resolveTransportForAccount } from '../transport/resolve.js';
import { log } from '../util/log.js';
import { headersToJson, truncateBody } from './capture.js';
import { errorMessage, safeJsonParse, statusCode, stringValue } from './helpers.js';

/**
 * Mutable cursor ref passed in from server.ts so that account round-robin
 * state (rrCursor) stays in server.ts while this module can update it.
 * Using a ref object avoids a circular import (server.ts → kiro.ts → server.ts).
 */
export interface CursorRef {
  value: number;
}

export async function handleKiroProxy(
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

  // Kiro speaks OpenAI internally. Convert an Anthropic client body to OpenAI
  // first; the response is converted back below.
  const openaiBody = format === 'anthropic' ? { ...body, ...bodyAnthropicToOpenAI(body) } : body;
  const clientWantsStream = openaiBody.stream === true;
  // Kiro streams natively in both client formats now: OpenAI SSE chunks for
  // openai clients, Anthropic Messages SSE for anthropic clients (Claude Code /
  // hermes-agent). Only fall back to buffered when the client did not ask to
  // stream.
  const upstreamStream = clientWantsStream;

  let resolved: ReturnType<typeof resolveModel>;
  try {
    resolved = resolveModel(db, stringValue(body.model), body);
  } catch (e: unknown) {
    return c.json({ error: errorMessage(e) }, 400);
  }
  const requestedModel = resolved.requestedModel;
  const modelName = resolved.upstreamModel;

  const reqId = genReqId();
  c.set('reqId', reqId);
  consoleBus.emit(
    buildStart(
      reqId,
      new Date().toISOString(),
      c.req.method,
      upstreamPath,
      modelName,
      requestedModel ?? null
    )
  );

  const accounts = listEnabledAccountsByProvider(db, 'kiro');
  if (accounts.length === 0) return c.json({ error: 'no Kiro accounts configured' }, 503);
  const states: AccountState[] = accounts.map((a) => ({
    id: a.id,
    backoffLevel: a.backoff_level,
    rateLimitedUntil: a.rate_limited_until,
    lastError: a.last_error ? (safeJsonParse(a.last_error) as AccountState['lastError']) : null,
    status: a.status as AccountState['status'],
    enabled: !!a.enabled,
  }));
  const kiroSel = getSetting<{ mode: SelectionMode; step?: number }>(db, 'selection.kiro') ?? {
    mode: 'lowest-backoff' as SelectionMode,
    step: 1,
  };
  const {
    account: picked,
    reason: kiroReason,
    nextCursor: kiroNext,
  } = selectAccount(states, {
    mode: kiroSel.mode,
    step: kiroSel.step ?? 1,
    cursor: cursorRef.value,
    clientKeyId: clientKey?.id,
    stickyMap,
  });
  if (kiroNext != null) cursorRef.value = kiroNext;
  if (!picked) return c.json({ error: 'all Kiro accounts unavailable' }, 503);
  const acc = accounts.find((a) => a.id === picked.id)!;
  consoleBus.emit(buildAccount(reqId, new Date().toISOString(), acc.label, kiroReason));

  const transport = resolveTransportForAccount(db, acc);
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

  const logUsage = (
    usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null,
    isStream: boolean,
    statusCodeVal: number,
    responseBody: string
  ): void => {
    const prompt = usage?.prompt_tokens ?? 0;
    const completion = usage?.completion_tokens ?? 0;
    const cost = calculateCost(db, modelName, {
      prompt_tokens: prompt,
      completion_tokens: completion,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
    });
    insertRequestLogDeferred(db, {
      client_key_id: clientKey.id,
      account_id: acc.id,
      model: modelName,
      requested_model: requestedModel,
      endpoint: upstreamPath,
      format,
      prompt_tokens: prompt,
      completion_tokens: completion,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: usage?.total_tokens ?? prompt + completion,
      cost_usd: cost,
      latency_ms: Date.now() - startMs,
      status_code: statusCodeVal,
      base_resp_code: undefined,
      stream: isStream ? 1 : 0,
      rtk_bytes_saved: 0,
      request_body: truncateBody(JSON.stringify(body)),
      response_body: truncateBody(responseBody),
      request_headers: headersToJson(c.req.raw.headers),
      response_headers: undefined,
      req_id: reqId,
    });
    consoleBus.emit(
      buildDone(
        reqId,
        new Date().toISOString(),
        statusCodeVal,
        null,
        prompt,
        completion,
        0,
        cost,
        Date.now() - startMs,
        0
      )
    );
  };

  try {
    const result = await executeKiro({
      db,
      account: acc,
      model: modelName,
      body: openaiBody,
      stream: upstreamStream,
      transport,
      proxyOpts,
    });

    if (!result.ok) {
      const errBody = result.errorBody ?? '';
      const decision = checkFallbackError(
        result.status,
        errBody,
        undefined,
        acc.backoff_level,
        undefined,
        undefined
      );
      updateAccount(db, acc.id, {
        rate_limited_until:
          decision.cooldownMs > 0 ? new Date(Date.now() + decision.cooldownMs).toISOString() : null,
        backoff_level: decision.newBackoffLevel ?? 0,
        last_error: JSON.stringify({
          status: result.status,
          message: errBody.slice(0, 500),
          timestamp: new Date().toISOString(),
        }),
        status: result.status === 401 ? 'error' : 'active',
      });
      consoleBus.emit(
        buildError(reqId, new Date().toISOString(), result.status, errBody.slice(0, 200))
      );
      return c.body(
        errBody || JSON.stringify({ error: 'kiro upstream error' }),
        statusCode(result.status),
        {
          'content-type': 'application/json',
        }
      );
    }

    if (
      acc.backoff_level !== 0 ||
      acc.status !== 'active' ||
      acc.rate_limited_until !== null ||
      acc.last_error !== null
    ) {
      updateAccount(db, acc.id, {
        rate_limited_until: null,
        backoff_level: 0,
        last_error: null,
        status: 'active',
      });
    }

    if (upstreamStream && result.rawStreamResponse) {
      const sse =
        format === 'anthropic'
          ? kiroResponseToAnthropicSSE(result.rawStreamResponse, modelName)
          : kiroResponseToOpenAISSE(result.rawStreamResponse, modelName);
      return await pipeWithUsage(sse, format, (usage, raw) => {
        logUsage(usage, true, result.status, raw);
      });
    }

    const completion = result.json!;
    const respBody =
      format === 'anthropic'
        ? JSON.stringify(
            responseOpenAIToAnthropic(
              completion as unknown as Parameters<typeof responseOpenAIToAnthropic>[0]
            )
          )
        : JSON.stringify(completion);
    logUsage(completion.usage, false, result.status, respBody);
    return c.body(respBody, statusCode(result.status), { 'content-type': 'application/json' });
  } catch (e: unknown) {
    const message = errorMessage(e);
    log.error({ err: message }, 'kiro upstream error');
    const rid = c.get('reqId') ?? '----';
    consoleBus.emit(buildError(rid, new Date().toISOString(), 502, message));
    return c.json({ error: `kiro upstream error: ${message}` }, 502);
  }
}
