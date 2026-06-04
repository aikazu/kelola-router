import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, expect, it, vi } from 'vitest';
import { openDb } from '../db/index.js';
import { _resetLockCleanupThrottle, clearExpiredModelLocks } from './locks.js';

let db: ReturnType<typeof openDb>;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'lock-')), 't.db');
  db = openDb();
  _resetLockCleanupThrottle();
});

it('runs the DELETE at most once within the throttle window', () => {
  const realPrepare = Database.prototype.prepare;
  let deletes = 0;
  const spy = vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (
    this: Database.Database,
    sql: string
  ) {
    const stmt = realPrepare.call(this, sql) as Database.Statement & {
      run: (...args: unknown[]) => unknown;
    };
    if (/DELETE FROM account_model_locks/i.test(sql)) {
      const origRun = stmt.run.bind(stmt);
      stmt.run = (...args: unknown[]) => {
        deletes++;
        return origRun(...args);
      };
    }
    return stmt;
  });

  try {
    clearExpiredModelLocks(db);
    clearExpiredModelLocks(db);
    clearExpiredModelLocks(db);
    expect(deletes).toBe(1);
  } finally {
    spy.mockRestore();
  }
});
