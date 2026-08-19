// src/proxy/combo.console.test.ts
// TDD (Task B3): a combo request must stay a single console thread. The combo
// handler generates a reqId + emits buildStart, then delegates to a provider
// handler. Before the fix the delegated leg regenerated its own reqId, so the
// console showed two disconnected threads for one combo request.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consoleBus } from '../console/bus.js';
import { openDb } from '../db/index.js';
import { createAccount } from '../db/repos/accounts.js';
import { createCombo } from '../db/repos/combos.js';
import { upsertModel } from '../db/repos/models.js';
import { app, resetDb } from '../server.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'co-')), 't.db');
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

describe('handleComboProxy console thread', () => {
  it('keeps one reqId thread across combo + delegated provider', async () => {
    const db = openDb();
    createAccount(db, {
      id: 'cb1',
      label: 'CB',
      credit_type: 'payg',
      api_key: 'cb_k',
      provider: 'codebuddy',
    });
    upsertModel(db, {
      name: 'codebuddy/claude-opus',
      upstream_model: 'claude-opus',
      provider: 'codebuddy',
      source: 'fetched',
      enabled: 1,
    });
    createCombo(db, 'mycombo', ['cb/claude-opus']);
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
        model: 'mycombo',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    const reqIds = new Set(
      (emitSpy.mock.calls as unknown as Array<Array<{ reqId: string }>>).map((c) => c[0].reqId)
    );
    expect(reqIds.size).toBe(1);
  });
});
