import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('request body size cap', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'bs-')), 't.db');
    resetDb();
    clearCache();
    const db = openDb();
    const _ck = createClientKey(db, { label: 't', key: 'rk_bs' });
    createAccount(db, { id: 'acc_bs', label: 'a1', credit_type: 'payg', api_key: 'mm_test' });
    upsertModel(db, { name: 'MiniMax-M2.7', upstream_model: 'MiniMax-M2.7', provider: 'minimax' });
    setSetting(db, 'transport', { relay: null, proxy: null });
    clearCache();
  });

  it('rejects body over 10MB with 413', async () => {
    const big = 'x'.repeat(11 * 1024 * 1024);
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: 'Bearer rk_bs',
        'content-type': 'application/json',
        'content-length': String(big.length),
      },
      body: big,
    });
    const res = await app.request(req);
    expect(res.status).toBe(413);
  });

  it('accepts body under 10MB', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    );
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer rk_bs', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'mx/MiniMax-M2.7',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    const res = await app.request(req);
    expect([200, 502]).toContain(res.status);
  });
});
