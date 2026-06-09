import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminApi } from '../../../src/api/admin/index.js';
import { setPassword } from '../../../src/auth/password.js';
import { createSession } from '../../../src/auth/session.js';
import { SESSION_COOKIE } from '../../../src/auth.js';
import { migrate } from '../../../src/db/migrations/index.js';
import { getModel, upsertModel } from '../../../src/db/repos/models.js';
import { createClientKey, genClientKey, getClientKey } from '../../../src/db/repos/client_keys.js';

let db: Database.Database;
let dir: string;
let app: Hono;
let cookie: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bulk-patch-'));
  db = new Database(join(dir, 't.db'));
  db.pragma('foreign_keys = ON');
  migrate(db);
  upsertModel(db, { name: 'model-a', upstream_model: 'model-a' });
  upsertModel(db, { name: 'model-b', upstream_model: 'model-b' });
  upsertModel(db, { name: 'model-c', upstream_model: 'model-c' });
  setPassword(db, 'testpass');
  const sess = createSession(db);
  cookie = `${SESSION_COOKIE}=${sess.id}`;
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
  vi.restoreAllMocks();
});

const authed = () => ({
  cookie,
  host: 'localhost:20137',
  origin: 'http://localhost:20137',
  'content-type': 'application/json',
});

describe('POST /api/admin/models/bulk-toggle', () => {
  it('disables multiple models', async () => {
    const res = await app.request('/api/admin/models/bulk-toggle', {
      method: 'POST',
      headers: authed(),
      body: JSON.stringify({ names: ['model-a', 'model-b'], enabled: false }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(2);
    expect(getModel(db, 'model-a')?.enabled).toBe(0);
    expect(getModel(db, 'model-b')?.enabled).toBe(0);
    expect(getModel(db, 'model-c')?.enabled).toBe(1);
  });

  it('enables multiple models', async () => {
    db.prepare(`UPDATE models SET enabled = 0`).run();
    const res = await app.request('/api/admin/models/bulk-toggle', {
      method: 'POST',
      headers: authed(),
      body: JSON.stringify({ names: ['model-a', 'model-c'], enabled: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(2);
    expect(getModel(db, 'model-a')?.enabled).toBe(1);
    expect(getModel(db, 'model-c')?.enabled).toBe(1);
    expect(getModel(db, 'model-b')?.enabled).toBe(0);
  });

  it('returns 400 for empty names', async () => {
    const res = await app.request('/api/admin/models/bulk-toggle', {
      method: 'POST',
      headers: authed(),
      body: JSON.stringify({ names: [], enabled: false }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing enabled', async () => {
    const res = await app.request('/api/admin/models/bulk-toggle', {
      method: 'POST',
      headers: authed(),
      body: JSON.stringify({ names: ['model-a'] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/admin/client-keys/:id', () => {
  let keyId: number;

  beforeEach(() => {
    const ck = createClientKey(db, { label: 'original', key: genClientKey() });
    keyId = ck.id;
  });

  it('updates the label', async () => {
    const res = await app.request(`/api/admin/client-keys/${keyId}`, {
      method: 'PATCH',
      headers: authed(),
      body: JSON.stringify({ label: 'renamed' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(keyId);
    expect(body.label).toBe('renamed');
    expect(getClientKey(db, keyId)?.label).toBe('renamed');
  });

  it('trims whitespace', async () => {
    const res = await app.request(`/api/admin/client-keys/${keyId}`, {
      method: 'PATCH',
      headers: authed(),
      body: JSON.stringify({ label: '  padded  ' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.label).toBe('padded');
  });

  it('returns 400 for empty label', async () => {
    const res = await app.request(`/api/admin/client-keys/${keyId}`, {
      method: 'PATCH',
      headers: authed(),
      body: JSON.stringify({ label: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for whitespace-only label', async () => {
    const res = await app.request(`/api/admin/client-keys/${keyId}`, {
      method: 'PATCH',
      headers: authed(),
      body: JSON.stringify({ label: '   ' }),
    });
    expect(res.status).toBe(400);
  });
});
