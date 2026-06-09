import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { applyPragmas } from './migratePragmas.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'pg-')), 't.db');
});

describe('applyPragmas', () => {
  it('sets expected PRAGMAs on a file-backed db', () => {
    const db = new Database(join(mkdtempSync(join(tmpdir(), 'pg-')), 'p.db'));
    applyPragmas(db);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('temp_store', { simple: true })).toBe(2); // MEMORY
    const cs = db.pragma('cache_size', { simple: true }) as number;
    expect(cs).toBeLessThan(-1000); // negative = KB
    db.close();
  });

  it('is idempotent — calling twice does not throw', () => {
    const db = new Database(join(mkdtempSync(join(tmpdir(), 'pg-')), 'p.db'));
    applyPragmas(db);
    expect(() => applyPragmas(db)).not.toThrow();
    db.close();
  });
});
