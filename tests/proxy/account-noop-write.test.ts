import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { createAccount, updateAccount } from '../../src/db/repos/accounts.js';
import { createClientKey, genClientKey } from '../../src/db/repos/client_keys.js';
import { upsertModel } from '../../src/db/repos/models.js';
import { app, resetDb } from '../../src/server.js';

let key: string;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'noop-')), 't.db');
  resetDb();
  const db = openDb();
  upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3' });
  createAccount(db, { id: 'acc_1', label: 'a', credit_type: 'payg', api_key: 'mm_x' });
  key = genClientKey();
  createClientKey(db, { label: 'app', key });
  db.close();
});

afterEach(() => vi.restoreAllMocks());

describe('account no-op write guard', () => {
  it('does not UPDATE accounts when the account is already clean', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    );

    const realPrepare = Database.prototype.prepare;
    let accountUpdates = 0;
    vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (
      this: Database.Database,
      sql: string
    ) {
      const stmt = realPrepare.call(this, sql);
      if (/UPDATE accounts/i.test(sql)) {
        const origRun = (stmt as Database.Statement).run.bind(stmt);
        (stmt as Database.Statement).run = (...args: unknown[]) => {
          accountUpdates++;
          return origRun(...(args as Parameters<typeof origRun>));
        };
      }
      return stmt;
    });

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'mm/MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(200);
    expect(accountUpdates).toBe(0);
  });

  it('DOES UPDATE accounts exactly once when the account is dirty', async () => {
    // Make the account dirty so the success-path reset must fire.
    const db = openDb();
    updateAccount(db, 'acc_1', {
      backoff_level: 3,
      status: 'active',
      rate_limited_until: null,
      last_error: null,
    });
    db.close();

    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    );

    const realPrepare = Database.prototype.prepare;
    let accountUpdates = 0;
    vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (
      this: Database.Database,
      sql: string
    ) {
      const stmt = realPrepare.call(this, sql);
      if (/UPDATE accounts/i.test(sql)) {
        const origRun = (stmt as Database.Statement).run.bind(stmt);
        (stmt as Database.Statement).run = (...args: unknown[]) => {
          accountUpdates++;
          return origRun(...(args as Parameters<typeof origRun>));
        };
      }
      return stmt;
    });

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'mm/MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(200);
    expect(accountUpdates).toBe(1);
  });
});
