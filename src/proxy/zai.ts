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
import { insertRequestLogDeferred } from '../db/repos/request-logs.js';
import { getAllSettings, getSettingT } from '../db/repos/settings.js';
import { resolveModel } from '../providers/alias.js';
import { aggregateOpenAISSE } from '../providers/codebuddy/stream-convert.js';
import { calculateCost } from '../providers/pricing.js';
import { executeZai } from '../providers/zai/index.js';
import { compressMessages, rtkBytesSaved } from '../rtk/index.js';
import { pipeWithUsage } from '../streaming/pipe-with-usage.js';
import { getProxyFailureMode, resolveTransportForAccount } from '../transport/resolve.js';
import { log } from '../util/log.js';
import { augmentRequest } from './augment.js';
import { assertModelNotLocked, handleUpstreamError } from './error-handling.js';
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
 * Handle a Z.AI provider request. Z.AI speaks both Anthropic Messages
 * (at /api/anthropic) and OpenAI Chat Completions (at /api/coding/paas/v4).
 * We select the upstream endpoint based on the client's body format and
 * stream upstream + tee usage:
 *   - anthropic + stream  → upstream SSE → Anthropic Messages SSE
 *   - openai   + stream  → upstream SSE passthrough with usage tee
 *   - anthropic + non-stream → aggregate upstream SSE → Anthropic response
 *   - openai   + non-stream → aggregate upstream SSE → OpenAI response
 *
 * Mirrors `handleCodeBuddyProxy`/`handlePioneerProxy` shape — the only
 * branching is which upstream URL `executeZai` picks based on clientFormat.
 */
export async function handleZaiProxy(
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
  const model = stringValue(body.model) || 'zai/glm-5.2';

  // Resolve the requested model up-front so the console flow shows the
  // resolved alias→upstream pair (e.g. `glm > zai/glm-5.2`) instead of the
  // placeholder `zai > zai`. Strip the `zai/` prefix when forwarding
  // upstream — z.ai accepts bare model ids.
  let requestedModel: string | null = null;
  let upstreamModel: string | undefined;
  try {
    const resolved = resolveModel(db, model, body);
    requestedModel = resolved.requestedModel;
    upstreamModel = resolved.upstreamModel.startsWith('zai/')
      ? resolved.upstreamModel.slice('zai/'.length)
      : resolved.upstreamModel;
  } catch {
    /* unknown/disabled model — placeholder; error surfaces later */
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
  // (MiniMax models). Z.AI models don't match ADAPTIVE_THINKING so this
  // is a no-op for most rows, but applying it keeps parity.
  try {
    const r = resolveModel(db, stringValue(body.model), body);
    r.bodyTransform(body);
  } catch {
    /* model already resolved above; transform is best-effort */
  }

  const reqId = parentReqId ?? genReqId();
  if (!parentReqId) c.set('reqId', reqId);
  // biome-ignore format: long line
  consoleBus.emit(buildStart(reqId, new Date().toISOString(), c.req.method, upstreamPath, upstreamModel ?? model, requestedModel ?? model));

  // Get z.ai accounts.
  const allAccounts = listEnabledAccountsByProvider(db, 'zai');
  if (allAccounts.length === 0) {
    consoleBus.emit(buildError(reqId, new Date().toISOString(), 503, 'no zai accounts'));
    return c.json({ error: { message: 'No active Z.AI accounts available' } }, 503);
  }

  // Account selection (round-robin / sticky / lowest-backoff per settings).
  const sel = getSettingT(db, 'selection.zai') ?? {
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
    consoleBus.emit(buildError(reqId, new Date().toISOString(), 503, 'no available zai account'));
    return c.json({ error: { message: 'All Z.AI accounts exhausted' } }, 503);
  }

  const acc = allAccounts.find((a) => a.id === account.id)!;
  consoleBus.emit(buildAccount(reqId, new Date().toISOString(), acc.label, reason));

  if (assertModelNotLocked(db, acc.id, upstreamModel ?? model)) {
    return c.json({ error: `model ${upstreamModel ?? model} temporarily locked` }, 429);
  }

  const transport = resolveTransportForAccount(db, acc);
  const proxyOpts = {
    failureMode: getProxyFailureMode(db),
    onProxyFailure: (message: string, fellBack: boolean) =>
      consoleBus.emit(buildTransportFail(reqId, new Date().toISOString(), fellBack, message)),
  };
  const stateDb: Db = { updateAccount: (id, patch) => updateAccount(db, id, patch) };

  try {
    const resp = await executeZai({
      body,
      account: { api_key: acc.api_key, base_url: acc.base_url },
      transport,
      proxyOpts,
      clientFormat: format,
      upstreamModel,
      signal: c.req.raw.signal,
    });

    const logCtxBase = (overrides: Partial<LogRowContext> = {}): LogRowContext =>
      ({
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

    clearErrorState(stateDb, account);

    const recordUsage = (
      prompt: number,
      completion: number,
      cacheRead: number,
      isStream: boolean,
      rawResp: string
    ): void => {
      const cost = calculateCost(db, upstreamModel ?? model, {
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
        // Upstream returned Anthropic Messages SSE — use the anthropic parser.
        // pipeWithUsage(format='anthropic') extracts input_tokens/output_tokens
        // from message_delta events and passes real tail text to onUsage.
        return pipeWithUsage(
          resp,
          'anthropic',
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

    // Non-stream: Z.AI returns Anthropic Messages JSON for anthropic clients,
    // and OpenAI Chat Completions JSON for openai clients.
    if (format === 'anthropic') {
      // Anthropic Messages JSON: usage fields are input_tokens / output_tokens.
      const anthropicResp = (await resp.json()) as {
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        };
        [key: string]: unknown;
      };
      const au = anthropicResp.usage ?? {};
      recordUsage(
        au.input_tokens ?? 0,
        au.output_tokens ?? 0,
        au.cache_read_input_tokens ?? 0,
        false,
        JSON.stringify(anthropicResp).slice(0, 2000)
      );
      return c.json(anthropicResp);
    }
    // OpenAI format: upstream also returned OpenAI JSON.
    const aggregated = await aggregateOpenAISSE(resp);
    const u = aggregated.usage;
    recordUsage(
      u?.prompt_tokens ?? 0,
      u?.completion_tokens ?? 0,
      u?.prompt_tokens_details?.cached_tokens ?? 0,
      false,
      JSON.stringify(aggregated)
    );
    return c.json(aggregated);
  } catch (e: unknown) {
    const message = errorMessage(e);
    log.warn({ provider: 'zai', err: message }, 'zai: upstream error');
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
