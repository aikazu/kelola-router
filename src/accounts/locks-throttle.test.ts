import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, expect, it, vi } from 'vitest';
import { openDb } from '../db/index.js';
import { clearExpiredModelLocks, _resetLockCleanupThrottle } from './locks.js';

let db: ReturnType<typeof openDb>;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'lock-')), 't.db');
  db = openDb();
  _resetLockCleanupThrottle();
});

it('runs the DELETE at most once within the throttle window', () => {
  const realPrepare = Database.prototype.prepare;
  let deletes = 0;
  const spy = vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (this: any, sql: string) {
    const stmt = realPrepare.call(this, sql);
    if (/DELETE FROM account_model_locks/i.test(sql)) {
      const origRun = (stmt as any).run.bind(stmt);
      (stmt as any).run = (...args: unknown[]) => {
        deletes++;
        return origRun(...(args as Parameters<typeof origRun>));
      };
    }
    return stmt;
  });

  clearExpiredModelLocks(db);
  clearExpiredModelLocks(db);
  clearExpiredModelLocks(db);
  expect(deletes).toBe(1);
  spy.mockRestore();
});
