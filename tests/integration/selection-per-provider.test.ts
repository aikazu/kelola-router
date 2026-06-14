import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { createAccount } from '../../src/db/repos/accounts.js';
import { createClientKey } from '../../src/db/repos/client_keys.js';
import { enableModel, upsertModel } from '../../src/db/repos/models.js';
import { flushDeferredLogs, recentLogs } from '../../src/db/repos/requestLogs.js';
import { clearCache, setSetting } from '../../src/db/repos/settings.js';
import { clearAliasCache } from '../../src/providers/aliasCache.js';
import { _resetSelectionCursorForTests, app, resetDb } from '../../src/server.js';

let dir: string;
let clientKey: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sel-provider-'));
  process.env.ROUTER_DB_PATH = join(dir, 't.db');
  resetDb();
  clearCache();
  _resetSelectionCursorForTests();
  const db = openDb();
  upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3' });
  enableModel(db, 'MiniMax-M3');
  createAccount(db, { id: 'acc1', label: 'a1', credit_type: 'payg', api_key: 'mm_1' });
  createAccount(db, { id: 'acc2', label: 'a2', credit_type: 'payg', api_key: 'mm_2' });
  const ck = createClientKey(db, { label: 't', key: 'ck_sel_1' });
  clientKey = ck.key;
  setSetting(db, 'transport', { relay: null, proxy: null });
  setSetting(db, 'selection.minimax', { mode: 'round-robin', step: 2 });
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

const okUpstream = () =>
  new Response(
    JSON.stringify({
      id: 'x',
      model: 'MiniMax-M3',
      choices: [{ message: { role: 'assistant', content: 'ok' }, index: 0, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { headers: { 'content-type': 'application/json' } }
  );

const fire = () =>
  app.request(
    new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${clientKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'mm/MiniMax-M3',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
      }),
    })
  );

describe('per-provider selection settings', () => {
  it('selection.minimax round-robin step=2 groups requests in pairs', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okUpstream());

    for (let i = 0; i < 4; i++) {
      const res = await fire();
      expect(res.status).toBe(200);
    }

    await flushDeferredLogs();
    const logs = recentLogs(openDb(), { limit: 4 });
    // recentLogs returns newest first; reverse to chronological order.
    const ids = logs.map((l) => l.account_id).reverse();
    // cursors 0,1,2,3 with step=2 -> idx 0,0,1,1
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).toBe(ids[3]);
    expect(ids[0]).not.toBe(ids[2]);
  });

  it('legacy global selection key is ignored', async () => {
    const db = openDb();
    // Old key says round-robin; per-provider key absent -> default lowest-backoff.
    setSetting(db, 'selection', { mode: 'round-robin' });
    setSetting(db, 'selection.minimax', { mode: 'lowest-backoff', step: 1 });
    clearCache();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okUpstream());

    for (let i = 0; i < 3; i++) {
      const res = await fire();
      expect(res.status).toBe(200);
    }

    await flushDeferredLogs();
    const logs = recentLogs(openDb(), { limit: 3 });
    // lowest-backoff with equal backoff levels always picks the same (first) account.
    const ids = new Set(logs.map((l) => l.account_id));
    expect(ids.size).toBe(1);
  });
});
