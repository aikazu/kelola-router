import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authRoutes } from '../../../src/api/admin/auth.js';
import { hashPassword } from '../../../src/auth/password.js';
import { _resetRateLimitForTests } from '../../../src/auth/rate-limit.js';
import { migrate } from '../../../src/db/migrations/index.js';

let db: Database.Database;
let dir: string;
let app: Hono;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rl-'));
  db = new Database(join(dir, 't.db'));
  db.pragma('foreign_keys = ON');
  migrate(db);
  _resetRateLimitForTests();
  const hash = hashPassword('testpass');
  db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
    JSON.stringify(hash)
  );
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.route('/', authRoutes);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true });
  _resetRateLimitForTests();
  vi.restoreAllMocks();
});

describe('/api/login rate limiting', () => {
  it('returns 429 with retryAfterMs after 5 wrong passwords from same IP', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await app.request('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
        body: JSON.stringify({ password: 'wrong' }),
      });
      expect(r.status).toBe(401);
    }
    const blocked = await app.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as {
      error: string;
      message: string;
      retryAfterMs?: number;
    };
    expect(body.retryAfterMs).toBeGreaterThan(0);
  });

  it('does not rate-limit different IPs independently', async () => {
    for (let i = 0; i < 5; i++) {
      await app.request('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '5.6.7.8' },
        body: JSON.stringify({ password: 'wrong' }),
      });
    }
    const otherIp = await app.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.10.11.12' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    expect(otherIp.status).toBe(401);
  });

  it('resets bucket on successful login', async () => {
    for (let i = 0; i < 4; i++) {
      await app.request('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '13.14.15.16' },
        body: JSON.stringify({ password: 'wrong' }),
      });
    }
    const ok = await app.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '13.14.15.16' },
      body: JSON.stringify({ password: 'testpass' }),
    });
    expect(ok.status).toBe(204);
    // 4 more wrongs should still work since the bucket was cleared
    for (let i = 0; i < 4; i++) {
      const r = await app.request('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '13.14.15.16' },
        body: JSON.stringify({ password: 'wrong' }),
      });
      expect(r.status).toBe(401);
    }
  });
});
