import type Database from 'better-sqlite3';
import type { Context } from 'hono';
import { selectAccount } from '../accounts/selection.js';
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
import { listEnabledAccountsByProvider, updateAccount } from '../db/repos/accounts.js';
import { insertRequestLogDeferred } from '../db/repos/requestLogs.js';
import { getAllSettings, getSettingT } from '../db/repos/settings.js';
import { resolveModel } from '../providers/alias.js';
import { bodyAnthropicToOpenAI, responseOpenAIToAnthropic } from '../providers/format/transform.js';
import { kiroResponseToAnthropicSSE } from '../providers/kiro/anthropicSse.js';
import { kiroResponseToOpenAISSE } from '../providers/kiro/assembler.js';
import { executeKiro } from '../providers/kiro/index.js';
import { calculateCost } from '../providers/pricing.js';
import { compressMessages, rtkBytesSaved } from '../rtk/index.js';
import { pipeWithUsage } from '../streaming/pipeWithUsage.js';
import { getProxyFailureMode, resolveTransportForAccount } from '../transport/resolve.js';
import { log } from '../util/log.js';
import { assertModelNotLocked, handleUpstreamError } from './errorHandling.js';
import { errorMessage, statusCode, stringValue } from './helpers.js';
import { buildAccountStates, buildLogRow, clearErrorState, type Db } from './pipeline.js';

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
  stickyMap: Map<number, string>,
  parentReqId?: string
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

  // augment + RTK + bodyTransform parity — kiro branches before the dispatcher's
  // augment/RTK block (src/proxy/minimax.ts ~186-207). Applied to `body` BEFORE
  // the bodyAnthropicToOpenAI merge so cache_control markers survive into the
  // converted body. Mirror combo.ts:84-98 so the behavior matches.
  const allSettings = getAllSettings(db);
  const caveman = allSettings.caveman as { level: string } | undefined;
  // biome-ignore format: long line
  const caching = allSettings.caching as { autoBreakpoints: boolean; respectCallerMarkers: boolean } | undefined;
  const rtkSetting = allSettings.rtk as { enabled: boolean } | undefined;
  const cavemanOn = !!caveman?.level && caveman.level !== 'off';
  const cachingOn = !!caching?.autoBreakpoints;
  if (cavemanOn || cachingOn) {
    await augmentRequest(
      body as Parameters<typeof augmentRequest>[0],
      allSettings as Parameters<typeof augmentRequest>[1]
    );
  }
  let rtkSaved = 0;
  if (rtkSetting?.enabled) {
    rtkSaved = rtkBytesSaved(compressMessages(body, true));
  }
  resolved.bodyTransform(body);

  // When delegated from a combo, reuse the combo's reqId so the console shows
  // one thread per combo request instead of two disconnected ones.
  const reqId = parentReqId ?? genReqId();
  if (!parentReqId) c.set('reqId', reqId);
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
  const kiroSel = getSettingT(db, 'selection.kiro') ?? {
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

  if (assertModelNotLocked(db, acc.id, modelName)) {
    return c.json({ error: `model ${modelName} temporarily locked` }, 429);
  }

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

  // clearErrorState needs a Db with updateAccount; the real better-sqlite3
  // Database only exposes prepare(). handleUpstreamError builds its own.
  const stateDb: Db = { updateAccount: (id, patch) => updateAccount(db, id, patch) };

  const recordKiroUsage = (
    usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null,
    isStream: boolean,
    statusCodeVal: number,
    responseBody: string,
    rtkSavedArg: number
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
    // biome-ignore format: long line
    insertRequestLogDeferred(db, buildLogRow({ clientKeyId: clientKey.id, accountId: acc.id, model: modelName, requestedModel, endpoint: upstreamPath, format, promptTokens: prompt, completionTokens: completion, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: usage?.total_tokens ?? prompt + completion, costUsd: cost, latencyMs: latency, statusCode: statusCodeVal, baseRespCode: undefined, stream: isStream ? 1 : 0, rtkBytesSaved: rtkSavedArg, requestBody: JSON.stringify(body), responseBody, requestHeaders: c.req.raw.headers, responseHeaders: new Headers(), reqId }));
    // biome-ignore format: long line
    consoleBus.emit(buildDone(reqId, new Date().toISOString(), statusCodeVal, null, prompt, completion, 0, cost, latency, rtkSavedArg));
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
      signal: c.req.raw.signal,
    });

    if (!result.ok) {
      const errBody = result.errorBody ?? '';
      handleUpstreamError(db, {
        account: acc,
        acc: picked,
        status: result.status,
        errBody,
        response: undefined,
        retryAfterSec: result.retryAfterSec,
        upstreamModel: modelName,
      });
      consoleBus.emit(
        buildError(reqId, new Date().toISOString(), result.status, errBody.slice(0, 200))
      );
      // Parity with CodeBuddy/Pioneer/Notion/minimax: log the failed request so
      // it surfaces in the Request log. Tokens/cost are 0 — it's an error.
      insertRequestLogDeferred(
        db,
        buildLogRow({
          clientKeyId: clientKey.id,
          accountId: acc.id,
          model: modelName,
          requestedModel,
          endpoint: upstreamPath,
          format,
          promptTokens: 0,
          completionTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          latencyMs: Date.now() - startMs,
          statusCode: result.status,
          baseRespCode: undefined,
          stream: upstreamStream ? 1 : 0,
          rtkBytesSaved: 0,
          requestBody: JSON.stringify(body),
          responseBody: errBody,
          requestHeaders: c.req.raw.headers,
          responseHeaders: new Headers(),
          reqId,
        })
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
      return await pipeWithUsage(
        sse,
        format,
        (usage, _tail, capturedBody) => {
          recordKiroUsage(usage, true, result.status, capturedBody, rtkSaved);
        },
        c.req.raw.signal
      );
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
    recordKiroUsage(completion.usage, false, result.status, respBody, rtkSaved);
    return c.body(respBody, statusCode(result.status), { 'content-type': 'application/json' });
  } catch (e: unknown) {
    const message = errorMessage(e);
    log.error({ err: message }, 'kiro upstream error');
    handleUpstreamError(db, {
      account: acc,
      acc: picked,
      status: 502,
      errBody: message,
      response: undefined,
      upstreamModel: modelName,
    });
    const rid = c.get('reqId') ?? '----';
    consoleBus.emit(buildError(rid, new Date().toISOString(), 502, message));
    // transport throw (DNS/refused/timeout) previously wrote no request_log row.
    // surface the request that hit the transport throw so admins can reproduce.
    let bodyJson: string;
    try {
      bodyJson = JSON.stringify(body);
      if (bodyJson.length > 8192) bodyJson = `${bodyJson.slice(0, 8192)}…(truncated)`;
    } catch {
      bodyJson = '<unserializable>';
    }
    insertRequestLogDeferred(
      db,
      buildLogRow({
        clientKeyId: clientKey.id,
        accountId: acc.id,
        model: modelName,
        requestedModel,
        endpoint: upstreamPath,
        format,
        promptTokens: 0,
        completionTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        latencyMs: Date.now() - startMs,
        statusCode: 502,
        baseRespCode: undefined,
        stream: upstreamStream ? 1 : 0,
        rtkBytesSaved: 0,
        requestBody: bodyJson,
        responseBody: message,
        requestHeaders: c.req.raw.headers,
        responseHeaders: new Headers(),
        reqId: rid,
      })
    );
    return c.json({ error: `kiro upstream error: ${message}` }, 502);
  }
}
