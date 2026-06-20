import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { createAccount } from '../../src/db/repos/accounts.js';
import { createClientKey, genClientKey } from '../../src/db/repos/client_keys.js';
import { createCombo } from '../../src/db/repos/combos.js';
import { upsertModel } from '../../src/db/repos/models.js';
import { flushDeferredLogs, recentLogs } from '../../src/db/repos/requestLogs.js';
import { setSetting } from '../../src/db/repos/settings.js';
import { clearAliasCache } from '../../src/providers/aliasCache.js';
import { app, resetDb } from '../../src/server.js';

let key: string;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'combo-'));
  process.env.ROUTER_DB_PATH = join(dir, 't.db');
  resetDb();
  const db = openDb();
  // Use minimax-prefixed combo members with bare model names so the
  // parseModelPrefix path finds the rows (bare combo names would route
  // through the alias path; the bare path is for client-side aliases, not
  // combo internals).
  upsertModel(db, {
    name: 'MiniMax-M3',
    upstream_model: 'MiniMax-M3',
    provider: 'minimax',
    enabled: 1,
  });
  upsertModel(db, {
    name: 'MiniMax-M2',
    upstream_model: 'MiniMax-M2',
    provider: 'minimax',
    enabled: 1,
  });
  clearAliasCache();
  createCombo(db, 'combo1', ['mx/MiniMax-M3', 'mx/MiniMax-M2']);
  setSetting(db, 'caveman', { level: 'off' });
  setSetting(db, 'caching', { autoBreakpoints: false });
  setSetting(db, 'rtk', { enabled: false });
  setSetting(db, 'minimax', { upstreamFormat: 'openai' });
  setSetting(db, 'transport', { relay: null, proxy: null });
  createAccount(db, { id: 'acc_1', label: 'a', credit_type: 'payg', api_key: 'mm_x' });
  key = genClientKey();
  createClientKey(db, { label: 'app', key });
  db.close();
});
afterEach(async () => {
  await flushDeferredLogs();
  vi.restoreAllMocks();
  resetDb();
  delete process.env.ROUTER_DB_PATH;
});

describe('combo error-path logging', () => {
  it('writes a request_log row for a non-retryable upstream error', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: 'bad request' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
    );
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'combo1', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(400);
    await flushDeferredLogs();
    const logs = recentLogs(openDb(), { limit: 10 });
    // A request_log row must exist for the failed combo MiniMax attempt.
    expect(logs.some((l) => l.status_code === 400 && l.account_id === 'acc_1')).toBe(true);
  });
});

describe('combo requested_model fix', () => {
  it('logs requested_model as the pre-alias member model, not the combo name', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    );
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'combo1', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(200);
    await flushDeferredLogs();
    const db = openDb();
    const logs = recentLogs(db, { limit: 5 });
    db.close();
    const row = logs[0];
    expect(row?.requested_model).toBe('mx/MiniMax-M3');
    expect(row?.requested_model).not.toBe('combo1');
  });
});
