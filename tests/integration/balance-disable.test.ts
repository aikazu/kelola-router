import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { createAccount } from '../../src/db/repos/accounts.js';
import { createClientKey } from '../../src/db/repos/client_keys.js';
import { upsertModel } from '../../src/db/repos/models.js';
import { clearCache, setSetting } from '../../src/db/repos/settings.js';
import { app, resetDb } from '../../src/server.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('balance error (1008) disables account', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'bal-')), 't.db');
    resetDb();
    clearCache();
    const db = openDb();
    createClientKey(db, { label: 't', key: 'rk_bal' });
    createAccount(db, { id: 'acc_bal', label: 'a1', credit_type: 'payg', api_key: 'mm_test' });
    upsertModel(db, { name: 'MiniMax-M2.7', upstream_model: 'MiniMax-M2.7' });
    setSetting(db, 'transport', { relay: null, proxy: null });
    clearCache();
  });

  it('disables account when upstream returns baseResp 1008 (insufficient balance)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ base_resp: { status_code: 1008, msg: 'insufficient balance' } }),
          { status: 400, headers: { 'content-type': 'application/json' } }
        )
    );
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer rk_bal', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'MiniMax-M2.7', messages: [{ role: 'user', content: 'hi' }] }),
    });
    await app.request(req);
    const row = openDb()
      .prepare(`SELECT enabled, status FROM accounts WHERE id = ?`)
      .get('acc_bal') as { enabled: number; status: string };
    expect(row.enabled).toBe(0);
  });
});
