import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { createAccount, updateAccount } from '../../src/db/repos/accounts.js';
import { createClientKey } from '../../src/db/repos/client_keys.js';
import { upsertModel } from '../../src/db/repos/models.js';
import { clearCache, setSetting } from '../../src/db/repos/settings.js';
import { app, resetDb } from '../../src/server.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('proxy uses applyErrorState centrally', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'aes-')), 't.db');
    resetDb();
    clearCache();
  });

  it('resets account backoff to 0 on 200 success', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 't', key: 'rk_aes' });
    const acc = createAccount(db, {
      id: 'acc_aes',
      label: 'a1',
      credit_type: 'payg',
      api_key: 'mm_test',
    });
    upsertModel(db, { name: 'MiniMax-M2.7', upstream_model: 'MiniMax-M2.7', provider: 'minimax' });
    setSetting(db, 'transport', { relay: null, proxy: null });
    clearCache();

    // Pre-set backoff to verify reset on success (not rate_limited_until — that would make account unavailable)
    updateAccount(db, acc.id, { backoff_level: 3 });

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
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

    const row = db
      .prepare(`SELECT backoff_level, rate_limited_until FROM accounts WHERE id = ?`)
      .get(acc.id) as { backoff_level: number; rate_limited_until: string | null };
    expect(row.backoff_level).toBe(0);
    expect(row.rate_limited_until).toBeNull();
  });

  it('bumps backoff and sets rate_limited_until on 429 baseResp 1002', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 't', key: 'rk_aes2' });
    const acc = createAccount(db, {
      id: 'acc_aes2',
      label: 'a1',
      credit_type: 'payg',
      api_key: 'mm_test',
    });
    upsertModel(db, { name: 'MiniMax-M2.7', upstream_model: 'MiniMax-M2.7', provider: 'minimax' });
    setSetting(db, 'transport', { relay: null, proxy: null });
    clearCache();

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ base_resp: { status_code: 1002 }, message: 'rate' }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        })
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

    const row = db
      .prepare(`SELECT backoff_level, rate_limited_until FROM accounts WHERE id = ?`)
      .get(acc.id) as { backoff_level: number; rate_limited_until: string | null };
    expect(row.backoff_level).toBeGreaterThan(0);
    expect(row.rate_limited_until).toBeTruthy();
  });
});
