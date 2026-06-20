/**
 * Notion proxy handler.
 *
 * Minimal v1 implementation: text-only chat completions routed through
 * Notion's runInferenceTranscript endpoint using the captured wire format.
 *
 * Dispatches from src/proxy/minimax.ts when `resolveModel` returns
 * `provider === 'notion'`. No transport layer (relay/proxy) in v1 — direct
 * fetch to app.notion.com. No failover in v1 — single account selection.
 */
import type Database from 'better-sqlite3';
import type { Context } from 'hono';
import type { AccountState } from '../accounts/types.js';
import { augmentRequest } from '../cache-injection.js';
import { consoleBus } from '../console/bus.js';
import { buildAccount, buildDone, buildError, buildStart, genReqId } from '../console/flow.js';
import type { Account } from '../db/repos/accounts.js';
import { listEnabledAccountsByProvider, updateAccount } from '../db/repos/accounts.js';
import { insertRequestLogDeferred } from '../db/repos/requestLogs.js';
import { getAllSettings } from '../db/repos/settings.js';
import { resolveModel } from '../providers/alias.js';
import {
  NOTION_AI_COOKIE_NAMES,
  NOTION_BASE,
  NOTION_CLIENT_VERSION,
  NOTION_FATAL_STATUSES,
  NOTION_LOGIN_COOKIE_NAMES,
} from '../providers/notion/constants.js';
import { extractNotionStream } from '../providers/notion/extract.js';
import { buildNotionPayload } from '../providers/notion/transform.js';
import { compressMessages, rtkBytesSaved } from '../rtk/index.js';
import { log } from '../util/log.js';
import { assertModelNotLocked, handleUpstreamError } from './errorHandling.js';
import { errorMessage, stringValue } from './helpers.js';
import type { CursorRef } from './kiro.js';
import { buildLogRow, type LogRowContext } from './pipeline.js';

interface NotionProviderData {
  cookies?: Record<string, string>;
  userId?: string;
  spaceId?: string;
}

function readProviderData(raw: string | null): NotionProviderData | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as NotionProviderData;
  } catch {
    return null;
  }
}

function pickAccount(db: Database.Database): Account | null {
  const accounts = listEnabledAccountsByProvider(db, 'notion');
  return accounts[0] ?? null;
}

function toAccountState(a: Account): AccountState {
  return {
    id: a.id,
    backoffLevel: a.backoff_level,
    rateLimitedUntil: a.rate_limited_until ?? null,
    lastError: a.last_error ? (JSON.parse(a.last_error) as AccountState['lastError']) : null,
    status: a.status as AccountState['status'],
    enabled: !!a.enabled,
  };
}

function cookieHeader(cookies: Record<string, string>): string {
  return NOTION_AI_COOKIE_NAMES.map((n) => `${n}=${cookies[n] ?? ''}`).join('; ');
}

function hasAllRequiredCookies(cookies: Record<string, string>): boolean {
  return NOTION_AI_COOKIE_NAMES.every(
    (n) => typeof cookies[n] === 'string' && cookies[n]!.length > 0
  );
}

function readOpenAIMessages(
  body: Record<string, unknown>
): Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> {
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const out: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const obj = m as Record<string, unknown>;
    const roleRaw = typeof obj.role === 'string' ? obj.role : 'user';
    const role: 'system' | 'user' | 'assistant' | 'tool' =
      roleRaw === 'system' || roleRaw === 'assistant' || roleRaw === 'tool' ? roleRaw : 'user';
    const content = typeof obj.content === 'string' ? obj.content : '';
    out.push({ role, content });
  }
  return out;
}

export async function handleNotionProxy(
  c: Context,
  format: 'openai' | 'anthropic',
  upstreamPath: string,
  body: Record<string, unknown>,
  db: Database.Database,
  cursorRef: CursorRef,
  stickyMap: Map<number, string>
): Promise<Response> {
  // v1: cursorRef + stickyMap + format all unused (no failover, text-only, OpenAI-format output only)
  void cursorRef;
  void stickyMap;
  void format;

  const clientKey = c.get('clientKey') as { id: number } | undefined;
  const startMs = Date.now();
  const reqId = genReqId();
  c.set('reqId', reqId);

  // Resolve the requested model up-front so the console flow carries the real
  // upstream id (and the alias when one is mapped). Unknown/disabled models
  // are tolerated — peek.provider already routed us here.
  let requestedModel: string | null = null;
  let upstreamModel = 'notion';
  let internalModelId = 'notion';
  try {
    const resolved = resolveModel(db, stringValue(body.model), body);
    requestedModel = resolved.requestedModel;
    upstreamModel = resolved.upstreamModel;
    internalModelId = resolved.upstreamModel;
  } catch {
    /* unknown/disabled — keep placeholder, request will surface a 400 later */
  }
  // augment (caveman + cache_control) + RTK parity — notion branches before
  // the dispatcher's augment/RTK block. bodyTransform is a no-op for notion
  // (NDJSON wire format; ADAPTIVE_THINKING won't match).
  const allSettings = getAllSettings(db);
  const caveman = allSettings.caveman as { level: string } | undefined;
  const caching = allSettings.caching as
    | { autoBreakpoints: boolean; respectCallerMarkers: boolean }
    | undefined;
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
  const aliasForFlow = requestedModel && requestedModel !== upstreamModel ? requestedModel : null;
  consoleBus.emit(
    buildStart(
      reqId,
      new Date().toISOString(),
      c.req.method,
      upstreamPath,
      upstreamModel,
      aliasForFlow
    )
  );

  // Shared helper — write a log row + emit error event, then return a JSON 4xx/5xx.
  const failAndLog = (
    statusCodeVal: number,
    errorKey: 'no_account' | 'notion_reauth_required' | 'upstream_error',
    message: string,
    accountId: string
  ): Response => {
    consoleBus.emit(buildError(reqId, new Date().toISOString(), statusCodeVal, message));
    const ctx: LogRowContext = {
      clientKeyId: clientKey?.id ?? 0,
      accountId,
      model: upstreamModel,
      requestedModel: requestedModel ?? upstreamModel,
      endpoint: upstreamPath,
      format: 'openai',
      promptTokens: 0,
      completionTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      latencyMs: Date.now() - startMs,
      statusCode: statusCodeVal,
      baseRespCode: undefined,
      stream: body.stream ? 1 : 0,
      rtkBytesSaved: rtkSaved,
      requestBody: JSON.stringify(body),
      responseBody: message,
      requestHeaders: c.req.raw.headers,
      responseHeaders: new Headers(),
      reqId,
    };
    insertRequestLogDeferred(db, buildLogRow(ctx));
    return c.json(
      { error: errorKey, message },
      statusCodeVal as unknown as Parameters<typeof c.json>[1]
    );
  };

  const account = pickAccount(db);
  if (!account) {
    return failAndLog(503, 'no_account', 'no enabled notion account', '0');
  }

  const providerData = readProviderData(account.provider_data);
  if (!providerData?.cookies || !hasAllRequiredCookies(providerData.cookies)) {
    updateAccount(db, account.id, {
      status: 'error',
      last_error: JSON.stringify({
        status: 401,
        message: 'missing required cookies',
        timestamp: new Date().toISOString(),
      }),
    });
    const msg = `notion account ${account.id} missing required cookies; re-run notion-add-account`;
    return failAndLog(401, 'notion_reauth_required', msg, account.id);
  }

  const spaceId = providerData.spaceId;
  if (!spaceId) {
    updateAccount(db, account.id, {
      status: 'error',
      last_error: JSON.stringify({
        status: 401,
        message: 'missing spaceId',
        timestamp: new Date().toISOString(),
      }),
    });
    const msg = `notion account ${account.id} missing spaceId; re-add account to refresh`;
    return failAndLog(401, 'notion_reauth_required', msg, account.id);
  }

  // Pre-fetch model-lock gate: refuse before paying the upstream round-trip.
  if (assertModelNotLocked(db, account.id, upstreamModel)) {
    return failAndLog(
      429,
      'upstream_error',
      `model ${upstreamModel} temporarily locked`,
      account.id
    );
  }

  consoleBus.emit(buildAccount(reqId, new Date().toISOString(), account.label, 'round-robin'));

  const openaiMessages = readOpenAIMessages(body);
  const { body: notionBody } = buildNotionPayload({
    openaiMessages,
    internalModelId,
    spaceId,
  });

  let upstream: Response;
  try {
    upstream = await fetch(`${NOTION_BASE}/api/v3/runInferenceTranscript`, {
      method: 'POST',
      headers: {
        'notion-client-version': NOTION_CLIENT_VERSION,
        accept: 'application/x-ndjson',
        'content-type': 'application/json',
        cookie: cookieHeader(providerData.cookies),
      },
      body: notionBody,
    });
  } catch (e) {
    const msg = `notion upstream network error: ${errorMessage(e)}`;
    log.warn({ reqId, accountId: account.id, err: errorMessage(e) }, msg);
    return failAndLog(502, 'upstream_error', msg, account.id);
  }

  if (!upstream.ok) {
    const status = upstream.status;
    const isFatal = NOTION_FATAL_STATUSES.has(status);
    log.warn(
      { reqId, accountId: account.id, status, fatal: isFatal },
      `notion upstream HTTP ${status}`
    );
    const errBody = await upstream.text();
    handleUpstreamError(db, {
      account,
      acc: toAccountState(account),
      status,
      errBody,
      response: upstream,
      upstreamModel,
    });
    const message = `notion HTTP ${status}`;
    if (status === 401 || status === 403) {
      return failAndLog(401, 'notion_reauth_required', message, account.id);
    }
    return failAndLog(status, 'upstream_error', message, account.id);
  }

  // Convert NDJSON stream → OpenAI SSE stream
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let emittedDone = false;
        for await (const delta of extractNotionStream(upstream)) {
          if (delta.done) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  id: `chatcmpl-${reqId}`,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: internalModelId,
                  choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                })}\n\ndata: [DONE]\n\n`
              )
            );
            emittedDone = true;
            break;
          }
          if (delta.toolCall) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  id: `chatcmpl-${reqId}`,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: internalModelId,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        tool_calls: [
                          {
                            index: 0,
                            id: delta.toolCall.id,
                            type: 'function',
                            function: {
                              name: delta.toolCall.name,
                              arguments: delta.toolCall.arguments,
                            },
                          },
                        ],
                      },
                      finish_reason: null,
                    },
                  ],
                })}\n\n`
              )
            );
            continue;
          }
          if (delta.delta) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  id: `chatcmpl-${reqId}`,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: internalModelId,
                  choices: [{ index: 0, delta: { content: delta.delta }, finish_reason: null }],
                })}\n\n`
              )
            );
          }
        }
        if (!emittedDone) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        }
        insertRequestLogDeferred(
          db,
          buildLogRow({
            clientKeyId: clientKey?.id ?? 0,
            accountId: account.id,
            model: internalModelId,
            requestedModel: requestedModel ?? stringValue(body.model),
            endpoint: upstreamPath,
            format: 'openai',
            promptTokens: 0,
            completionTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            totalTokens: 0,
            costUsd: 0,
            latencyMs: Date.now() - startMs,
            statusCode: 200,
            baseRespCode: undefined,
            stream: 1,
            rtkBytesSaved: rtkSaved,
            requestBody: JSON.stringify(body),
            responseBody: null,
            requestHeaders: c.req.raw.headers,
            responseHeaders: new Headers(),
            reqId,
          })
        );
        // Notion's NDJSON stream does not surface token counts — log 0/0
        // and cost 0. Keeps parity with Pioneer/Kiro happy-path emissions.
        consoleBus.emit(
          buildDone(reqId, new Date().toISOString(), 200, null, 0, 0, 0, 0, Date.now() - startMs, 0)
        );
        controller.close();
      } catch (e) {
        const msg = errorMessage(e);
        log.error({ reqId, err: msg }, 'notion stream error');
        consoleBus.emit(buildError(reqId, new Date().toISOString(), 502, msg));
        insertRequestLogDeferred(
          db,
          buildLogRow({
            clientKeyId: clientKey?.id ?? 0,
            accountId: account.id,
            model: internalModelId,
            requestedModel: requestedModel ?? stringValue(body.model),
            endpoint: upstreamPath,
            format: 'openai',
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
            requestBody: JSON.stringify(body),
            responseBody: msg,
            requestHeaders: c.req.raw.headers,
            responseHeaders: new Headers(),
            reqId,
          })
        );
        controller.error(e);
      }
    },
  });

  return new Response(readable, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
}

// Re-export for tests
export { cookieHeader, hasAllRequiredCookies, NOTION_LOGIN_COOKIE_NAMES, pickAccount };
