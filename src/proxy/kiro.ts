import type Database from 'better-sqlite3';
import type { Context } from 'hono';
import { checkFallbackError } from '../accounts/errorRules.js';
import { selectAccount } from '../accounts/selection.js';
import type { SelectionMode } from '../accounts/types.js';
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
import { errorMessage, statusCode, stringValue } from './helpers.js';
import {
  applyErrorState,
  buildAccountStates,
  buildLogRow,
  clearErrorState,
  type Db,
} from './pipeline.js';

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
  const states = buildAccountStates(accounts);
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

  // Pipeline helpers (applyErrorState/clearErrorState) need a Db with
  // updateAccount; the real better-sqlite3 Database only exposes prepare().
  const stateDb: Db = { updateAccount: (id, patch) => updateAccount(db, id, patch) };

  const recordKiroUsage = (
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
    const latency = Date.now() - startMs;
    insertRequestLogDeferred(
      db,
      buildLogRow({
        clientKeyId: clientKey.id,
        accountId: acc.id,
        model: modelName,
        requestedModel,
        endpoint: upstreamPath,
        format,
        promptTokens: prompt,
        completionTokens: completion,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: usage?.total_tokens ?? prompt + completion,
        costUsd: cost,
        latencyMs: latency,
        statusCode: statusCodeVal,
        baseRespCode: undefined,
        stream: isStream ? 1 : 0,
        rtkBytesSaved: 0,
        requestBody: JSON.stringify(body),
        responseBody,
        requestHeaders: c.req.raw.headers,
        responseHeaders: new Headers(),
        reqId,
      })
    );
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
        latency,
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
      applyErrorState(stateDb, picked, decision, errBody, { status: result.status });
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

    clearErrorState(stateDb, picked);

    if (upstreamStream && result.rawStreamResponse) {
      const sse =
        format === 'anthropic'
          ? kiroResponseToAnthropicSSE(result.rawStreamResponse, modelName)
          : kiroResponseToOpenAISSE(result.rawStreamResponse, modelName);
      return await pipeWithUsage(sse, format, (usage, raw) => {
        recordKiroUsage(usage, true, result.status, raw);
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
    recordKiroUsage(completion.usage, false, result.status, respBody);
    return c.body(respBody, statusCode(result.status), { 'content-type': 'application/json' });
  } catch (e: unknown) {
    const message = errorMessage(e);
    log.error({ err: message }, 'kiro upstream error');
    const rid = c.get('reqId') ?? '----';
    consoleBus.emit(buildError(rid, new Date().toISOString(), 502, message));
    return c.json({ error: `kiro upstream error: ${message}` }, 502);
  }
}
