// src/proxy/qwencloud.ts
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
import type { ContentBlock } from '../providers/format/message-types.js';
import { bodyOpenAIToAnthropic, responseAnthropicToOpenAI } from '../providers/format/transform.js';
import { calculateCost } from '../providers/pricing.js';
import { executeQwenCloud } from '../providers/qwencloud/index.js';
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

// -----------------------------------------------------------------------------
// Anthropic-Messages SSE → AnthropicResponse aggregator
//
// QwenCloud's transform forces `stream:true` upstream (prepareQwenCloudBody),
// so even non-stream clients receive native Anthropic Messages SSE. To serve a
// JSON response we aggregate the SSE events back into a single Anthropic
// `message` object (id / model / content blocks / stop_reason / usage), using
// the canonical event order in docs/qwencloud/wire-format.md:
//   ping → message_start → content_block_start/delta/stop* → message_delta
//   (final usage) → message_stop
// -----------------------------------------------------------------------------

interface AggregatedUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AggregateResult {
  message: {
    id?: string;
    model?: string;
    content: ContentBlock[];
    stop_reason?: string | null;
    stop_sequence?: string | null;
    usage?: AggregatedUsage;
  };
  rawBody: string;
}

/**
 * ContentBlock plus transient fields carried by QwenCloud's Anthropic SSE
 * (thinking blocks expose a `signature` verification field; tool_use blocks
 * accumulate raw JSON via an internal `__inputRaw` side-channel).
 */
type QwenContentBlock = ContentBlock & { signature?: string; __inputRaw?: string };

function parseSseDataEvent(ev: string): Record<string, unknown> | null {
  let data = '';
  for (const line of ev.split('\n')) {
    if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    const obj = JSON.parse(data) as Record<string, unknown>;
    return typeof obj === 'object' && obj !== null ? obj : null;
  } catch {
    return null;
  }
}

async function aggregateAnthropicSSE(upstream: Response): Promise<AggregateResult> {
  const rawBody = await upstream.text();
  const content: QwenContentBlock[] = [];
  let messageId: string | undefined;
  let model: string | undefined;
  let stopReason: string | null = null;
  let stopSequence: string | null = null;
  let usage: AggregatedUsage = {};

  const events = rawBody.split('\n\n');
  for (const ev of events) {
    const obj = parseSseDataEvent(ev);
    if (!obj) continue;
    const type = typeof obj.type === 'string' ? obj.type : '';
    const index = typeof obj.index === 'number' ? obj.index : -1;

    if (type === 'message_start') {
      const message = obj.message as { id?: string; model?: string } | undefined;
      messageId = message?.id ?? messageId;
      model = message?.model ?? model;
    } else if (type === 'content_block_start') {
      const cb = obj.content_block as
        | {
            type?: string;
            text?: string;
            thinking?: string;
            signature?: string;
            id?: string;
            name?: string;
          }
        | undefined;
      if (!cb || index < 0) continue;
      if (cb.type === 'text') {
        content[index] = { type: 'text', text: cb.text ?? '' };
      } else if (cb.type === 'thinking') {
        content[index] = {
          type: 'thinking',
          thinking: cb.thinking ?? '',
          signature: cb.signature ?? '',
        };
      } else if (cb.type === 'tool_use') {
        content[index] = { type: 'tool_use', id: cb.id, name: cb.name, input: {} };
      } else {
        content[index] = { ...cb };
      }
    } else if (type === 'content_block_delta') {
      const blk = content[index];
      if (!blk) continue;
      const delta = obj.delta as
        | {
            type?: string;
            text?: string;
            thinking?: string;
            signature?: string;
            partial_json?: string;
          }
        | undefined;
      if (!delta) continue;
      if (delta.type === 'text_delta') {
        blk.text = (blk.text ?? '') + (delta.text ?? '');
      } else if (delta.type === 'thinking_delta') {
        blk.thinking = (blk.thinking ?? '') + (delta.thinking ?? '');
      } else if (delta.type === 'signature_delta') {
        blk.signature = delta.signature ?? blk.signature;
      } else if (delta.type === 'input_json_delta') {
        const tool = blk as unknown as { input?: unknown; __inputRaw?: string };
        tool.__inputRaw = (tool.__inputRaw ?? '') + (delta.partial_json ?? '');
      }
    } else if (type === 'message_delta') {
      const delta = obj.delta as
        | { stop_reason?: string | null; stop_sequence?: string | null }
        | undefined;
      stopReason = delta?.stop_reason ?? stopReason;
      stopSequence = delta?.stop_sequence ?? stopSequence;
      usage = (obj.usage as AggregatedUsage | undefined) ?? usage;
    }
  }

  // Parse accumulated tool-use JSON into block.input.
  for (const blk of content) {
    const tool = blk as unknown as { __inputRaw?: string };
    if (blk.type === 'tool_use' && tool.__inputRaw) {
      try {
        (blk as { input?: unknown }).input = JSON.parse(tool.__inputRaw);
      } catch {
        (blk as { input?: unknown }).input = tool.__inputRaw;
      }
    }
  }

  return {
    message: {
      id: messageId,
      model,
      content,
      stop_reason: stopReason,
      stop_sequence: stopSequence,
      usage,
    },
    rawBody,
  };
}

/**
 * Handle a QwenCloud (Aliyun token-plan) provider request.
 *
 * QwenCloud exposes a single native Anthropic-Messages endpoint at
 * apps/anthropic/v1/messages whose transform always forces `stream:true`
 * upstream, returning native Anthropic Messages SSE. Client formats:
 *   - anthropic + stream  → passthrough upstream Anthropic SSE (usage tee)
 *   - anthropic + non-stream → aggregate SSE → Anthropic `message` JSON
 *   - openai   + non-stream → bodyOpenAIToAnthropic → aggregate SSE →
 *                             responseAnthropicToOpenAI
 *   - openai   + stream  → rejected explicitly (no Anthropic-SSE→OpenAI-SSE
 *                          converter exists; see wire-format.md "Konversi").
 *
 * Mirrors `handleZaiProxy`/`handleTabiProxy` shape.
 */
export async function handleQwenCloudProxy(
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
  const model = stringValue(body.model) || 'qwencloud/qwen3.8-max';

  // Resolve the requested model up-front so the console flow shows the real
  // model/alias pair. qwencloud DB rows store bare ids (no `qctp/` prefix in
  // either name or upstream_model), so upstreamModel is already ready to send.
  let requestedModel: string | null = null;
  let upstreamModel: string | undefined;
  try {
    const resolved = resolveModel(db, model, body);
    requestedModel = resolved.requestedModel;
    upstreamModel = resolved.upstreamModel;
  } catch {
    /* unknown/disabled model — placeholder; error surfaces later */
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

  const reqId = parentReqId ?? genReqId();
  if (!parentReqId) c.set('reqId', reqId);
  // biome-ignore format: long line
  consoleBus.emit(buildStart(reqId, new Date().toISOString(), c.req.method, upstreamPath, upstreamModel ?? model, requestedModel ?? model));

  // OpenAI streaming is explicitly unsupported: QwenCloud only speaks native
  // Anthropic SSE upstream and there is no Anthropic-SSE→OpenAI-SSE converter.
  // Reject before any account selection / upstream round-trip.
  if (format === 'openai' && body.stream === true) {
    const message =
      'qwencloud does not support OpenAI streaming responses; use stream:false or the Anthropic client format';
    consoleBus.emit(buildError(reqId, new Date().toISOString(), 501, message));
    insertRequestLogDeferred(
      db,
      buildLogRow({
        clientKeyId: clientKey.id,
        accountId: '',
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
        statusCode: 501,
        baseRespCode: undefined,
        stream: 1,
        rtkBytesSaved: rtkSaved,
        requestBody: originalText,
        responseBody: message,
        requestHeaders: c.req.raw.headers,
        responseHeaders: new Headers(),
        reqId,
      })
    );
    return c.json({ error: { message } }, 501);
  }

  // Get QwenCloud accounts.
  const allAccounts = listEnabledAccountsByProvider(db, 'qwencloud');
  if (allAccounts.length === 0) {
    consoleBus.emit(buildError(reqId, new Date().toISOString(), 503, 'no qwencloud accounts'));
    return c.json({ error: { message: 'No active QwenCloud accounts available' } }, 503);
  }

  // Account selection (round-robin / sticky / lowest-backoff per settings).
  const sel = getSettingT(db, 'selection.qwencloud') ?? {
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
      buildError(reqId, new Date().toISOString(), 503, 'no available qwencloud account')
    );
    return c.json({ error: { message: 'All QwenCloud accounts exhausted' } }, 503);
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

  // OpenAI non-stream clients: convert the request body to Anthropic shape
  // before handing it to executeQwenCloud (which only speaks Anthropic).
  const upstreamBody = format === 'openai' ? bodyOpenAIToAnthropic(body) : body;

  try {
    const resp = await executeQwenCloud({
      body: upstreamBody,
      account: { api_key: acc.api_key, base_url: acc.base_url },
      transport,
      proxyOpts,
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

    // Anthropic + stream: passthrough the native Anthropic Messages SSE.
    // pipeWithUsage('anthropic') extracts usage from the message_delta event.
    if (body.stream === true && format === 'anthropic') {
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

    // Non-stream (anthropic or openai): the upstream always returned
    // Anthropic Messages SSE (transform forces stream:true). Aggregate it
    // back into a single Anthropic `message`, then convert to OpenAI if the
    // client speaks OpenAI.
    const aggregated = await aggregateAnthropicSSE(resp);
    const au = aggregated.message.usage ?? {};
    recordUsage(
      au.input_tokens ?? 0,
      au.output_tokens ?? 0,
      au.cache_read_input_tokens ?? 0,
      false,
      aggregated.rawBody
    );

    const out = {
      id: aggregated.message.id,
      type: 'message',
      role: 'assistant',
      model: aggregated.message.model,
      content: aggregated.message.content,
      stop_reason: aggregated.message.stop_reason ?? null,
      stop_sequence: aggregated.message.stop_sequence ?? null,
      usage: au,
    };
    if (format === 'anthropic') {
      return c.json(out);
    }
    return c.json(responseAnthropicToOpenAI(out));
  } catch (e: unknown) {
    const message = errorMessage(e);
    log.warn({ provider: 'qwencloud', err: message }, 'qwencloud: upstream error');
    consoleBus.emit(buildError(reqId, new Date().toISOString(), 502, message));
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
