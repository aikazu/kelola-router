import type Database from 'better-sqlite3';
import type { Statement } from 'better-sqlite3';

const cache = new WeakMap<Database.Database, Map<string, Statement>>();

/**
 * Per-DB prepared-statement cache. `db.prepare()` is cheap but allocates a
 * new `Statement` on every call; this cache lets hot repo functions reuse the
 * same compiled SQL object across the lifetime of the db handle.
 */
export function cachedStmt(db: Database.Database, sql: string): Statement {
  let perDb = cache.get(db);
  if (!perDb) {
    perDb = new Map();
    cache.set(db, perDb);
  }
  let s = perDb.get(sql);
  if (!s) {
    s = db.prepare(sql);
    perDb.set(sql, s);
  }
  return s;
}
