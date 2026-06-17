import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPassword } from './auth/password.js';
import { openDb } from './db/index.js';
import { createAccount } from './db/repos/accounts.js';
import { createClientKey } from './db/repos/client_keys.js';
import { upsertModel } from './db/repos/models.js';
import { flushDeferredLogs } from './db/repos/requestLogs.js';
import { clearCache } from './db/repos/settings.js';
import { app, emitSecurityWarnings, resetDb } from './server.js';
import { log } from './util/log.js';

interface LoggedRequestRow {
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  client_key_id: number | null;
}

interface SentAnthropicRequest {
  system: Array<{ text?: string; cache_control?: { type: string } }>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /health', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'h-')), 't.db');
    resetDb();
  });

  it('returns ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });
});

describe('handleProxy with auth + accounts', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ha-')), 't.db');
    resetDb();
  });

  it('401 when no auth', async () => {
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(401);
  });

  it('401 when invalid client key', async () => {
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer rk_invalid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(401);
  });

  it('503 when no upstream accounts', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'lonely', key: 'rk_lonely' });
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(503);
  });

  it('uses account api_key when account present', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'u', key: 'rk_test' });
    createAccount(db, { id: 'acc_x', label: 'L', credit_type: 'payg', api_key: 'mm_real_key' });
    upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3', provider: 'minimax' });
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('{"choices":[{"message":{"content":"x"}}]}', { status: 200 })
      );
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'mm/MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer mm_real_key');
  });

  it('isolates logs by client key: two different keys produce separate log rows', async () => {
    const db = openDb();
    const ck1 = createClientKey(db, { label: 'app1', key: 'rk_1' });
    const ck2 = createClientKey(db, { label: 'app2', key: 'rk_2' });
    createAccount(db, { id: 'acc_i', label: 'L', credit_type: 'payg', api_key: 'k' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('{"choices":[{"message":{"content":"x"}}]}', { status: 200 })
    );
    upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3', provider: 'minimax' });
    for (const ck of [ck1, ck2]) {
      const res = await app.request(
        new Request('http://localhost/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'mm/MiniMax-M3',
            messages: [{ role: 'user', content: 'hi' }],
          }),
        })
      );
      expect(res.status, `request for ${ck.label}`).toBe(200);
    }
    await flushDeferredLogs();
    const logs = db
      .prepare(`SELECT client_key_id, COUNT(*) as n FROM request_logs GROUP BY client_key_id`)
      .all() as { client_key_id: number; n: number }[];
    expect(logs).toEqual([
      { client_key_id: ck1.id, n: 1 },
      { client_key_id: ck2.id, n: 1 },
    ]);
  });
});

describe('model resolution in proxy', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'mr-')), 't.db');
    resetDb();
  });

  it('injects adaptive thinking for MiniMax-M3', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'u', key: 'rk_t' });
    createAccount(db, { id: 'acc_z', label: 'L', credit_type: 'payg', api_key: 'kk' });
    upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3', provider: 'minimax' });
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('{"choices":[{"message":{"content":"x"}}]}', { status: 200 })
      );
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mm/MiniMax-M3',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    const sentBody = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(sentBody.model).toBe('MiniMax-M3');
    expect(sentBody.thinking).toEqual({ type: 'adaptive' });
    expect(sentBody.reasoning_split).toBe(true);
  });

  it('400 on unknown model', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'u', key: 'rk_t' });
    createAccount(db, { id: 'acc_y', label: 'L', credit_type: 'payg', api_key: 'kk' });
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'totally-fake', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(400);
  });
});

describe('request logging', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'rl-')), 't.db');
    resetDb();
  });

  it('logs non-stream request with cost + client_key_id', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'u', key: 'rk_log' });
    createAccount(db, { id: 'a1', label: 'L', credit_type: 'payg', api_key: 'kk' });
    upsertModel(db, {
      name: 'MiniMax-M2.7',
      upstream_model: 'MiniMax-M2.7',
      display_name: 'MiniMax M2.7',
      family: 'm2.7',
      context_window: 204800,
      pricing_input: 0.3,
      pricing_output: 1.2,
      pricing_cache_read: 0.06,
      pricing_cache_write: 0.375,
      source: 'builtin',
      provider: 'minimax',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'x',
          model: 'MiniMax-M2.7',
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }),
        { status: 200 }
      )
    );
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mm/MiniMax-M2.7',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    await app.request(req);
    await flushDeferredLogs();
    const logs = db.prepare(`SELECT * FROM request_logs`).all() as LoggedRequestRow[];
    expect(logs.length).toBe(1);
    expect(logs[0].prompt_tokens).toBe(100);
    expect(logs[0].completion_tokens).toBe(50);
    expect(logs[0].cost_usd).toBeGreaterThan(0);
    expect(logs[0].client_key_id).toBe(ck.id);
  });

  it('logs stream request with usage extracted from final SSE chunk', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'u', key: 'rk_stream' });
    createAccount(db, { id: 'a1', label: 'L', credit_type: 'payg', api_key: 'kk' });
    upsertModel(db, {
      name: 'MiniMax-M2.7',
      upstream_model: 'MiniMax-M2.7',
      display_name: 'MiniMax M2.7',
      family: 'm2.7',
      context_window: 204800,
      pricing_input: 0.3,
      pricing_output: 1.2,
      pricing_cache_read: 0.06,
      pricing_cache_write: 0.375,
      source: 'builtin',
      provider: 'minimax',
    });
    const sse = [
      `data: {"choices":[{"delta":{"content":"hi"}}]}\n\n`,
      `data: {"choices":[],"usage":{"prompt_tokens":42,"completion_tokens":7,"total_tokens":49}}\n\n`,
      `data: [DONE]\n\n`,
    ].join('');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    );
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mm/MiniMax-M2.7',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    await res.text();
    await flushDeferredLogs();
    const logs = db
      .prepare(`SELECT * FROM request_logs WHERE stream = 1`)
      .all() as LoggedRequestRow[];
    expect(logs.length).toBe(1);
    expect(logs[0].prompt_tokens).toBe(42);
    expect(logs[0].completion_tokens).toBe(7);
  });
});

describe('augmentation in proxy', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'aug-')), 't.db');
    resetDb();
    clearCache();
  });

  it('caveman=terse: Anthropic request gets caveman injected into system', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'u', key: 'rk_aug' });
    createAccount(db, { id: 'acc_a', label: 'L', credit_type: 'payg', api_key: 'kk' });
    upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3', provider: 'minimax' });
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'caveman'`).run('{"level":"terse"}');
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"content":[{"type":"text","text":"x"}]}', { status: 200 }));
    const req = new Request('http://localhost/v1/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mm/MiniMax-M3',
        max_tokens: 100,
        system: 'you are helpful',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    const [, options] = spy.mock.calls[0] as [string, { body: string }];
    const sent = JSON.parse(options.body) as SentAnthropicRequest;
    expect(sent.system[0].text).toContain('Be concise');
  });

  it('caching=autoBreakpoints: Anthropic request gets cache marker', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'u', key: 'rk_cache' });
    createAccount(db, { id: 'acc_b', label: 'L', credit_type: 'payg', api_key: 'kk' });
    upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3', provider: 'minimax' });
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'caching'`).run(
      JSON.stringify({ autoBreakpoints: true, respectCallerMarkers: true })
    );
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"content":[{"type":"text","text":"x"}]}', { status: 200 }));
    const req = new Request('http://localhost/v1/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mm/MiniMax-M3',
        max_tokens: 100,
        system: 'you are helpful',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    const [, options] = spy.mock.calls[0] as [string, { body: string }];
    const sent = JSON.parse(options.body) as SentAnthropicRequest;
    expect(sent.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('/v1/embeddings', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'emb-')), 't.db');
    resetDb();
  });

  it('returns 501 not implemented (MiniMax has no embeddings endpoint)', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'u', key: 'rk_emb' });
    const res = await app.request('/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'MiniMax-M3', input: 'hi' }),
    });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toContain('embeddings not supported');
  });
});

describe('cross-format proxy (OpenAI client → Anthropic upstream)', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'xf-')), 't.db');
    resetDb();
  });

  it('transforms OpenAI tools to Anthropic when override forces anthropic upstream', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'u', key: 'rk_xf' });
    createAccount(db, { id: 'acc_xf', label: 'L', credit_type: 'payg', api_key: 'kk' });
    upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3', provider: 'minimax' });
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('minimax', ?)`).run(
      JSON.stringify({ upstreamFormat: 'anthropic' })
    );
    clearCache();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const sent = JSON.parse((init as RequestInit).body as string);
      // Verify body was converted to Anthropic shape
      expect(sent.tools).toEqual([
        {
          name: 'get_weather',
          input_schema: { type: 'object', properties: { loc: { type: 'string' } } },
        },
      ]);
      expect(sent.tool_choice).toEqual({ type: 'auto' });
      return new Response(
        JSON.stringify({
          id: 'x',
          type: 'message',
          role: 'assistant',
          model: 'MiniMax-M3',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mm/MiniMax-M3',
        messages: [{ role: 'user', content: 'weather in SF?' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              parameters: { type: 'object', properties: { loc: { type: 'string' } } },
            },
          },
        ],
        tool_choice: 'auto',
      }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Response should be converted back to OpenAI shape
    expect(body.choices[0].message.content).toBe('ok');
    expect(body.choices[0].finish_reason).toBe('stop');
  });
});

describe('OpenAI stream auto include_usage', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'iu-')), 't.db');
    resetDb();
  });

  it('injects stream_options.include_usage=true when client omitted it', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'u', key: 'rk_iu' });
    createAccount(db, { id: 'acc_iu', label: 'L', credit_type: 'payg', api_key: 'kk' });
    upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3', provider: 'minimax' });
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const sent = JSON.parse((init as RequestInit).body as string);
      expect(sent.stream_options).toEqual({ include_usage: true });
      return new Response(
        '{"choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}',
        { status: 200 }
      );
    });
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mm/MiniMax-M3',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    await app.request(req);
    expect(spy).toHaveBeenCalled();
  });

  it('does NOT overwrite explicit include_usage=false', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'u', key: 'rk_iu2' });
    createAccount(db, { id: 'acc_iu2', label: 'L', credit_type: 'payg', api_key: 'kk' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const sent = JSON.parse((init as RequestInit).body as string);
      expect(sent.stream_options.include_usage).toBe(false);
      return new Response('{"choices":[{"message":{"content":"ok"}}]}', { status: 200 });
    });
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'MiniMax-M3',
        stream: true,
        stream_options: { include_usage: false },
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    await app.request(req);
  });
});

describe('provider prefix routing', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'pfx-')), 't.db');
    resetDb();
  });

  it('mm/<minimax model> → minimax path taken, 200', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'u', key: 'rk_pfx1' });
    createAccount(db, { id: 'acc_pfx1', label: 'L', credit_type: 'payg', api_key: 'mm_key' });
    upsertModel(db, {
      name: 'MiniMax-M3',
      upstream_model: 'MiniMax-M3',
      display_name: 'MiniMax M3',
      provider: 'minimax',
    });

    let capturedUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, _init) => {
      capturedUrl = String(url);
      return new Response('{"choices":[{"message":{"content":"ok"}}]}', { status: 200 });
    });

    const res = await app.request(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mm/MiniMax-M3',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      })
    );
    expect(res.status).toBe(200);
    expect(capturedUrl).toContain('minimax');
  });

  it('kr/<kiro model> → kiro path taken (503 no kiro accounts, not minimax error)', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'u', key: 'rk_pfx2' });
    // MiniMax account present; if routing falls to MiniMax it would use this key.
    createAccount(db, { id: 'acc_pfx2', label: 'L', credit_type: 'payg', api_key: 'mm_key' });
    upsertModel(db, {
      name: 'kiro-model-x',
      upstream_model: 'kiro-model-x',
      display_name: 'Kiro Model X',
      provider: 'kiro',
    });

    // No kiro accounts configured → kiro handler returns 503 with kiro-specific error.
    // If routing wrongly goes to MiniMax, the mock would be called with minimax URL.
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, _init) => {
      // Should NOT be called — kiro handler short-circuits before upstream fetch.
      return new Response(`{"choices":[{"message":{"content":"mm fallback: ${String(url)}"}}]}`, {
        status: 200,
      });
    });

    const res = await app.request(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'kr/kiro-model-x',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      })
    );
    // Kiro handler returns 503 when no kiro accounts. MiniMax would return 200 from mock.
    expect(res.status).toBe(503);
    expect(spy).not.toHaveBeenCalled();
    const body = await res.json();
    expect(String(body.error)).toMatch(/kiro/i);
  });

  it('mm/<kiro model> (provider mismatch) → 400 with error matching /provider/', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'u', key: 'rk_pfx3' });
    createAccount(db, { id: 'acc_pfx3', label: 'L', credit_type: 'payg', api_key: 'mm_key' });
    upsertModel(db, {
      name: 'kiro-model-x',
      upstream_model: 'kiro-model-x',
      display_name: 'Kiro Model X',
      provider: 'kiro',
    });

    const res = await app.request(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mm/kiro-model-x',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(String(body.error)).toMatch(/provider/);
  });

  it('xx/foo (unknown prefix) → 400 with error matching /unknown model prefix/', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'u', key: 'rk_pfx4' });
    createAccount(db, { id: 'acc_pfx4', label: 'L', credit_type: 'payg', api_key: 'mm_key' });

    const res = await app.request(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'xx/foo',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(String(body.error)).toMatch(/unknown model prefix/);
  });

  it('bare raw model name (not an alias) → 400 with error matching /unknown model/', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'u', key: 'rk_pfx5' });
    createAccount(db, { id: 'acc_pfx5', label: 'L', credit_type: 'payg', api_key: 'mm_key' });
    // Seed MiniMax-M3 as a real model but NOT as an alias — bare name hits alias path → throws.
    upsertModel(db, {
      name: 'MiniMax-M3',
      upstream_model: 'MiniMax-M3',
      display_name: 'MiniMax M3',
      provider: 'minimax',
    });

    const res = await app.request(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'MiniMax-M3',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(String(body.error)).toMatch(/unknown model/);
  });
});

describe('codebuddy direct routing', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'cb-')), 't.db');
    resetDb();
  });

  it('routes codebuddy model directly to CodeBuddy upstream, not MiniMax', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'u', key: 'rk_cb' });
    createAccount(db, {
      id: 'acc_cb',
      label: 'CodeBuddy Test',
      credit_type: 'token-plan',
      api_key: 'cb_test_key',
      provider: 'codebuddy',
      enabled: true,
    });
    upsertModel(db, {
      name: 'claude-opus-4.6',
      upstream_model: 'claude-opus-4.6',
      display_name: 'CodeBuddy Claude Opus 4.6',
      family: 'codebuddy',
      context_window: 1000000,
      pricing_input: 0,
      pricing_output: 0,
      pricing_cache_read: 0,
      pricing_cache_write: 0,
      source: 'builtin',
      provider: 'codebuddy',
    });

    let capturedUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, _init) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 3 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    const req = new Request('http://localhost/v1/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'cb/claude-opus-4.6',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 10,
      }),
    });
    const res = await app.request(req);
    expect(res.status, `expected 200 but got ${res.status}`).toBe(200);
    expect(capturedUrl).toContain('codebuddy.ai');
    expect(capturedUrl).not.toContain('minimax');
  });
});

describe('emitSecurityWarnings (boot-time)', () => {
  const origKey = process.env.ROUTER_DB_KEY;

  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'sw-')), 't.db');
    resetDb();
    delete process.env.ROUTER_DB_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (origKey === undefined) delete process.env.ROUTER_DB_KEY;
    else process.env.ROUTER_DB_KEY = origKey;
  });

  it('warns for open mode AND unencrypted DB (both insecure)', () => {
    const db = openDb();
    const spy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    emitSecurityWarnings(db);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(
      { event: 'security.open_mode' },
      'Open mode: no admin password set. Anyone with network access can use this router.'
    );
    expect(spy).toHaveBeenCalledWith(
      { event: 'security.db_unencrypted' },
      'ROUTER_DB_KEY not set: SQLite file is unencrypted at rest.'
    );
  });

  it('warns only for open mode when DB is encrypted (ROUTER_DB_KEY set)', () => {
    process.env.ROUTER_DB_KEY = 'a-real-key';
    const db = openDb();
    const spy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    emitSecurityWarnings(db);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      { event: 'security.open_mode' },
      'Open mode: no admin password set. Anyone with network access can use this router.'
    );
  });

  it('warns only for unencrypted DB when password is set', () => {
    const db = openDb();
    setPassword(db, 'a-real-password');
    const spy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    emitSecurityWarnings(db);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      { event: 'security.db_unencrypted' },
      'ROUTER_DB_KEY not set: SQLite file is unencrypted at rest.'
    );
  });

  it('emits no warnings when both password and ROUTER_DB_KEY are set', () => {
    process.env.ROUTER_DB_KEY = 'a-real-key';
    const db = openDb();
    setPassword(db, 'a-real-password');
    const spy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    emitSecurityWarnings(db);
    expect(spy).not.toHaveBeenCalled();
  });
});
