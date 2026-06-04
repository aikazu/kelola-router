import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../db/migrations/index.js';
import { upsertAlias } from '../db/repos/aliases.js';
import { disableModel, upsertModel } from '../db/repos/models.js';
import { resolveModel } from './alias.js';
import { clearAliasCache } from './aliasCache.js';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'alias-'));
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
});

describe('resolveModel', () => {
  it('resolves direct name and returns requestedModel = input', () => {
    const r = resolveModel(db, 'MiniMax-M3', {});
    expect(r.upstreamModel).toBe('MiniMax-M3');
    expect(r.requestedModel).toBe('MiniMax-M3');
  });

  it('resolves alias and returns requestedModel = original alias', () => {
    upsertAlias(db, { aliasName: 'claude-opus-4-8', upstreamModel: 'MiniMax-M3' });
    clearAliasCache();
    const r = resolveModel(db, 'claude-opus-4-8', {});
    expect(r.upstreamModel).toBe('MiniMax-M3');
    expect(r.requestedModel).toBe('claude-opus-4-8');
  });

  it('throws for unknown direct name', () => {
    expect(() => resolveModel(db, 'does-not-exist', {})).toThrow(/unknown model/);
  });

  it('throws for unknown alias target', () => {
    // FK prevents the repo from creating this row, so insert directly with
    // the FK bypassed. Models a stale alias left behind by a rename/delete.
    db.pragma('foreign_keys = OFF');
    db.prepare(`INSERT INTO model_aliases (alias_name, upstream_model) VALUES (?, ?)`).run(
      'broken',
      'does-not-exist'
    );
    db.pragma('foreign_keys = ON');
    clearAliasCache();
    expect(() => resolveModel(db, 'broken', {})).toThrow(/unknown model/);
  });

  it('throws for disabled target model', () => {
    disableModel(db, 'MiniMax-M3');
    expect(() => resolveModel(db, 'MiniMax-M3', {})).toThrow(/model disabled/);
  });

  it('throws for disabled target model reached via alias', () => {
    upsertAlias(db, { aliasName: 'opus', upstreamModel: 'MiniMax-M3' });
    clearAliasCache();
    disableModel(db, 'MiniMax-M3');
    expect(() => resolveModel(db, 'opus', {})).toThrow(/model disabled/);
  });

  it('bodyTransform injects adaptive thinking for known models when client omits thinking', () => {
    const r = resolveModel(db, 'MiniMax-M3', {});
    const body: any = {};
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: 'adaptive' });
  });

  it('bodyTransform preserves client-supplied thinking', () => {
    const r = resolveModel(db, 'MiniMax-M3', {});
    const body: any = { thinking: { type: 'disabled' } };
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: 'disabled' });
  });
});
