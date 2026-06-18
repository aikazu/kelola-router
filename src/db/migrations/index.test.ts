import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../index.js';
import { migration_009 } from './009-pioneer-anthropic-dedup.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'mg-')), 't.db');
});

describe('migration 001 additive indexes', () => {
  it('creates the performance indexes', () => {
    const db = openDb();
    const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as {
      name: string;
    }[];
    const names = new Set(rows.map((r) => r.name));
    expect(names.has('idx_logs_model_created_cost')).toBe(true);
    expect(names.has('idx_logs_created_at')).toBe(true);
    expect(names.has('idx_accounts_enabled_status')).toBe(true);
    expect(names.has('idx_client_keys_active_key')).toBe(true);
  });
});

describe('migration 009 pioneer anthropic dedup', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'm9-')), 't.db');
  });

  it('collapses pioneer/anthropic/pioneer/<x> dup rows onto canonical pioneer/<x>', () => {
    const db = openDb();
    db.prepare(
      `INSERT INTO models (name, upstream_model, family, source, provider, enabled) VALUES (?, ?, ?, ?, ?, 1)`
    ).run('pioneer/gpt-5.5', 'gpt-5.5', 'pioneer', 'fetched', 'pioneer');
    db.prepare(
      `INSERT INTO models (name, upstream_model, family, source, provider, enabled) VALUES (?, ?, ?, ?, ?, 1)`
    ).run('pioneer/anthropic/pioneer/gpt-5.5', 'anthropic/pioneer/gpt-5.5', 'pioneer', 'fetched', 'pioneer');
    db.prepare(
      `INSERT INTO models (name, upstream_model, family, source, provider, enabled) VALUES (?, ?, ?, ?, ?, 1)`
    ).run('pioneer/claude-opus-4-8', 'claude-opus-4-8', 'pioneer', 'fetched', 'pioneer');

    db.exec(migration_009.sql);

    const rows = db
      .prepare(`SELECT name, upstream_model FROM models WHERE provider = 'pioneer' ORDER BY name`)
      .all() as { name: string; upstream_model: string }[];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name).sort()).toEqual([
      'pioneer/claude-opus-4-8',
      'pioneer/gpt-5.5',
    ]);
    expect(rows.every((r) => !r.upstream_model.startsWith('anthropic/pioneer/'))).toBe(true);
  });
});
