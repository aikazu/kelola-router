import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../index.js';
import {
  createClientKey,
  deleteClientKey,
  disableClientKey,
  enableClientKey,
  genClientKey,
  getClientKeyByKey,
} from './client_keys.js';

let db: ReturnType<typeof openDb>;

describe('client key lookup cache', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ck-')), 't.db');
    db = openDb();
  });

  afterEach(() => {
    delete process.env.ROUTER_DB_PATH;
  });

  it('serves repeated lookups from cache (no second SELECT within TTL)', () => {
    const key = genClientKey();
    createClientKey(db, { label: 'app', key });
    getClientKeyByKey(db, key); // primes cache

    const realPrepare = Database.prototype.prepare;
    let selects = 0;
    const spy = vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (
      this: unknown,
      sql: string
    ) {
      const stmt = realPrepare.call(this as Database.Database, sql);
      if (/SELECT \* FROM client_keys WHERE key/i.test(sql)) {
        const origGet = (stmt as Database.Statement).get.bind(stmt);
        (stmt as Database.Statement & { get: (...args: unknown[]) => unknown }).get = (
          ...args: unknown[]
        ) => {
          selects++;
          return origGet(...(args as Parameters<typeof origGet>));
        };
      }
      return stmt;
    });
    try {
      expect(getClientKeyByKey(db, key)?.key).toBe(key);
      expect(selects).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('invalidates the cache on delete', () => {
    const key = genClientKey();
    const created = createClientKey(db, { label: 'app', key });
    expect(getClientKeyByKey(db, key)?.key).toBe(key); // primes cache
    deleteClientKey(db, created.id);
    expect(getClientKeyByKey(db, key)).toBeNull();
  });

  it('invalidates the cache on disable (disabled key no longer returned)', () => {
    const key = genClientKey();
    const created = createClientKey(db, { label: 'app', key });
    expect(getClientKeyByKey(db, key)?.key).toBe(key); // primes cache
    disableClientKey(db, created.id);
    expect(getClientKeyByKey(db, key)).toBeNull();
  });

  it('invalidates the cache on enable (re-enabled key visible immediately)', () => {
    const key = genClientKey();
    const created = createClientKey(db, { label: 'app', key });
    disableClientKey(db, created.id);
    expect(getClientKeyByKey(db, key)).toBeNull(); // primes negative cache
    enableClientKey(db, created.id);
    expect(getClientKeyByKey(db, key)?.key).toBe(key);
  });

  it('clears negative cache so a newly created key is visible immediately', () => {
    const key = genClientKey();
    expect(getClientKeyByKey(db, key)).toBeNull(); // negative-caches the miss
    createClientKey(db, { label: 'app', key });
    expect(getClientKeyByKey(db, key)?.key).toBe(key);
  });
});
