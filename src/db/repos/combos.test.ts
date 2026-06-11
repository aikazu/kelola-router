import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../index.js';
import {
  createCombo,
  deleteCombo,
  getCombo,
  getComboById,
  listCombos,
  updateCombo,
} from './combos.js';

let db: ReturnType<typeof openDb>;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'combo-')), 'test.db');
  db = openDb();
});

describe('combos repo', () => {
  it('createCombo stores a combo and returns parsed models', () => {
    const combo = createCombo(db, 'my-combo', ['model-a', 'model-b', 'model-c']);
    expect(combo.id).toMatch(/^combo_/);
    expect(combo.name).toBe('my-combo');
    expect(combo.models).toEqual(['model-a', 'model-b', 'model-c']);
    expect(combo.created_at).toBeTruthy();
    expect(combo.updated_at).toBeTruthy();
  });

  it('getCombo retrieves by name, null when missing', () => {
    createCombo(db, 'test-chain', ['m1', 'm2']);
    const found = getCombo(db, 'test-chain');
    expect(found).not.toBeNull();
    expect(found!.name).toBe('test-chain');
    expect(found!.models).toEqual(['m1', 'm2']);
    expect(getCombo(db, 'nope')).toBeNull();
  });

  it('getComboById retrieves by id, null when missing', () => {
    const created = createCombo(db, 'by-id', ['x']);
    const found = getComboById(db, created.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('by-id');
    expect(getComboById(db, 'nonexistent')).toBeNull();
  });

  it('updateCombo patches name', () => {
    const created = createCombo(db, 'old-name', ['a', 'b']);
    const updated = updateCombo(db, created.id, { name: 'new-name' });
    expect(updated.name).toBe('new-name');
    expect(updated.models).toEqual(['a', 'b']);
    expect(getCombo(db, 'new-name')).not.toBeNull();
    expect(getCombo(db, 'old-name')).toBeNull();
  });

  it('updateCombo patches models', () => {
    const created = createCombo(db, 'mod-combo', ['a']);
    const updated = updateCombo(db, created.id, { models: ['x', 'y', 'z'] });
    expect(updated.models).toEqual(['x', 'y', 'z']);
    expect(updated.name).toBe('mod-combo');
  });

  it('updateCombo throws for missing id', () => {
    expect(() => updateCombo(db, 'fake_id', { name: 'x' })).toThrow('combo not found');
  });

  it('deleteCombo removes the row', () => {
    const created = createCombo(db, 'to-delete', ['a']);
    expect(deleteCombo(db, created.id)).toBe(true);
    expect(getComboById(db, created.id)).toBeNull();
  });

  it('deleteCombo returns false for missing id', () => {
    expect(deleteCombo(db, 'nope')).toBe(false);
  });

  it('listCombos returns all combos ordered by created_at', () => {
    createCombo(db, 'first', ['a']);
    createCombo(db, 'second', ['b']);
    createCombo(db, 'third', ['c']);
    const all = listCombos(db);
    expect(all).toHaveLength(3);
    expect(all.map((c) => c.name)).toEqual(['first', 'second', 'third']);
  });

  it('createCombo enforces unique name', () => {
    createCombo(db, 'unique-name', ['a']);
    expect(() => createCombo(db, 'unique-name', ['b'])).toThrow();
  });

  it('createCombo throws conflict error when name matches existing alias', () => {
    db.prepare(
      `INSERT INTO model_aliases (alias_name, upstream_model, created_at)
       VALUES ('fast', 'MiniMax-M3', datetime('now'))`
    ).run();
    expect(() => createCombo(db, 'fast', ['MiniMax-M3'])).toThrow('alias_conflict');
  });

  it('updateCombo throws conflict error when new name matches existing alias', () => {
    db.prepare(
      `INSERT INTO model_aliases (alias_name, upstream_model, created_at)
       VALUES ('smart', 'MiniMax-M3', datetime('now'))`
    ).run();
    const combo = createCombo(db, 'my-combo', ['MiniMax-M3']);
    expect(() => updateCombo(db, combo.id, { name: 'smart' })).toThrow('alias_conflict');
  });

  it('listCombos returns empty models array for corrupt JSON in models column', () => {
    db.prepare(
      `INSERT INTO combos (id, name, models, created_at, updated_at)
       VALUES ('combo_corrupt', 'bad-combo', 'NOT_VALID_JSON', datetime('now'), datetime('now'))`
    ).run();
    const all = listCombos(db);
    const bad = all.find((c) => c.name === 'bad-combo');
    expect(bad).toBeDefined();
    expect(bad!.models).toEqual([]);
  });

  it('getCombo returns combo with empty models for corrupt JSON', () => {
    db.prepare(
      `INSERT INTO combos (id, name, models, created_at, updated_at)
       VALUES ('combo_corrupt2', 'bad-combo2', '{broken', datetime('now'), datetime('now'))`
    ).run();
    const found = getCombo(db, 'bad-combo2');
    expect(found).not.toBeNull();
    expect(found!.models).toEqual([]);
  });

  it('updateCombo is atomic — partial updates do not leave inconsistent state', () => {
    const created = createCombo(db, 'atomic-combo', ['a', 'b']);
    const updated = updateCombo(db, created.id, { name: 'new-name', models: ['x', 'y', 'z'] });
    expect(updated.name).toBe('new-name');
    expect(updated.models).toEqual(['x', 'y', 'z']);
    const fromDb = getComboById(db, created.id);
    expect(fromDb!.name).toBe('new-name');
    expect(fromDb!.models).toEqual(['x', 'y', 'z']);
  });
});
