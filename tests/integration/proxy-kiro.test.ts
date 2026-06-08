import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { createAccount, updateAccount } from '../../src/db/repos/accounts.js';
import { createClientKey } from '../../src/db/repos/client_keys.js';
import { enableModel, upsertModel } from '../../src/db/repos/models.js';
import { flushDeferredLogs, recentLogs } from '../../src/db/repos/requestLogs.js';
import { clearCache, setSetting } from '../../src/db/repos/settings.js';
import { clearAliasCache } from '../../src/providers/aliasCache.js';
import { app, resetDb } from '../../src/server.js';

let dir: string;
let clientKey: string;

/** Build a single AWS event-stream frame (string :event-type header + JSON payload, zeroed CRCs). */
function frame(eventType: string, payload: unknown): Uint8Array {
  const enc = new TextEncoder();
  const name = enc.encode(':event-type');
  const value = enc.encode(eventType);
  const headerLen = 1 + name.length + 1 + 2 + value.length;
  const header = new Uint8Array(headerLen);
  const hv = new DataView(header.buffer);
  let o = 0;
  header[o++] = name.length;
  header.set(name, o);
  o += name.length;
  header[o++] = 7;
  hv.setUint16(o, value.length, false);
  o += 2;
  header.set(value, o);
  const body = enc.encode(payload === undefined ? '' : JSON.stringify(payload));
  const total = 12 + headerLen + body.length + 4;
  const buf = new Uint8Array(total);
  const v = new DataView(buf.buffer);
  v.setUint32(0, total, false);
  v.setUint32(4, headerLen, false);
  buf.set(header, 12);
  buf.set(body, 12 + headerLen);
  return buf;
}

function kiroStream(frames: Uint8Array[]): Uint8Array {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const f of frames) {
    out.set(f, off);
    off += f.length;
  }
  return out;
}

const HELLO_STREAM = () =>
  kiroStream([
    frame('assistantResponseEvent', { content: 'Hello' }),
    frame('assistantResponseEvent', { content: ' world' }),
    frame('metricsEvent', { inputTokens: 10, outputTokens: 2 }),
    frame('messageStopEvent', {}),
  ]);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'proxy-kiro-'));
  process.env.ROUTER_DB_PATH = join(dir, 't.db');
  resetDb();
  clearCache();
  const db = openDb();
  upsertModel(db, {
    name: 'claude-sonnet-4-5',
    upstream_model: 'claude-sonnet-4-5',
    provider: 'kiro',
  });
  enableModel(db, 'claude-sonnet-4-5');
  createAccount(db, {
    id: 'kiro1',
    label: 'k',
    credit_type: 'payg',
    api_key: 'refresh_tok',
    provider: 'kiro',
    provider_data: JSON.stringify({ authMethod: 'social' }),
  });
  // Pre-seed a fresh access token so ensureAccessToken does NOT hit the refresh endpoint.
  updateAccount(db, 'kiro1', {
    access_token: 'at_fresh',
    token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
  });
  const ck = createClientKey(db, { label: 't', key: 'ck_kiro_1' });
  clientKey = ck.key;
  setSetting(db, 'transport', { relay: null, proxy: null });
  clearCache();
  clearAliasCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetDb();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows WAL lock; temp dir auto-cleaned */
  }
  delete process.env.ROUTER_DB_PATH;
});

describe('Kiro proxy path', () => {
  it('routes an OpenAI non-stream request to Kiro and returns a chat.completion', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(HELLO_STREAM()));

    const res = await app.request(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${clientKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          messages: [{ role: 'user', content: 'hi' }],
          stream: false,
        }),
      })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      object: string;
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number };
    };
    expect(json.object).toBe('chat.completion');
    expect(json.choices[0]!.message.content).toBe('Hello world');
    expect(json.usage.prompt_tokens).toBe(10);

    // Upstream called once, at the CodeWhisperer endpoint (token was fresh → no refresh call).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('codewhisperer');

    await flushDeferredLogs();
    const logs = recentLogs(openDb(), { limit: 1 });
    expect(logs[0]?.model).toBe('claude-sonnet-4-5');
  });

  it('streams OpenAI SSE chunks for an OpenAI streaming request', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(HELLO_STREAM()));
    const res = await app.request(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${clientKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          messages: [{ role: 'user', content: 'hi' }],
          stream: true,
        }),
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('chat.completion.chunk');
    expect(text).toContain('Hello');
    expect(text).toContain('data: [DONE]');
  });

  it('streams Anthropic Messages SSE for a /v1/messages streaming request', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(HELLO_STREAM()));
    const res = await app.request(
      new Request('http://localhost/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': clientKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 256,
          messages: [{ role: 'user', content: 'hi' }],
          stream: true,
        }),
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('event: message_start');
    expect(text).toContain('text_delta');
    expect(text).toContain('Hello');
    expect(text).toContain('event: message_stop');
  });

  it('returns 503 when no Kiro account is enabled', async () => {
    const db = openDb();
    db.prepare(`UPDATE accounts SET enabled = 0 WHERE id = 'kiro1'`).run();
    const res = await app.request(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${clientKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      })
    );
    expect(res.status).toBe(503);
  });
});
