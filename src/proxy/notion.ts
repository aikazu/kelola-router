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
import type { Account } from '../db/repos/accounts.js';
import { listEnabledAccountsByProvider } from '../db/repos/accounts.js';
import { insertRequestLogDeferred } from '../db/repos/requestLogs.js';
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
import { log } from '../util/log.js';
import { errorMessage, stringValue } from './helpers.js';
import type { CursorRef } from './kiro.js';

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

function cookieHeader(cookies: Record<string, string>): string {
  return NOTION_AI_COOKIE_NAMES.map((n) => `${n}=${cookies[n] ?? ''}`).join('; ');
}

function hasAllRequiredCookies(cookies: Record<string, string>): boolean {
  return NOTION_AI_COOKIE_NAMES.every((n) => typeof cookies[n] === 'string' && cookies[n]!.length > 0);
}

function readOpenAIMessages(
  body: Record<string, unknown>,
): Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> {
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const out: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const obj = m as Record<string, unknown>;
    const roleRaw = typeof obj.role === 'string' ? obj.role : 'user';
    const role: 'system' | 'user' | 'assistant' | 'tool' =
      roleRaw === 'system' || roleRaw === 'assistant' || roleRaw === 'tool'
        ? roleRaw
        : 'user';
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
  stickyMap: Map<number, string>,
): Promise<Response> {
  // v1: cursorRef + stickyMap + format all unused (no failover, text-only, OpenAI-format output only)
  void cursorRef;
  void stickyMap;
  void format;

  const clientKey = c.get('clientKey') as { id: number } | undefined;
  const startMs = Date.now();
  const reqId = `notion-${startMs}-${Math.random().toString(36).slice(2, 8)}`;

  const account = pickAccount(db);
  if (!account) {
    return c.json({ error: 'no_account', message: 'no enabled notion account' }, 503);
  }

  const providerData = readProviderData(account.provider_data);
  if (!providerData?.cookies || !hasAllRequiredCookies(providerData.cookies)) {
    return c.json(
      {
        error: 'notion_reauth_required',
        message: `notion account ${account.id} missing required cookies; re-run notion-add-account`,
      },
      401
    );
  }

  const spaceId = providerData.spaceId;
  if (!spaceId) {
    return c.json(
      {
        error: 'notion_reauth_required',
        message: `notion account ${account.id} missing spaceId; re-add account to refresh`,
      },
      401
    );
  }

  const resolved = resolveModel(db, stringValue(body.model), body);
  const internalModelId = resolved.upstreamModel ?? stringValue(body.model);

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
    return c.json({ error: 'upstream_error', message: msg }, 502);
  }

  if (!upstream.ok) {
    const status = upstream.status;
    const isFatal = NOTION_FATAL_STATUSES.has(status);
    log.warn({ reqId, accountId: account.id, status, fatal: isFatal }, `notion upstream HTTP ${status}`);
    if (status === 401 || status === 403) {
      return c.json(
        { error: 'notion_reauth_required', message: `notion HTTP ${status}` },
        401 as unknown as Parameters<typeof c.json>[1]
      );
    }
    return c.json(
      { error: 'upstream_error', message: `notion HTTP ${status}` },
      status as unknown as Parameters<typeof c.json>[1]
    );
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
                  choices: [
                    { index: 0, delta: { content: delta.delta }, finish_reason: null },
                  ],
                })}\n\n`
              )
            );
          }
        }
        if (!emittedDone) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        }
        insertRequestLogDeferred(db, {
          client_key_id: clientKey?.id ?? null,
          account_id: account.id,
          model: internalModelId,
          requested_model: stringValue(body.model),
          endpoint: upstreamPath,
          format: 'openai',
          prompt_tokens: 0,
          completion_tokens: 0,
          cache_creation_tokens: 0,
          cache_read_tokens: 0,
          total_tokens: 0,
          cost_usd: 0,
          latency_ms: Date.now() - startMs,
          ttft_ms: null,
          status_code: 200,
          base_resp_code: null,
          stream: 1,
          relay_path: null,
          proxy_path: null,
          rtk_bytes_saved: 0,
          caveman_level: null,
          error_message: null,
          request_body: null,
          response_body: null,
          request_headers: null,
          response_headers: null,
          error: null,
          req_id: reqId,
        });
        controller.close();
      } catch (e) {
        const msg = errorMessage(e);
        log.error({ reqId, err: msg }, 'notion stream error');
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
export { pickAccount, hasAllRequiredCookies, cookieHeader, NOTION_LOGIN_COOKIE_NAMES };