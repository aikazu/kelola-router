import type Database from 'better-sqlite3';
import type { Context } from 'hono';
import { selectAccount } from '../accounts/selection.js';
import type { SelectionMode } from '../accounts/types.js';
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
import { getAllSettings, getSettingT } from '../db/repos/settings.js';
import { resolveModel } from '../providers/alias.js';
import {
  aggregateOpenAISSE,
  openaiSSEToAnthropicSSE,
} from '../providers/codebuddy/streamConvert.js';
import { responseOpenAIToAnthropic } from '../providers/format/transform.js';
import { calculateCost } from '../providers/pricing.js';
import { executeTabi } from '../providers/tabi/index.js';
import { compressMessages, rtkBytesSaved } from '../rtk/index.js';
import { pipeWithUsage } from '../streaming/pipeWithUsage.js';
import { getProxyFailureMode, resolveTransportForAccount } from '../transport/resolve.js';
import { log } from '../util/log.js';
import { augmentRequest } from './augment.js';
import { assertModelNotLocked, handleUpstreamError } from './errorHandling.js';
import { errorMessage, statusCode, stringValue } from './helpers.js';
import type { CursorRef } from './kiro.js';
import {
  buildAccountStates,
  buildLogRow,
  clearErrorState,
  type Db,
  type LogRowContext,
} from './pipeline.js';

/**
 * Handle a TabiToken provider request. TabiToken is a New-API-fork gateway
 * (OpenAI-compatible, Bearer auth). Bridges the client's format to the
 * upstream OpenAI-SSE stream and converts back to the client's format:
 *   - anthropic + stream  → upstream SSE → Anthropic Messages SSE
 *   - openai   + stream  → upstream SSE passthrough with usage tee
 *   - anthropic + non-stream → aggregate upstream SSE → Anthropic response
 *   - openai   + non-stream → aggregate upstream SSE → OpenAI response
 */
export async function handleTabiProxy(
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
  const originalText = JSON.stringify(body);
  const model = stringValue(body.model) || 'tabi/claude-opus-5';

  // Resolve the requested model up-front so the console flow shows the real
  // model/alias pair instead of a placeholder.
  let requestedModel: string | null = null;
  let upstreamModel: string | undefined;
  // pricingModel = DB key for calculateCost (e.g. "tabi/claude-opus-5").
  // upstreamModel = bare id sent to TabiToken API (e.g. "claude-opus-5").
  let pricingModel: string = model;
  try {
    const resolved = resolveModel(db, model, body);
    requestedModel = resolved.requestedModel;
    pricingModel = resolved.upstreamModel; // DB key, used for cost lookup
    const raw = resolved.upstreamModel;
    upstreamModel = raw.startsWith('tabi/') ? raw.slice('tabi/'.length) : raw;
  } catch {
    /* leave placeholders null — prepareTabiBody will fall back to prefix-strip */
  }

  // augment (caveman + cache_control) + RTK compression + bodyTransform —
  // skipped because handlers branch before the dispatcher's augment/RTK block.
  const allSettings = getAllSettings(db);
  const caveman = allSettings.caveman as { level: string } | undefined;
  // biome-ignore format: long line
  const caching = allSettings.caching as { autoBreakpoints: boolean; respectCallerMarkers: boolean } | undefined;
  const rtkSetting = allSettings.rtk as { enabled: boolean } | undefined;
  const cavemanOn = !!caveman?.level && caveman.level !== 'off';
  const cachingOn = !!caching?.autoBreakpoints;
  if (cavemanOn || cachingOn) {
    await augmentRequest(body, allSettings as Parameters<typeof augmentRequest>[1]);
  }
  let rtkSaved = 0;
  if (rtkSetting?.enabled) {
    rtkSaved = rtkBytesSaved(compressMessages(body, true));
  }
  try {
    const r = resolveModel(db, stringValue(body.model), body);
    r.bodyTransform(body);
  } catch {
    /* model already resolved above; transform is best-effort */
  }

  // When delegated from a combo, reuse the combo's reqId so the console shows
  // one thread per combo request instead of two disconnected ones.
  const reqId = parentReqId ?? genReqId();
  if (!parentReqId) c.set('reqId', reqId);
  // biome-ignore format: long line
  consoleBus.emit(buildStart(reqId, new Date().toISOString(), c.req.method, upstreamPath, upstreamModel ?? model, requestedModel ?? model));

  // Get TabiToken accounts.
  const allAccounts = listEnabledAccountsByProvider(db, 'tabi');
  if (allAccounts.length === 0) {
    consoleBus.emit(buildError(reqId, new Date().toISOString(), 503, 'no tabi accounts'));
    return c.json({ error: { message: 'No active TabiToken accounts available' } }, 503);
  }

  // Account selection (round-robin, sticky, or lowest-backoff).
  const sel = getSettingT(db, 'selection.tabi') ?? {
    mode: 'round-robin' as SelectionMode,
    step: 1,
  };
  const accountStates = buildAccountStates(allAccounts);
  const { account, reason, nextCursor } = selectAccount(accountStates, {
    mode: sel.mode,
    step: sel.step ?? 1,
    cursor: cursorRef.value,
    clientKeyId: clientKey?.id,
    stickyMap,
  });
  if (nextCursor != null) cursorRef.value = nextCursor;
  if (!account) {
    consoleBus.emit(buildError(reqId, new Date().toISOString(), 503, 'no available tabi account'));
    return c.json({ error: { message: 'All TabiToken accounts exhausted' } }, 503);
  }

  const acc = allAccounts.find((a) => a.id === account.id)!;
  consoleBus.emit(buildAccount(reqId, new Date().toISOString(), acc.label, reason));

  // Pre-fetch model-lock gate: refuse before paying the upstream round-trip.
  if (assertModelNotLocked(db, acc.id, upstreamModel ?? model)) {
    return c.json({ error: `model ${upstreamModel ?? model} temporarily locked` }, 429);
  }

  // Parse provider_data for per-account overrides (e.g. chat_endpoint).
  let providerData: Record<string, unknown> = {};
  if (acc.provider_data) {
    try {
      providerData = JSON.parse(acc.provider_data);
    } catch {
      /* ignore */
    }
  }

  // Resolve transport (proxy pool / relay for residential proxy).
  const transport = resolveTransportForAccount(db, acc);
  const proxyOpts = {
    failureMode: getProxyFailureMode(db),
    onProxyFailure: (message: string, fellBack: boolean) =>
      consoleBus.emit(buildTransportFail(reqId, new Date().toISOString(), fellBack, message)),
  };
  // Pipeline state helpers expect a Db with updateAccount(); adapt our handle.
  const stateDb: Db = { updateAccount: (id, patch) => updateAccount(db, id, patch) };

  try {
    const resp = await executeTabi({
      body,
      account: {
        api_key: acc.api_key,
        base_url: acc.base_url,
        chat_endpoint: (providerData.chat_endpoint as string) || null,
      },
      transport,
      proxyOpts,
      clientFormat: format,
      upstreamModel,
      signal: c.req.raw.signal,
    });

    // Common log-row template — caller overrides responseBody + per-call fields.
    const logCtxBase = (overrides: Partial<LogRowContext> = {}): LogRowContext =>
      ({
        clientKeyId: clientKey.id,
        accountId: account.id,
        model: pricingModel,
        requestedModel: model,
        endpoint: upstreamPath,
        format,
        promptTokens: 0,
        completionTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        latencyMs: Date.now() - startMs,
        statusCode: resp.status,
        baseRespCode: undefined,
        stream: body.stream ? 1 : 0,
        rtkBytesSaved: rtkSaved,
        requestBody: originalText,
        requestHeaders: c.req.raw.headers,
        responseHeaders: resp.headers,
        reqId,
        ...overrides,
      }) as LogRowContext;

    if (!resp.ok) {
      const errBody = await resp.text();
      const { parsed } = handleUpstreamError(db, {
        account: acc,
        acc: {
          id: acc.id,
          backoffLevel: acc.backoff_level,
          rateLimitedUntil: acc.rate_limited_until ?? null,
          lastError: acc.last_error ? JSON.parse(acc.last_error) : null,
          status: acc.status as 'active' | 'error',
          enabled: !!acc.enabled,
        },
        status: resp.status,
        errBody,
        response: resp,
        upstreamModel: upstreamModel ?? model,
      });
      consoleBus.emit(
        buildError(reqId, new Date().toISOString(), resp.status, parsed.message.slice(0, 200))
      );
      insertRequestLogDeferred(
        db,
        buildLogRow(logCtxBase({ responseBody: errBody, baseRespCode: parsed.baseRespCode }))
      );

      return c.body(errBody, statusCode(resp.status), {
        'content-type': resp.headers.get('content-type') ?? 'application/json',
      });
    }

    // Success — clear account errors.
    clearErrorState(stateDb, account);

    const recordUsage = (
      prompt: number,
      completion: number,
      cacheRead: number,
      isStream: boolean,
      rawResp: string
    ): void => {
      const cost = calculateCost(db, pricingModel, {
        prompt_tokens: prompt,
        completion_tokens: completion,
        cache_creation_tokens: 0,
        cache_read_tokens: cacheRead,
      });
      insertRequestLogDeferred(
        db,
        buildLogRow(
          logCtxBase({
            promptTokens: prompt,
            completionTokens: completion,
            cacheReadTokens: cacheRead,
            totalTokens: prompt + completion,
            costUsd: cost,
            stream: isStream ? 1 : 0,
            responseBody: rawResp,
          })
        )
      );
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

    if (body.stream === true) {
      if (format === 'anthropic') {
        return openaiSSEToAnthropicSSE(resp, model, (u, capturedBody) =>
          recordUsage(u.prompt_tokens, u.completion_tokens, u.cache_read, true, capturedBody)
        );
      }
      // openai client: passthrough OpenAI SSE, tee usage.
      return pipeWithUsage(
        resp,
        'openai',
        (usage, _tail, capturedBody) =>
          recordUsage(
            usage?.prompt_tokens ?? 0,
            usage?.completion_tokens ?? 0,
            usage?.cache_read_tokens ?? 0,
            true,
            capturedBody
          ),
        c.req.raw.signal
      );
    }
    // Non-stream client: aggregate the forced upstream stream.
    const aggregated = await aggregateOpenAISSE(resp);
    const u = aggregated.usage;
    recordUsage(
      u?.prompt_tokens ?? 0,
      u?.completion_tokens ?? 0,
      u?.prompt_tokens_details?.cached_tokens ?? 0,
      false,
      JSON.stringify(aggregated)
    );
    if (format === 'anthropic') return c.json(responseOpenAIToAnthropic(aggregated));
    return c.json(aggregated);
  } catch (e: unknown) {
    const message = errorMessage(e);
    log.warn({ provider: 'tabi', err: message }, 'tabi: upstream error');
    consoleBus.emit(buildError(reqId, new Date().toISOString(), 502, message));
    // transport throw (DNS/refused/timeout) previously wrote no request_log row.
    insertRequestLogDeferred(
      db,
      buildLogRow({
        clientKeyId: clientKey.id,
        accountId: account.id,
        model: upstreamModel ?? model,
        requestedModel: requestedModel ?? model,
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
        stream: body.stream ? 1 : 0,
        rtkBytesSaved: rtkSaved,
        requestBody: originalText,
        responseBody: message,
        requestHeaders: c.req.raw.headers,
        responseHeaders: new Headers(),
        reqId,
      })
    );
    return c.json({ error: { message: `upstream unreachable: ${message}` } }, 502);
  }
}
