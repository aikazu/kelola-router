import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../../src/db/migrations/index.js';
import {
  AliasConflictError,
  deleteAlias,
  getAlias,
  listAliases,
  listAliasesForTargets,
  upsertAlias,
} from '../../../src/db/repos/aliases.js';
import { upsertModel } from '../../../src/db/repos/models.js';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'alias-repo-'));
  db = new Database(join(dir, 't.db'));
  db.pragma('foreign_keys = ON');
  migrate(db);
  upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3' });
  upsertModel(db, { name: 'MiniMax-M2.7', upstream_model: 'MiniMax-M2.7' });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true });
});

describe('aliases repo', () => {
  it('upsertAlias inserts new row and returns it', () => {
    const row = upsertAlias(db, { aliasName: 'claude-opus-4-8', upstreamModel: 'MiniMax-M3' });
    expect(row.aliasName).toBe('claude-opus-4-8');
    expect(row.upstreamModel).toBe('MiniMax-M3');
    expect(row.source).toBe('user');
    expect(row.createdAt).toBeTruthy();
  });

  it('upsertAlias overwrites existing alias with same name', () => {
    upsertAlias(db, { aliasName: 'a1', upstreamModel: 'MiniMax-M3' });
    const row = upsertAlias(db, { aliasName: 'a1', upstreamModel: 'MiniMax-M2.7' });
    expect(row.upstreamModel).toBe('MiniMax-M2.7');
    expect(listAliases(db)).toHaveLength(1);
  });

  it('upsertAlias accepts null label', () => {
    const row = upsertAlias(db, { aliasName: 'a1', upstreamModel: 'MiniMax-M3', label: null });
    expect(row.label).toBeNull();
  });

  it('upsertAlias rejects alias name that collides with a real model name', () => {
    expect(() => upsertAlias(db, { aliasName: 'MiniMax-M3', upstreamModel: 'MiniMax-M3' })).toThrow(
      AliasConflictError
    );
  });

  it('getAlias returns null for missing', () => {
    expect(getAlias(db, 'nope')).toBeNull();
  });

  it('getAlias returns row for hit', () => {
    upsertAlias(db, { aliasName: 'a1', upstreamModel: 'MiniMax-M3' });
    expect(getAlias(db, 'a1')?.upstreamModel).toBe('MiniMax-M3');
  });

  it('listAliases returns all rows', () => {
    upsertAlias(db, { aliasName: 'a1', upstreamModel: 'MiniMax-M3' });
    upsertAlias(db, { aliasName: 'a2', upstreamModel: 'MiniMax-M2.7' });
    const rows = listAliases(db);
    expect(rows).toHaveLength(2);
  });

  it('deleteAlias returns true on hit, false on miss', () => {
    upsertAlias(db, { aliasName: 'a1', upstreamModel: 'MiniMax-M3' });
    expect(deleteAlias(db, 'a1')).toBe(true);
    expect(deleteAlias(db, 'nope')).toBe(false);
  });

  it('listAliasesForTargets groups by upstream_model', () => {
    upsertAlias(db, { aliasName: 'a1', upstreamModel: 'MiniMax-M3' });
    upsertAlias(db, { aliasName: 'a2', upstreamModel: 'MiniMax-M3' });
    upsertAlias(db, { aliasName: 'a3', upstreamModel: 'MiniMax-M2.7' });
    const grouped = listAliasesForTargets(db, ['MiniMax-M3', 'MiniMax-M2.7']);
    expect(grouped['MiniMax-M3']).toHaveLength(2);
    expect(grouped['MiniMax-M2.7']).toHaveLength(1);
  });

  it('listAliasesForTargets with empty input returns empty object', () => {
    upsertAlias(db, { aliasName: 'a1', upstreamModel: 'MiniMax-M3' });
    expect(listAliasesForTargets(db, [])).toEqual({});
  });
});
