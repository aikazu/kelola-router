import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { Hono } from 'hono';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authRoutes } from '../../../src/api/admin/auth.js';
import { clearPassword, hashPassword } from '../../../src/auth/password.js';
import { migrate } from '../../../src/db/migrations/index.js';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
  db = new Database(join(dir, 't.db'));
  db.pragma('foreign_keys = ON');
  migrate(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true });
});

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.route('/', authRoutes);
  return app;
}

describe('auth API', () => {
  it('GET /me returns passwordSet=false when no password', async () => {
    const app = makeApp();
    const res = await app.request('/me');
    const body = await res.json();
    expect(body).toEqual({ authed: true, passwordSet: false });
  });

  it('POST /login with correct password sets session cookie', async () => {
    const hash = hashPassword('secret123');
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
      JSON.stringify(hash)
    );
    const app = makeApp();
    const res = await app.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'secret123' }),
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toContain('kelola_session=');
  });

  it('POST /login with wrong password returns 401', async () => {
    const hash = hashPassword('secret123');
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
      JSON.stringify(hash)
    );
    const app = makeApp();
    const res = await app.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /logout clears session', async () => {
    const hash = hashPassword('secret123');
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
      JSON.stringify(hash)
    );
    const app = makeApp();
    const loginRes = await app.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'secret123' }),
    });
    const cookie = loginRes.headers.get('set-cookie')!.split(';')[0];
    const logoutRes = await app.request('/logout', { method: 'POST', headers: { cookie } });
    expect(logoutRes.status).toBe(204);
  });
});
