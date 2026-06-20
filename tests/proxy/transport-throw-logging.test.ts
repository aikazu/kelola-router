import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { createAccount } from '../../src/db/repos/accounts.js';
import { createClientKey, genClientKey } from '../../src/db/repos/client_keys.js';
import { upsertModel } from '../../src/db/repos/models.js';
import { flushDeferredLogs, recentLogs } from '../../src/db/repos/requestLogs.js';
import { setSetting } from '../../src/db/repos/settings.js';
import { app, resetDb } from '../../src/server.js';

let key: string;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tt-mm-'));
  process.env.ROUTER_DB_PATH = join(dir, 't.db');
  resetDb();
  const db = openDb();
  upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3' });
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

describe('transport-throw logging (minimax)', () => {
  it('writes a 502 request_log row when upstream fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('getaddrinfo ENOTFOUND upstream.example');
    });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'mx/MiniMax-M3',
        messages: [{ role: 'user', content: 'hi' }],
        thinking: { type: 'adaptive' },
        max_completion_tokens: 131072,
        reasoning_split: true,
      }),
    });
    expect(res.status).toBe(502);
    await flushDeferredLogs();
    const logs = recentLogs(openDb(), { limit: 1 });
    expect(logs[0]?.status_code).toBe(502);
    expect(logs[0]?.model).toBe('MiniMax-M3');
    expect(logs[0]?.prompt_tokens).toBe(0);
  });
});
