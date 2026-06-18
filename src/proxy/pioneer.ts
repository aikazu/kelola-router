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
  buildTransportFail,
  genReqId,
} from '../console/flow.js';
import { listEnabledAccountsByProvider, updateAccount } from '../db/repos/accounts.js';
import { insertRequestLogDeferred } from '../db/repos/requestLogs.js';
import { getSettingT } from '../db/repos/settings.js';
import { resolveModel } from '../providers/alias.js';
import {
  aggregateOpenAISSE,
  openaiSSEToAnthropicSSE,
} from '../providers/codebuddy/streamConvert.js';
import { responseOpenAIToAnthropic } from '../providers/format/transform.js';
import { executePioneer } from '../providers/pioneer/index.js';
import { calculateCost } from '../providers/pricing.js';
import { pipeWithUsage } from '../streaming/pipeWithUsage.js';
import { getProxyFailureMode, resolveTransportForAccount } from '../transport/resolve.js';
import { log } from '../util/log.js';
import { errorMessage, statusCode, stringValue } from './helpers.js';
import type { CursorRef } from './kiro.js';
import {
  applyErrorState,
  buildAccountStates,
  buildLogRow,
  clearErrorState,
  type Db,
  type LogRowContext,
} from './pipeline.js';

/**
 * Handle a Pioneer provider request. Bridges the client's format to the upstream
 * OpenAI-SSE stream and converts back to the client's requested format:
 *   - anthropic + stream  → upstream SSE → Anthropic Messages SSE
 *   - openai   + stream  → upstream SSE passthrough with usage tee
 *   - anthropic + non-stream → aggregate upstream SSE → Anthropic response
 *   - openai   + non-stream → aggregate upstream SSE → OpenAI response
 */
export async function handlePioneerProxy(
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
  const originalText = JSON.stringify(body);
  const model = stringValue(body.model) || 'pio/claude-opus-4-8';

  // Resolve the requested model up-front so the console flow shows the real
  // model/alias pair (e.g. `claude-opus-4-8 > pio/claude-opus-4-8`) instead of
  // the previous `pioneer > pioneer` placeholder.
  let requestedModel: string | null = null;
  let upstreamModel: string | undefined;
  try {
    const resolved = resolveModel(db, model, body);
    requestedModel = resolved.requestedModel;
    const raw = resolved.upstreamModel;
    upstreamModel = raw.startsWith('pioneer/') ? raw.slice('pioneer/'.length) : raw;
  } catch {
    /* leave placeholders null — preparePioneerBody will fall back to prefix-strip */
  }

  const reqId = genReqId();
  c.set('reqId', reqId);
  // biome-ignore format: long line
  consoleBus.emit(buildStart(reqId, new Date().toISOString(), c.req.method, upstreamPath, upstreamModel ?? model, requestedModel ?? model));

  // Get Pioneer accounts.
  const allAccounts = listEnabledAccountsByProvider(db, 'pioneer');
  if (allAccounts.length === 0) {
    consoleBus.emit(buildError(reqId, new Date().toISOString(), 503, 'no pioneer accounts'));
    return c.json({ error: { message: 'No active Pioneer accounts available' } }, 503);
  }

  // Account selection (round-robin, sticky, or lowest-backoff).
  const sel = getSettingT(db, 'selection.pioneer') ?? {
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
      buildError(reqId, new Date().toISOString(), 503, 'no available pioneer account')
    );
    return c.json({ error: { message: 'All Pioneer accounts exhausted' } }, 503);
  }

  const acc = allAccounts.find((a) => a.id === account.id)!;
  consoleBus.emit(buildAccount(reqId, new Date().toISOString(), acc.label, reason));

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

  // Resolve the requested model to its real upstream id. Pioneer DB rows are
  // namespaced under `pioneer/` (in both name and upstream_model) to avoid
  // clashes with same-named Kiro/CodeBuddy rows, so strip the single leading
  // `pioneer/` to recover the bare id Pioneer's API expects. (Done above so
  // the console flow can log the real model/alias — see buildStart emit.)

  try {
    const resp = await executePioneer({
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
    });

    // Common log-row template — caller overrides responseBody + per-call fields.
    const logCtxBase = (overrides: Partial<LogRowContext> = {}): LogRowContext =>
      ({
        clientKeyId: clientKey.id,
        accountId: account.id,
        model,
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
        rtkBytesSaved: 0,
        requestBody: originalText,
        requestHeaders: c.req.raw.headers,
        responseHeaders: resp.headers,
        reqId,
        ...overrides,
      }) as LogRowContext;

    if (!resp.ok) {
      const errBody = await resp.text();
      const parsed = {
        message: errBody.slice(0, 500),
        baseRespCode: undefined,
        windowResetMs: undefined,
        retryAfterSec: undefined,
      };

      // Try parse a generic {error:{message}} shape.
      try {
        const errJson = JSON.parse(errBody) as { error?: { message?: string } };
        if (errJson?.error?.message) parsed.message = errJson.error.message;
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
      applyErrorState(stateDb, account, decision, parsed.message, {
        status: resp.status,
        baseRespCode: parsed.baseRespCode,
      });

      consoleBus.emit(
        buildError(reqId, new Date().toISOString(), resp.status, parsed.message.slice(0, 200))
      );
      insertRequestLogDeferred(db, buildLogRow(logCtxBase({ responseBody: errBody })));

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
      const cost = calculateCost(db, model, {
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
      // openai client: passthrough OpenAI SSE, tee usage.
      return pipeWithUsage(resp, 'openai', (usage, raw) =>
        recordUsage(
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
    log.warn({ provider: 'pioneer', err: message }, 'pioneer: upstream error');
    consoleBus.emit(buildError(reqId, new Date().toISOString(), 502, message));
    return c.json({ error: { message: `upstream unreachable: ${message}` } }, 502);
  }
}
