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
import { upsertModel } from '../../../src/db/repos/models.js';
import { clearAliasCache } from '../../../src/providers/aliasCache.js';

let db: Database.Database;
let dir: string;
let app: Hono;
let cookie: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'alias-api-'));
  db = new Database(join(dir, 't.db'));
  db.pragma('foreign_keys = ON');
  migrate(db);
  upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3' });
  upsertModel(db, { name: 'MiniMax-M2.7', upstream_model: 'MiniMax-M2.7' });
  setPassword(db, 'testpass');
  const sess = createSession(db);
  cookie = `${SESSION_COOKIE}=${sess.id}`;
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.route('/api', adminApi(db));
  clearAliasCache();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true });
  vi.restoreAllMocks();
});

const baseHeaders = () => ({
  cookie,
  origin: 'http://localhost:20137',
  host: 'localhost:20137',
  'content-type': 'application/json',
});

describe('GET /api/admin/aliases', () => {
  it('returns empty list initially', async () => {
    const res = await app.request('/api/admin/aliases', { headers: baseHeaders() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ aliases: [] });
  });
});

describe('POST /api/admin/aliases', () => {
  it('creates a new alias and returns 201 with row', async () => {
    const res = await app.request('/api/admin/aliases', {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({ aliasName: 'claude-opus-4-8', upstreamModel: 'MiniMax-M3' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.aliasName).toBe('claude-opus-4-8');
    expect(body.upstreamModel).toBe('MiniMax-M3');
  });

  it('rejects alias name that collides with a real model (409)', async () => {
    const res = await app.request('/api/admin/aliases', {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({ aliasName: 'MiniMax-M3', upstreamModel: 'MiniMax-M2.7' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('alias_conflicts_with_model');
  });

  it('rejects unknown upstream target (400)', async () => {
    const res = await app.request('/api/admin/aliases', {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({ aliasName: 'x', upstreamModel: 'no-such-model' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('unknown_target_model');
  });

  it('rejects invalid alias name (400)', async () => {
    const res = await app.request('/api/admin/aliases', {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({ aliasName: 'has spaces', upstreamModel: 'MiniMax-M3' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_alias_name');
  });

  it('overwrites existing alias with same name', async () => {
    await app.request('/api/admin/aliases', {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({ aliasName: 'a1', upstreamModel: 'MiniMax-M3' }),
    });
    const res = await app.request('/api/admin/aliases', {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({ aliasName: 'a1', upstreamModel: 'MiniMax-M2.7' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.upstreamModel).toBe('MiniMax-M2.7');
  });
});

describe('PUT /api/admin/aliases/:name', () => {
  it('updates target and label', async () => {
    await app.request('/api/admin/aliases', {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({ aliasName: 'a1', upstreamModel: 'MiniMax-M3' }),
    });
    const res = await app.request('/api/admin/aliases/a1', {
      method: 'PUT',
      headers: baseHeaders(),
      body: JSON.stringify({ upstreamModel: 'MiniMax-M2.7', label: 'v2' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.upstreamModel).toBe('MiniMax-M2.7');
    expect(body.label).toBe('v2');
  });

  it('returns 404 for missing alias', async () => {
    const res = await app.request('/api/admin/aliases/nope', {
      method: 'PUT',
      headers: baseHeaders(),
      body: JSON.stringify({ upstreamModel: 'MiniMax-M3' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/aliases/:name', () => {
  it('returns 204 and removes the row', async () => {
    await app.request('/api/admin/aliases', {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({ aliasName: 'a1', upstreamModel: 'MiniMax-M3' }),
    });
    const del = await app.request('/api/admin/aliases/a1', {
      method: 'DELETE',
      headers: baseHeaders(),
    });
    expect(del.status).toBe(204);
    const list = await app.request('/api/admin/aliases', { headers: baseHeaders() });
    expect((await list.json()).aliases).toHaveLength(0);
  });

  it('returns 404 for missing alias', async () => {
    const res = await app.request('/api/admin/aliases/nope', {
      method: 'DELETE',
      headers: baseHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

describe('CSRF on /api/admin/aliases', () => {
  it('rejects cross-origin POST (403)', async () => {
    const res = await app.request('/api/admin/aliases', {
      method: 'POST',
      headers: { ...baseHeaders(), origin: 'https://evil.example' },
      body: JSON.stringify({ aliasName: 'x', upstreamModel: 'MiniMax-M3' }),
    });
    expect(res.status).toBe(403);
  });
});
