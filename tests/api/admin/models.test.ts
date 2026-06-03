import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { Hono } from 'hono';
import { tmpdir } from 'os';
import { join } from 'path';
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
  dir = mkdtempSync(join(tmpdir(), 'models-api-'));
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

const authed = () => ({ cookie, host: 'localhost:20137' });

describe('GET /api/admin/models — aliasCount', () => {
  it('returns 0 for models with no aliases', async () => {
    const res = await app.request('/api/admin/models', { headers: authed() });
    const rows = (await res.json()) as Array<{ name: string; aliasCount: number }>;
    expect(rows.find((r) => r.name === 'MiniMax-M3')?.aliasCount).toBe(0);
  });

  it('increments when alias is created', async () => {
    const headers = {
      ...authed(),
      origin: 'http://localhost:20137',
      'content-type': 'application/json',
    };
    await app.request('/api/admin/aliases', {
      method: 'POST',
      headers,
      body: JSON.stringify({ aliasName: 'a1', upstreamModel: 'MiniMax-M3' }),
    });
    const res = await app.request('/api/admin/models', { headers: authed() });
    const rows = (await res.json()) as Array<{ name: string; aliasCount: number }>;
    expect(rows.find((r) => r.name === 'MiniMax-M3')?.aliasCount).toBe(1);
  });

  it('decrements when alias is deleted', async () => {
    const headers = {
      ...authed(),
      origin: 'http://localhost:20137',
      'content-type': 'application/json',
    };
    await app.request('/api/admin/aliases', {
      method: 'POST',
      headers,
      body: JSON.stringify({ aliasName: 'a1', upstreamModel: 'MiniMax-M3' }),
    });
    await app.request('/api/admin/aliases/a1', { method: 'DELETE', headers });
    const res = await app.request('/api/admin/models', { headers: authed() });
    const rows = (await res.json()) as Array<{ name: string; aliasCount: number }>;
    expect(rows.find((r) => r.name === 'MiniMax-M3')?.aliasCount).toBe(0);
  });
});
