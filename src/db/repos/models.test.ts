import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../index.js';
import { seedCodebuddyBuiltins, seedKiroBuiltins } from '../seed-builtin-models.js';
import { disableModel, getModel, listModels, upsertModel } from './models.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'm-')), 't.db');
  const db = openDb();
  seedKiroBuiltins(db);
  seedCodebuddyBuiltins(db);
});

function seedMiniMaxStandIn(db: ReturnType<typeof openDb>): void {
  // Upsert a representative model so tests that only need "any existing model"
  // stay independent of startup seeding, which no longer inserts MiniMax rows.
  upsertModel(db, {
    name: 'MiniMax-M3',
    upstream_model: 'MiniMax-M3',
    display_name: 'MiniMax M3',
    family: 'm3',
    source: 'manual',
  });
}

describe('models repo', () => {
  it('getModel returns seed model by name', () => {
    const db = openDb();
    seedMiniMaxStandIn(db);
    const m = getModel(db, 'MiniMax-M3');
    expect(m?.upstream_model).toBe('MiniMax-M3');
  });

  it('getModel returns null for unknown', () => {
    const db = openDb();
    expect(getModel(db, 'nope')).toBeNull();
  });

  it('listModels returns enabled Kiro builtins after seeding', () => {
    const db = openDb();
    const enabled = listModels(db);
    const all = listModels(db, { includeDisabled: true });
    expect(enabled.some((m) => m.name.endsWith('-thinking'))).toBe(false);
    expect(all.length).toBeGreaterThan(enabled.length);
  });

  it('seeded Kiro enabled models exclude thinking variants', () => {
    const db = openDb();
    seedKiroBuiltins(db);
    const enabledNames = listModels(db).map((m) => m.name);
    expect(enabledNames).toContain('claude-sonnet-4-6');
    expect(enabledNames.some((n) => n.endsWith('-thinking'))).toBe(false);
  });

  it('upsertModel inserts new', () => {
    const db = openDb();
    upsertModel(db, {
      name: 'custom-x',
      upstream_model: 'custom-x',
      display_name: 'Custom X',
      family: 'custom',
      source: 'manual',
    });
    expect(getModel(db, 'custom-x')?.display_name).toBe('Custom X');
  });

  it('upsertModel updates existing (name match)', () => {
    const db = openDb();
    seedMiniMaxStandIn(db);
    upsertModel(db, {
      name: 'MiniMax-M3',
      upstream_model: 'MiniMax-M3',
      display_name: 'Updated',
      family: 'm3',
      source: 'fetched',
    });
    expect(getModel(db, 'MiniMax-M3')?.display_name).toBe('Updated');
  });

  it('disableModel sets enabled=0', () => {
    const db = openDb();
    seedMiniMaxStandIn(db);
    disableModel(db, 'MiniMax-M3');
    expect(getModel(db, 'MiniMax-M3')?.enabled).toBe(0);
  });
});
