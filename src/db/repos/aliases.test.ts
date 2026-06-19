import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../index.js';
import { getAlias, upsertAlias } from './aliases.js';
import { createCombo } from './combos.js';
import { upsertModel } from './models.js';

let db: ReturnType<typeof openDb>;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'aliases-')), 't.db');
  db = openDb();
  // model_aliases.upstream_model has an FK to models.upstream_model — seed one
  // so upsertAlias can satisfy the constraint regardless of branch.
  upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3' });
});

describe('aliases repo — combo name conflict (B1)', () => {
  it('upsertAlias rejects when a combo already owns the name', () => {
    createCombo(db, 'shared-name', ['MiniMax-M3']);
    expect(() =>
      upsertAlias(db, { aliasName: 'shared-name', upstreamModel: 'MiniMax-M3' })
    ).toThrow(/^combo_conflict:/);
  });

  it('upsertAlias update path also rejects when a combo owns the name', () => {
    // First create an alias without conflict
    upsertAlias(db, { aliasName: 'a', upstreamModel: 'MiniMax-M3' });
    // Then a combo is inserted directly (bypassing createCombo's alias-check)
    // to simulate a rename race where a combo ends up owning the alias name.
    db.prepare(`INSERT INTO combos (id, name, models) VALUES (?, ?, ?)`).run(
      'combo-a',
      'a',
      JSON.stringify(['MiniMax-M3'])
    );
    // Now upsertAlias on the same name should hit the UPDATE branch and fail
    expect(() => upsertAlias(db, { aliasName: 'a', upstreamModel: 'MiniMax-M3' })).toThrow(
      /^combo_conflict:/
    );
  });

  it('upsertAlias succeeds when no combo owns the name', () => {
    const row = upsertAlias(db, { aliasName: 'free-name', upstreamModel: 'MiniMax-M3' });
    expect(row.aliasName).toBe('free-name');
    expect(getAlias(db, 'free-name')).not.toBeNull();
  });

  it('upsertAlias rejects when combo owns the name and other combos exist', () => {
    createCombo(db, 'other-combo', ['MiniMax-M3']);
    createCombo(db, 'target-combo', ['MiniMax-M3']);
    expect(() =>
      upsertAlias(db, { aliasName: 'target-combo', upstreamModel: 'MiniMax-M3' })
    ).toThrow(/^combo_conflict:/);
  });
});
