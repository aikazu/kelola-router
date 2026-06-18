import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { createAccount } from '../../src/db/repos/accounts.js';
import { createClientKey } from '../../src/db/repos/client_keys.js';
import { upsertModel } from '../../src/db/repos/models.js';
import { app, resetDb } from '../../src/server.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('proxy uses parseError to surface windowResetMs', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'pe-')), 't.db');
    resetDb();
  });

  it('applies windowResetMs cooldown when upstream returns 2056 with model_remains', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 't', key: 'rk_pe' });
    const acc = createAccount(db, {
      id: 'acc_pe',
      label: 'a1',
      credit_type: 'payg',
      api_key: 'mm_test',
    });
    upsertModel(db, { name: 'MiniMax-M2.7', upstream_model: 'MiniMax-M2.7', provider: 'minimax' });

    const endTime = Date.now() + 30_000;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            base_resp: { status_code: 2056, msg: 'window exhausted' },
            model_remains: [{ end_time: endTime }],
          }),
          { status: 429, headers: { 'content-type': 'application/json' } }
        )
    );

    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mx/MiniMax-M2.7',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(429);

    const row = db
      .prepare(`SELECT rate_limited_until, backoff_level FROM accounts WHERE id = ?`)
      .get(acc.id) as { rate_limited_until: string | null; backoff_level: number };
    expect(row.rate_limited_until).toBeTruthy();
    const untilMs = new Date(row.rate_limited_until!).getTime();
    expect(untilMs - Date.now()).toBeGreaterThan(25_000);
  });

  it('applies retryAfterSec cooldown when Retry-After header present', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 't', key: 'rk_ra' });
    const acc = createAccount(db, {
      id: 'acc_ra',
      label: 'a1',
      credit_type: 'payg',
      api_key: 'mm_test',
    });
    upsertModel(db, { name: 'MiniMax-M2.7', upstream_model: 'MiniMax-M2.7', provider: 'minimax' });

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: 'rate limit' }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '45' },
        })
    );

    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mx/MiniMax-M2.7',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(429);

    const row = db.prepare(`SELECT rate_limited_until FROM accounts WHERE id = ?`).get(acc.id) as {
      rate_limited_until: string | null;
    };
    expect(row.rate_limited_until).toBeTruthy();
    const untilMs = new Date(row.rate_limited_until!).getTime();
    expect(untilMs - Date.now()).toBeGreaterThan(40_000);
  });
});
