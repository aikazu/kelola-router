import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminApi } from '../../../src/api/admin/index.js';
import { migrate } from '../../../src/db/migrations/index.js';
import { createCombo } from '../../../src/db/repos/combos.js';

let db: Database.Database;
let dir: string;
let app: Hono;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'combos-api-'));
  db = new Database(join(dir, 't.db'));
  db.pragma('foreign_keys = ON');
  migrate(db);
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.route('/api', adminApi());
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true });
});

const headers = () => ({
  origin: 'http://localhost:20137',
  host: 'localhost:20137',
  'content-type': 'application/json',
});

describe('GET /api/admin/combos', () => {
  it('returns empty list', async () => {
    const res = await app.request('/api/admin/combos', { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.combos).toEqual([]);
  });
});

describe('POST /api/admin/combos', () => {
  it('creates a combo', async () => {
    const res = await app.request('/api/admin/combos', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name: 'my-combo', models: ['mm/model-a', 'kr/model-b'] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('my-combo');
    expect(body.models).toEqual(['mm/model-a', 'kr/model-b']);
  });

  it('returns 400 when a member is not prefixed', async () => {
    const res = await app.request('/api/admin/combos', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name: 'bare-combo', models: ['mm/model-a', 'model-b'] }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when a member has an unknown prefix', async () => {
    const res = await app.request('/api/admin/combos', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name: 'badpfx-combo', models: ['xx/model-a'] }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 409 on duplicate name', async () => {
    createCombo(db, 'dup', ['mm/a']);
    const res = await app.request('/api/admin/combos', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name: 'dup', models: ['mm/b'] }),
    });
    expect(res.status).toBe(409);
  });

  it('returns 409 when name conflicts with existing alias', async () => {
    db.prepare(
      `INSERT INTO model_aliases (alias_name, upstream_model, created_at)
       VALUES ('fast', 'MiniMax-M3', datetime('now'))`
    ).run();
    const res = await app.request('/api/admin/combos', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name: 'fast', models: ['mm/model-a'] }),
    });
    expect(res.status).toBe(409);
  });

  it('returns 400 for invalid name', async () => {
    const res = await app.request('/api/admin/combos', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name: '!invalid!', models: ['a'] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/admin/combos/:id', () => {
  it('updates combo', async () => {
    const combo = createCombo(db, 'upd-combo', ['mm/a']);
    const res = await app.request(`/api/admin/combos/${combo.id}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ models: ['mm/x', 'kr/y'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.models).toEqual(['mm/x', 'kr/y']);
  });

  it('returns 409 when new name conflicts with existing alias', async () => {
    const combo = createCombo(db, 'my-combo', ['a']);
    db.prepare(
      `INSERT INTO model_aliases (alias_name, upstream_model, created_at)
       VALUES ('alias-x', 'MiniMax-M3', datetime('now'))`
    ).run();
    const res = await app.request(`/api/admin/combos/${combo.id}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ name: 'alias-x' }),
    });
    expect(res.status).toBe(409);
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.request('/api/admin/combos/combo_notexist', {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ models: ['x'] }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 (not 500) when combo deleted between check and update (race simulation)', async () => {
    const combo = createCombo(db, 'race-combo', ['a']);
    db.prepare('DELETE FROM combos WHERE id = ?').run(combo.id);
    const res = await app.request(`/api/admin/combos/${combo.id}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ models: ['x'] }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/combos/:id', () => {
  it('deletes combo', async () => {
    const combo = createCombo(db, 'del-combo', ['a']);
    const res = await app.request(`/api/admin/combos/${combo.id}`, {
      method: 'DELETE',
      headers: headers(),
    });
    expect(res.status).toBe(204);
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.request('/api/admin/combos/combo_ghost', {
      method: 'DELETE',
      headers: headers(),
    });
    expect(res.status).toBe(404);
  });
});
