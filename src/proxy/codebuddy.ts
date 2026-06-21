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
  buildTransportFail,
  genReqId,
} from '../console/flow.js';
import { listEnabledAccountsByProvider, updateAccount } from '../db/repos/accounts.js';
import { insertRequestLogDeferred } from '../db/repos/requestLogs.js';
import { getAllSettings, getSettingT } from '../db/repos/settings.js';
import { resolveModel } from '../providers/alias.js';
import { executeCodeBuddy } from '../providers/codebuddy/index.js';
import {
  aggregateOpenAISSE,
  openaiSSEToAnthropicSSE,
} from '../providers/codebuddy/streamConvert.js';
import { responseOpenAIToAnthropic } from '../providers/format/transform.js';
import { calculateCost } from '../providers/pricing.js';
import { compressMessages, rtkBytesSaved } from '../rtk/index.js';
import { pipeWithUsage } from '../streaming/pipeWithUsage.js';
import { getProxyFailureMode, resolveTransportForAccount } from '../transport/resolve.js';
import { log } from '../util/log.js';
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
 * Handle a CodeBuddy provider request. Bridges the client's format to the
 * upstream OpenAI-SSE stream and converts back to the client's requested format:
 *   - anthropic + stream  → upstream SSE → Anthropic Messages SSE
 *   - openai   + stream  → upstream SSE passthrough with usage tee
 *   - anthropic + non-stream → aggregate upstream SSE → Anthropic response
 *   - openai   + non-stream → aggregate upstream SSE → OpenAI response
 */
export async function handleCodeBuddyProxy(
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
  const model = stringValue(body.model) || 'cb/claude-opus-4.6';

  // Resolve the requested model up-front so the console flow shows the real
  // model/alias pair (e.g. `claude-opus > cb/claude-opus`) instead of the
  // previous `codebuddy > codebuddy` placeholder.
  let requestedModel: string | null = null;
  let upstreamModel: string = 'codebuddy';
  try {
    const resolved = resolveModel(db, model, body);
    requestedModel = resolved.requestedModel;
    upstreamModel = resolved.upstreamModel;
  } catch {
    /* unknown/disabled model — keep placeholders; request surfaces error later */
  }

  // augment (caveman + cache_control) + RTK compression + bodyTransform —
  // skipped because handlers branch before the dispatcher's augment/RTK block
  // (src/proxy/minimax.ts ~186-207). Mirror combo.ts:84-98 here so parity holds.
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
  // bodyTransform writes thinking/max_completion_tokens/reasoning_split
  // (MiniMax models). CodeBuddy models don't match ADAPTIVE_THINKING so this
  // is a no-op for most rows, but applying it keeps parity.
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
  consoleBus.emit(
    buildStart(
      reqId,
      new Date().toISOString(),
      c.req.method,
      upstreamPath,
      upstreamModel,
      requestedModel && requestedModel !== upstreamModel ? requestedModel : null
    )
  );

  // Get CodeBuddy accounts
  const allAccounts = listEnabledAccountsByProvider(db, 'codebuddy');
  if (allAccounts.length === 0) {
    consoleBus.emit(buildError(reqId, new Date().toISOString(), 503, 'no codebuddy accounts'));
    return c.json({ error: { message: 'No active CodeBuddy accounts available' } }, 503);
  }

  // Account selection (round-robin)
  const sel = getSettingT(db, 'selection.codebuddy') ?? {
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
    consoleBus.emit(
      buildError(reqId, new Date().toISOString(), 503, 'no available codebuddy account')
    );
    return c.json({ error: { message: 'All CodeBuddy accounts exhausted' } }, 503);
  }

  const acc = allAccounts.find((a) => a.id === account.id)!;
  consoleBus.emit(buildAccount(reqId, new Date().toISOString(), acc.label, reason));

  // Pre-fetch model-lock gate: refuse before paying the upstream round-trip.
  if (assertModelNotLocked(db, acc.id, upstreamModel)) {
    return c.json({ error: `model ${upstreamModel} temporarily locked` }, 429);
  }

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
  // Pipeline state helpers expect a Db with updateAccount(); adapt our handle.
  const stateDb: Db = { updateAccount: (id, patch) => updateAccount(db, id, patch) };

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
      signal: c.req.raw.signal,
    });

    // Common log-row template — caller overrides responseBody + per-call fields.
    const logCtxBase = (overrides: Partial<LogRowContext> = {}): LogRowContext =>
      ({
        clientKeyId: clientKey.id,
        accountId: account.id,
        model: upstreamModel,
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
        upstreamModel,
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

    // Success — clear account errors
    clearErrorState(stateDb, account);

    const recordUsage = (
      prompt: number,
      completion: number,
      cacheRead: number,
      isStream: boolean,
      rawResp: string
    ): void => {
      const cost = calculateCost(db, upstreamModel, {
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
        return openaiSSEToAnthropicSSE(resp, model, (u) =>
          recordUsage(u.prompt_tokens, u.completion_tokens, u.cache_read, true, '[anthropic-sse]')
        );
      }
      // openai client: passthrough OpenAI SSE, tee usage
      return pipeWithUsage(
        resp,
        'openai',
        (usage, raw) =>
          recordUsage(
            usage?.prompt_tokens ?? 0,
            usage?.completion_tokens ?? 0,
            usage?.cache_read_tokens ?? 0,
            true,
            raw
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
      JSON.stringify(aggregated).slice(0, 2000)
    );
    if (format === 'anthropic') return c.json(responseOpenAIToAnthropic(aggregated));
    return c.json(aggregated);
  } catch (e: unknown) {
    const message = errorMessage(e);
    log.warn({ provider: 'codebuddy', err: message }, 'codebuddy: upstream error');
    consoleBus.emit(buildError(reqId, new Date().toISOString(), 502, message));
    // transport throw (DNS/refused/timeout) previously wrote no request_log row. logCtxBase
    // depends on resp (absent here), so build a raw zeros row.
    insertRequestLogDeferred(
      db,
      buildLogRow({
        clientKeyId: clientKey.id,
        accountId: account.id,
        model: upstreamModel,
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
