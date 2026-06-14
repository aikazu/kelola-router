import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../db/index.js';
import { app, resetDb } from '../../server.js';

describe('POST /api/admin/reauth/verify', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reauth-')), 't.db');
    resetDb();
  });

  it('returns 401 when password set and no admin key provided', async () => {
    process.env.ROUTER_ADMIN_KEY = 'ak_test';
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
      JSON.stringify('scrypt:16384:00:00')
    );
    // No x-admin-key header, no session cookie
    const res = await app.request('/api/admin/reauth/verify', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('returns 501 when authenticated with correct admin key', async () => {
    process.env.ROUTER_ADMIN_KEY = 'ak_test';
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
      JSON.stringify('scrypt:16384:00:00')
    );
    const res = await app.request('/api/admin/reauth/verify', {
      method: 'POST',
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body).toEqual({ error: 'not_implemented_yet', task: 15 });
  });

  it('returns 403 cross-origin POST without matching Origin', async () => {
    process.env.ROUTER_ADMIN_KEY = 'ak_test';
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
      JSON.stringify('scrypt:16384:00:00')
    );
    const res = await app.request('/api/admin/reauth/verify', {
      method: 'POST',
      headers: {
        'x-admin-key': 'ak_test',
        Origin: 'http://evil.com',
        Host: 'localhost:20137',
      },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('cross-origin request blocked');
  });

  it('returns 501 when Origin omitted (permissive same-server)', async () => {
    process.env.ROUTER_ADMIN_KEY = 'ak_test';
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
      JSON.stringify('scrypt:16384:00:00')
    );
    // No Origin header = curl/server-to-server = permitted by csrfGuard
    const res = await app.request('/api/admin/reauth/verify', {
      method: 'POST',
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(501);
  });
});

describe('POST /api/admin/reauth/clear', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reauth-')), 't.db');
    resetDb();
  });

  it('returns 401 when password set and no admin key provided', async () => {
    process.env.ROUTER_ADMIN_KEY = 'ak_test';
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
      JSON.stringify('scrypt:16384:00:00')
    );
    const res = await app.request('/api/admin/reauth/clear', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('returns 501 when authenticated with correct admin key', async () => {
    process.env.ROUTER_ADMIN_KEY = 'ak_test';
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
      JSON.stringify('scrypt:16384:00:00')
    );
    const res = await app.request('/api/admin/reauth/clear', {
      method: 'POST',
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body).toEqual({ error: 'not_implemented_yet', task: 15 });
  });
});
