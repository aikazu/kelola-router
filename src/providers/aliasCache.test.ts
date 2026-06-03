import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '../db/migrations/index.js';
import { upsertAlias } from '../db/repos/aliases.js';
import { upsertModel } from '../db/repos/models.js';
import { clearAliasCache, resolveAlias } from './aliasCache.js';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'alias-cache-'));
  db = new Database(join(dir, 't.db'));
  db.pragma('foreign_keys = ON');
  migrate(db);
  upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3' });
  upsertModel(db, { name: 'MiniMax-M2.7', upstream_model: 'MiniMax-M2.7' });
  clearAliasCache();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true });
  vi.useRealTimers();
});

describe('aliasCache', () => {
  it('returns input unchanged for unknown name', () => {
    expect(resolveAlias(db, 'MiniMax-M3')).toBe('MiniMax-M3');
    expect(resolveAlias(db, 'totally-unknown')).toBe('totally-unknown');
  });

  it('resolves alias to its target', () => {
    upsertAlias(db, { aliasName: 'claude-opus-4-8', upstreamModel: 'MiniMax-M3' });
    clearAliasCache();
    expect(resolveAlias(db, 'claude-opus-4-8')).toBe('MiniMax-M3');
  });

  it('caches: second call does not re-query DB', () => {
    upsertAlias(db, { aliasName: 'a1', upstreamModel: 'MiniMax-M3' });
    clearAliasCache();
    resolveAlias(db, 'a1');
    // Mutate DB; cache should still return stale value
    db.prepare(`DELETE FROM model_aliases WHERE alias_name = 'a1'`).run();
    expect(resolveAlias(db, 'a1')).toBe('MiniMax-M3');
  });

  it('clearAliasCache forces a reload', () => {
    upsertAlias(db, { aliasName: 'a1', upstreamModel: 'MiniMax-M3' });
    resolveAlias(db, 'a1'); // warm cache
    db.prepare(`DELETE FROM model_aliases WHERE alias_name = 'a1'`).run();
    clearAliasCache();
    expect(resolveAlias(db, 'a1')).toBe('a1');
  });

  it('TTL expiry forces a reload', () => {
    upsertAlias(db, { aliasName: 'a1', upstreamModel: 'MiniMax-M3' });
    resolveAlias(db, 'a1'); // warm cache
    db.prepare(`DELETE FROM model_aliases WHERE alias_name = 'a1'`).run();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31_000); // past 30s TTL
    expect(resolveAlias(db, 'a1')).toBe('a1');
  });
});
