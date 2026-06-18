// src/proxy/minimax.errorlog.test.ts
// TDD (Task B4): minimax must write a request_logs row on the upstream-error
// path (HTTP non-2xx), mirroring CodeBuddy/Pioneer/Notion. Before this fix the
// `!resp.ok` branch in minimax.ts emitted buildError + returned without ever
// calling insertRequestLogDeferred, so failed MiniMax requests never appeared
// in the Request log.
//
// Note on the 200+base_resp quirk: MiniMax sometimes returns HTTP 200 with a
// base_resp.status_code != 0 body. In the proxy path that case is NOT treated
// as an error (no base_resp-driven branch exists, unlike modelHealth.ts) and
// silently flows through as a success. This test targets the actual upstream-
// error branch (`!resp.ok`) by returning HTTP 429 — a real MiniMax rate-limit.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../db/index.js';
import { createAccount } from '../db/repos/accounts.js';
import { upsertModel } from '../db/repos/models.js';
import { flushDeferredLogs } from '../db/repos/requestLogs.js';
import { app, resetDb } from '../server.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'mm-')), 't.db');
  process.env.ROUTER_ADMIN_KEY = 'ak_test';
  resetDb();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function seedClientKey(db: ReturnType<typeof openDb>): string {
  db.prepare(
    `INSERT INTO client_keys (label, key, enabled, created_at) VALUES ('app', 'rk_test_key', 1, datetime('now'))`
  ).run();
  return 'rk_test_key';
}

describe('handleProxy minimax error-path log row', () => {
  it('writes a request_logs row when upstream returns an HTTP error', async () => {
    const db = openDb();
    createAccount(db, {
      id: 'mm1',
      label: 'MM',
      credit_type: 'payg',
      api_key: 'mm_k',
      provider: 'minimax',
    });
    upsertModel(db, {
      name: 'MiniMax-M3',
      upstream_model: 'MiniMax-M3',
      provider: 'minimax',
      source: 'manual',
      enabled: 1,
    });
    // MiniMax rate-limit surfaces as HTTP 429 — hits the `!resp.ok` branch.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ base_resp: { status_code: 1002, status_msg: 'rate limited' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      })
    );
    const key = seedClientKey(db);

    await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'mx/MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] }),
    });
    // Deferred log inserts are batched off the response path; flush before reading.
    await flushDeferredLogs();

    const logs = db.prepare('SELECT status_code, base_resp_code FROM request_logs').all() as {
      status_code: number;
      base_resp_code: number | null;
    }[];
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0]!.status_code).toBe(429);
  });
});
