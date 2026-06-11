import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminApi } from '../../../src/api/admin/index.js';
import { SESSION_COOKIE } from '../../../src/auth.js';
import { setPassword } from '../../../src/auth/password.js';
import { createSession } from '../../../src/auth/session.js';
import { migrate } from '../../../src/db/migrations/index.js';
import { getSetting } from '../../../src/db/repos/settings.js';

let db: Database.Database;
let dir: string;
let app: Hono;
let cookie: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sel-api-'));
  db = new Database(join(dir, 't.db'));
  db.pragma('foreign_keys = ON');
  migrate(db);
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
});

const authed = () => ({ cookie, host: 'localhost:20137' });
const postHeaders = () => ({
  ...authed(),
  origin: 'http://localhost:20137',
  'content-type': 'application/json',
});

describe('selection settings per provider', () => {
  it('GET returns defaults when unset', async () => {
    const res = await app.request('/api/admin/settings/selection/minimax', { headers: authed() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: 'lowest-backoff', step: 1 });
  });

  it('POST persists and GET round-trips', async () => {
    const post = await app.request('/api/admin/settings/selection/kiro', {
      method: 'POST',
      headers: postHeaders(),
      body: JSON.stringify({ mode: 'round-robin', step: 10 }),
    });
    expect(post.status).toBe(204);
    expect(getSetting(db, 'selection.kiro')).toEqual({ mode: 'round-robin', step: 10 });

    const res = await app.request('/api/admin/settings/selection/kiro', { headers: authed() });
    expect(await res.json()).toEqual({ mode: 'round-robin', step: 10 });
  });

  it('rejects unknown provider with 400', async () => {
    const get = await app.request('/api/admin/settings/selection/openai', { headers: authed() });
    expect(get.status).toBe(400);
    const post = await app.request('/api/admin/settings/selection/openai', {
      method: 'POST',
      headers: postHeaders(),
      body: JSON.stringify({ mode: 'round-robin', step: 1 }),
    });
    expect(post.status).toBe(400);
  });

  it('rejects invalid mode with 400', async () => {
    const res = await app.request('/api/admin/settings/selection/minimax', {
      method: 'POST',
      headers: postHeaders(),
      body: JSON.stringify({ mode: 'fastest', step: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it('coerces invalid step to 1', async () => {
    await app.request('/api/admin/settings/selection/minimax', {
      method: 'POST',
      headers: postHeaders(),
      body: JSON.stringify({ mode: 'round-robin', step: -5 }),
    });
    expect(getSetting(db, 'selection.minimax')).toEqual({ mode: 'round-robin', step: 1 });
  });

  it('old POST /selection route is gone', async () => {
    const res = await app.request('/api/admin/settings/selection', {
      method: 'POST',
      headers: postHeaders(),
      body: JSON.stringify({ mode: 'round-robin' }),
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/admin/settings no longer includes selection', async () => {
    const res = await app.request('/api/admin/settings', { headers: authed() });
    const json = (await res.json()) as Record<string, unknown>;
    expect('selection' in json).toBe(false);
  });
});
