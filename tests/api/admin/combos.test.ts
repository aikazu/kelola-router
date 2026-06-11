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
      body: JSON.stringify({ name: 'my-combo', models: ['model-a', 'model-b'] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('my-combo');
    expect(body.models).toEqual(['model-a', 'model-b']);
  });

  it('returns 409 on duplicate name', async () => {
    createCombo(db, 'dup', ['a']);
    const res = await app.request('/api/admin/combos', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name: 'dup', models: ['b'] }),
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
    const combo = createCombo(db, 'upd-combo', ['a']);
    const res = await app.request(`/api/admin/combos/${combo.id}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ models: ['x', 'y'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.models).toEqual(['x', 'y']);
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
