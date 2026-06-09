import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from './db/index.js';
import { createAccount } from './db/repos/accounts.js';
import { createClientKey } from './db/repos/client_keys.js';
import { flushDeferredLogs } from './db/repos/requestLogs.js';
import { clearCache } from './db/repos/settings.js';
import { app, resetDb } from './server.js';

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
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('{"choices":[{"message":{"content":"x"}}]}', { status: 200 })
      );
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] }),
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
    for (const ck of [ck1, ck2]) {
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

describe('POST /admin/models/fetch', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'am-')), 't.db');
    resetDb();
  });

  it('open access when no password set (local dev mode)', async () => {
    delete process.env.ROUTER_ADMIN_KEY;
    const db = openDb();
    createAccount(db, { id: 'acc_open', label: 'L', credit_type: 'payg', api_key: 'k' });
    const res = await app.request('/admin/models/fetch', { method: 'POST' });
    // 302 = success redirect to /admin/models?fetched=N
    // 502 = upstream fetch failed (404 or 5xx)
    // 400 = no active account
    // NOT 401/503
    expect([302, 502, 400]).toContain(res.status);
  });

  it('401 when password set AND env key invalid', async () => {
    process.env.ROUTER_ADMIN_KEY = 'ak_test';
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
      JSON.stringify('scrypt:16384:00:00')
    );
    const res = await app.request('/admin/models/fetch', {
      method: 'POST',
      headers: { 'x-admin-key': 'wrong' },
    });
    expect(res.status).toBe(401);
  });

  it('redirects to /login on GET when password set + no session', async () => {
    delete process.env.ROUTER_ADMIN_KEY;
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
      JSON.stringify('scrypt:16384:00:00')
    );
    const res = await app.request('/admin');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });

  it('fetches from first active account and merges', async () => {
    process.env.ROUTER_ADMIN_KEY = 'ak_test';
    const db = openDb();
    createAccount(db, { id: 'acc_f', label: 'F', credit_type: 'payg', api_key: 'kk' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'MiniMax-M3' }, { id: 'MiniMax-newly' }] }), {
        status: 200,
      })
    );
    const res = await app.request('/admin/models/fetch', {
      method: 'POST',
      headers: { 'x-admin-key': 'ak_test' },
    });
    // 302 = success redirect to /admin/models?fetched=N
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/fetched=1/);
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
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('{"choices":[{"message":{"content":"x"}}]}', { status: 200 })
      );
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'MiniMax-M3',
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
      body: JSON.stringify({ model: 'MiniMax-M2.7', messages: [{ role: 'user', content: 'hi' }] }),
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
        model: 'MiniMax-M2.7',
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
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'caveman'`).run('{"level":"terse"}');
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"content":[{"type":"text","text":"x"}]}', { status: 200 }));
    const req = new Request('http://localhost/v1/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'MiniMax-M3',
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
        model: 'MiniMax-M3',
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

describe('SPA admin API endpoints', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'api-')), 't.db');
    resetDb();
  });

  it('/api/admin/overview returns 200 JSON', async () => {
    const res = await app.request('/api/admin/overview');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('stats');
    expect(body).toHaveProperty('byModel');
    expect(body).toHaveProperty('recent');
  });

  it('/api/admin/usage returns 200 JSON with summary + page', async () => {
    const res = await app.request('/api/admin/usage');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('summary');
    expect(body).toHaveProperty('page');
    expect(body.page).toHaveProperty('rows');
    expect(body.page).toHaveProperty('total');
    expect(body.page).toHaveProperty('page');
    expect(body.page).toHaveProperty('pageSize');
    expect(body.page).toHaveProperty('totalPages');
  });

  it('/api/admin/usage?days=0 returns all-time with null deltas', async () => {
    const db = openDb();
    const ins = (cost: number, daysAgo: number) => {
      db.prepare(`
        INSERT INTO request_logs
          (created_at, model, endpoint, format, prompt_tokens, completion_tokens,
           cache_creation_tokens, cache_read_tokens, total_tokens, cost_usd,
           latency_ms, status_code, stream, rtk_bytes_saved)
        VALUES (?, 'M', '/v1/x', 'openai', 1, 1, 0, 0, 2, ?, 1, 200, 0, 0)
      `).run(new Date(Date.now() - daysAgo * 86_400_000).toISOString(), cost);
    };
    ins(1, 0); // current window
    ins(2, 1.5); // previous 1-day window — would yield non-null delta at days=1
    // days=0 = all-time: no previous period, deltas must be null
    const res = await app.request('/api/admin/usage?days=0');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.deltaCostPct).toBeNull();
    expect(body.summary.deltaRequestsPct).toBeNull();
    expect(body.summary.deltaTokensPct).toBeNull();
    // sanity: all-time picks up both logs
    expect(body.summary.totalRequests).toBe(2);
  });

  it('/api/admin/overview?days=0 returns 200 JSON (all-time)', async () => {
    const res = await app.request('/api/admin/overview?days=0');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('stats');
  });

  it('/api/admin/client-keys/:id/key returns the full bearer key', async () => {
    const db = openDb();
    db.prepare(
      `INSERT INTO client_keys (label, key, enabled, created_at) VALUES ('app', 'rk_fullsecret123', 1, ?)`
    ).run(new Date(Date.now()).toISOString());
    const row = db.prepare(`SELECT id FROM client_keys WHERE label='app'`).get() as { id: number };
    const res = await app.request(`/api/admin/client-keys/${row.id}/key`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toBe('rk_fullsecret123');
  });

  it('/api/admin/client-keys/:id/key returns 404 for missing key', async () => {
    const res = await app.request('/api/admin/client-keys/99999/key');
    expect(res.status).toBe(404);
  });

  it('/api/admin/client-keys returns list (empty)', async () => {
    const res = await app.request('/api/admin/client-keys');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('/api/admin/accounts returns list (empty)', async () => {
    const res = await app.request('/api/admin/accounts');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('/api/admin/models returns list', async () => {
    const res = await app.request('/api/admin/models');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('/api/admin/quota returns list', async () => {
    const res = await app.request('/api/admin/quota');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('/api/admin/quota excludes legacy NULL-model snapshots', async () => {
    const db = openDb();
    const acct = createAccount(db, {
      id: 'acct-null-test',
      label: 'acct',
      credit_type: 'token-plan',
      api_key: 'mm_x',
    });
    const ins = db.prepare(
      `INSERT INTO quota_snapshots (account_id, source, model_name, total_count, remaining_count, used_count, remaining_percent, remains_time, window_type, window_start, window_end, raw_response)
       VALUES (?, 'test', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`
    );
    // Legacy rows: model_name NULL, no percent.
    ins.run(acct.id, null, null, null, 0, null, null, '5h');
    ins.run(acct.id, null, null, null, 0, null, null, 'weekly');
    // Real rows: named model with percent.
    ins.run(acct.id, 'general', 0, 0, 0, 99, 1000, '5h');
    ins.run(acct.id, 'general', 0, 0, 0, 87, 1000, 'weekly');

    const res = await app.request('/api/admin/quota');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      accountId: string;
      windows: Array<{ modelName: string }>;
    }>;
    const acctRow = body.find((q) => q.accountId === acct.id);
    expect(acctRow).toBeDefined();
    // Only the two named windows survive — no NULL-derived duplicate "general" pair.
    expect(acctRow?.windows.length).toBe(2);
  });

  it('/api/admin/settings returns 200 with all keys', async () => {
    const res = await app.request('/api/admin/settings');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('caveman');
    expect(body).toHaveProperty('caching');
    expect(body).toHaveProperty('rtk');
    expect(body).toHaveProperty('minimax');
  });

  it('/api/me returns passwordSet/authed', async () => {
    const res = await app.request('/api/me');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('passwordSet');
    expect(body).toHaveProperty('authed');
  });

  it('/admin/usage redirects to / (SPA handles routing)', async () => {
    const res = await app.request('/admin/usage');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
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
        model: 'MiniMax-M3',
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
        model: 'MiniMax-M3',
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
