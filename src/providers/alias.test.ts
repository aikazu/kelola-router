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
  upsertModel(db, {
    name: 'kiro-claude',
    upstream_model: 'kiro-claude',
    provider: 'kiro',
  });
  clearAliasCache();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true });
});

describe('resolveModel — prefixed', () => {
  it('resolves a prefixed minimax model and keeps the full requestedModel', () => {
    const r = resolveModel(db, 'mm/MiniMax-M3', {});
    expect(r.upstreamModel).toBe('MiniMax-M3');
    expect(r.provider).toBe('minimax');
    expect(r.requestedModel).toBe('mm/MiniMax-M3');
  });

  it('resolves a prefixed kiro model', () => {
    const r = resolveModel(db, 'kr/kiro-claude', {});
    expect(r.upstreamModel).toBe('kiro-claude');
    expect(r.provider).toBe('kiro');
    expect(r.requestedModel).toBe('kr/kiro-claude');
  });

  it('does NOT expand aliases after a prefix', () => {
    upsertAlias(db, { aliasName: 'opus', upstreamModel: 'MiniMax-M3' });
    clearAliasCache();
    expect(() => resolveModel(db, 'mm/opus', {})).toThrow(/unknown model/);
  });

  it('throws on provider mismatch', () => {
    expect(() => resolveModel(db, 'mm/kiro-claude', {})).toThrow(/provider/);
  });

  it('resolves a clean prefix to a provider-namespaced row when the bare name clashes', () => {
    // Kiro owns the bare `claude-opus-4-8`; Pioneer stores its own under
    // `pioneer/claude-opus-4-8`. `pio/claude-opus-4-8` must reach the Pioneer row.
    upsertModel(db, { name: 'claude-opus-4-8', upstream_model: 'claude-opus-4-8', provider: 'kiro' });
    upsertModel(db, {
      name: 'pioneer/claude-opus-4-8',
      upstream_model: 'pioneer/claude-opus-4-8',
      provider: 'pioneer',
    });
    clearAliasCache();
    const r = resolveModel(db, 'pio/claude-opus-4-8', {});
    expect(r.provider).toBe('pioneer');
    expect(r.upstreamModel).toBe('pioneer/claude-opus-4-8');
    // And the clashing bare name still routes to Kiro under its own prefix.
    expect(resolveModel(db, 'kr/claude-opus-4-8', {}).provider).toBe('kiro');
  });

  it('throws on a prefixed unknown model', () => {
    expect(() => resolveModel(db, 'kr/does-not-exist', {})).toThrow(/unknown model/);
  });

  it('throws on a disabled prefixed model', () => {
    disableModel(db, 'MiniMax-M3');
    expect(() => resolveModel(db, 'mm/MiniMax-M3', {})).toThrow(/model disabled/);
  });
});

describe('resolveModel — bare (strict)', () => {
  it('rejects a bare raw model name', () => {
    expect(() => resolveModel(db, 'MiniMax-M3', {})).toThrow(/unknown model/);
  });

  it('resolves a bare alias and returns the original alias as requestedModel', () => {
    upsertAlias(db, { aliasName: 'claude-opus-4-8', upstreamModel: 'MiniMax-M3' });
    clearAliasCache();
    const r = resolveModel(db, 'claude-opus-4-8', {});
    expect(r.upstreamModel).toBe('MiniMax-M3');
    expect(r.provider).toBe('minimax');
    expect(r.requestedModel).toBe('claude-opus-4-8');
  });

  it('routes a bare alias by the target model provider', () => {
    upsertAlias(db, { aliasName: 'kalias', upstreamModel: 'kiro-claude' });
    clearAliasCache();
    const r = resolveModel(db, 'kalias', {});
    expect(r.provider).toBe('kiro');
  });

  it('throws for an unknown alias target', () => {
    db.pragma('foreign_keys = OFF');
    db.prepare(`INSERT INTO model_aliases (alias_name, upstream_model) VALUES (?, ?)`).run(
      'broken',
      'does-not-exist'
    );
    db.pragma('foreign_keys = ON');
    clearAliasCache();
    expect(() => resolveModel(db, 'broken', {})).toThrow(/unknown model/);
  });

  it('throws for a disabled model reached via a bare alias', () => {
    upsertAlias(db, { aliasName: 'opus', upstreamModel: 'MiniMax-M3' });
    clearAliasCache();
    disableModel(db, 'MiniMax-M3');
    expect(() => resolveModel(db, 'opus', {})).toThrow(/model disabled/);
  });
});

describe('resolveModel — unknown prefix', () => {
  it('throws for a non-provider slash prefix', () => {
    expect(() => resolveModel(db, 'xx/foo', {})).toThrow(/unknown model prefix/);
  });
});

describe('resolveModel — bodyTransform', () => {
  it('injects adaptive thinking for known models when client omits thinking', () => {
    const r = resolveModel(db, 'mm/MiniMax-M3', {});
    const body: Record<string, unknown> = {};
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: 'adaptive' });
  });

  it('preserves client-supplied thinking', () => {
    const r = resolveModel(db, 'mm/MiniMax-M3', {});
    const body: Record<string, unknown> = { thinking: { type: 'enabled' } };
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: 'enabled' });
  });
});
