import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../db/index.js';
import { createAccount } from '../../db/repos/accounts.js';
import { app, resetDb } from '../../server.js';

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
