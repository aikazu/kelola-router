// src/proxy/minimax.reqId.test.ts
// TDD (Task B5+B6): minimax handleProxy must (a) set reqId before model
// resolution so the outer catch never emits a '----' reqId, and (b) emit
// buildStart BEFORE account selection (matching kiro/codebuddy/pioneer/combo).
// Before the fix, genReqId()/c.set('reqId') lived at line ~263 — after account
// selection + model resolution — so an early throw left reqId unset and the
// catch fell back to '----'; buildStart also fired after selection.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consoleBus } from '../console/bus.js';
import { openDb } from '../db/index.js';
import { createAccount } from '../db/repos/accounts.js';
import { upsertModel } from '../db/repos/models.js';
import { app, resetDb } from '../server.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'mrid-')), 't.db');
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

describe('handleProxy minimax reqId + buildStart ordering', () => {
  it('sets reqId before model resolution so the catch never sees ----', async () => {
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
    // Force the outer catch (fetch throws) — reqId must already be set so the
    // error event doesn't carry '----'.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'));
    const emitSpy = vi.spyOn(consoleBus, 'emit');
    const key = seedClientKey(db);

    await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'mx/MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] }),
    });

    const errorEvents = (
      emitSpy.mock.calls as unknown as Array<Array<{ phase: string; reqId: string }>>
    )
      .map((c) => c[0])
      .filter((e) => e.phase === 'error');
    expect(errorEvents.length).toBeGreaterThan(0);
    expect(errorEvents[0].reqId).not.toBe('----');
  });

  it('emits buildStart before buildAccount', async () => {
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    );
    const emitSpy = vi.spyOn(consoleBus, 'emit');
    const key = seedClientKey(db);

    await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'mx/MiniMax-M3',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    const phases = (emitSpy.mock.calls as unknown as Array<Array<{ phase: string }>>).map(
      (c) => c[0].phase
    );
    const startIdx = phases.indexOf('start');
    const accountIdx = phases.indexOf('account');
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(accountIdx).toBeGreaterThan(startIdx);
  });
});
