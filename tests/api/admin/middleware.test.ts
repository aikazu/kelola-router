import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { Hono } from 'hono';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, handleApiError, requireAdminJson } from '../../../src/api/admin/middleware.js';
import { migrate } from '../../../src/db/migrations/index.js';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mid-test-'));
  db = new Database(join(dir, 't.db'));
  db.pragma('foreign_keys = ON');
  migrate(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true });
  vi.restoreAllMocks();
});

describe('requireAdminJson', () => {
  it('returns 401 JSON when no session and password is set', async () => {
    const { hashPassword } = await import('../../../src/auth/password.js');
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
      JSON.stringify(hashPassword('secret123'))
    );
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('db', db);
      await next();
    });
    app.use('/api/admin/*', requireAdminJson);
    app.get('/api/admin/test', (c) => c.json({ ok: true }));
    const res = await app.request('/api/admin/test');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  it('passes through when no password set', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('db', db);
      await next();
    });
    app.use('/api/admin/*', requireAdminJson);
    app.get('/api/admin/test', (c) => c.json({ ok: true }));
    const res = await app.request('/api/admin/test');
    expect(res.status).toBe(200);
  });
});

describe('handleApiError', () => {
  it('returns 400 for ApiError', () => {
    const res = handleApiError(new ApiError('bad', 'nope', 400));
    expect(res.status).toBe(400);
  });

  it('returns 500 for unknown', () => {
    const res = handleApiError(new Error('oops'));
    expect(res.status).toBe(500);
  });
});
