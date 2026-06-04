import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../../src/auth/password.js';
import { _resetRateLimitForTests as resetRateLimit } from '../../src/auth/rateLimit.js';
import { openDb } from '../../src/db/index.js';
import { createAccount, getAccount } from '../../src/db/repos/accounts.js';
import { createClientKey, getClientKey } from '../../src/db/repos/client_keys.js';
import { clearCache as clearSettingsCache } from '../../src/db/repos/settings.js';
import { app, resetDb } from '../../src/server.js';

describe('login rate limit', () => {
  beforeEach(() => resetRateLimit());

  it('returns 401 on first 5 wrong attempts, then 429 on 6th', async () => {
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
      JSON.stringify(hashPassword('right'))
    );
    for (let i = 0; i < 5; i++) {
      const r = await app.request('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'password=wrong',
      });
      expect(r.status).toBe(401);
    }
    const sixth = await app.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=wrong',
    });
    expect(sixth.status).toBe(429);
  });

  it("different IP — unaffected by another IP's lockout", async () => {
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
      JSON.stringify(hashPassword('right'))
    );
    for (let i = 0; i < 5; i++) {
      await app.request('/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-forwarded-for': '10.0.0.1',
        },
        body: 'password=wrong',
      });
    }
    const fromOther = await app.request('/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-forwarded-for': '10.0.0.2',
      },
      body: 'password=right',
    });
    expect(fromOther.status).toBe(302);
  });
});

describe('/admin/models actions', () => {
  it('POST /admin/models/:name/enable sets enabled=1', async () => {
    const db = openDb();
    db.prepare(`UPDATE models SET enabled = 0 WHERE name = 'MiniMax-M3'`).run();
    const res = await app.request('/admin/models/MiniMax-M3/enable', { method: 'POST' });
    expect(res.status).toBe(302);
    expect(db.prepare(`SELECT enabled FROM models WHERE name = 'MiniMax-M3'`).get()).toEqual({
      enabled: 1,
    });
  });

  it('POST /admin/models/:name/disable sets enabled=0', async () => {
    const db = openDb();
    const res = await app.request('/admin/models/MiniMax-M3/disable', { method: 'POST' });
    expect(res.status).toBe(302);
    expect(db.prepare(`SELECT enabled FROM models WHERE name = 'MiniMax-M3'`).get()).toEqual({
      enabled: 0,
    });
  });
});

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'auth-')), 't.db');
  resetDb();
  clearSettingsCache();
});

describe('POST /login', () => {
  it('sets session cookie + redirects to /admin when password correct', async () => {
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
      JSON.stringify(hashPassword('hunter2'))
    );

    const res = await app.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=hunter2',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('kelola_session=');
    expect(cookie).toContain('HttpOnly');
  });

  it('returns 401 login page with error when password wrong', async () => {
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
      JSON.stringify(hashPassword('hunter2'))
    );

    const res = await app.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=wrong',
    });
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toContain('Wrong password');
  });

  it('redirects to /admin (no-op login) when no password set', async () => {
    const res = await app.request('/login', { method: 'POST' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin');
  });
});

describe('POST /logout', () => {
  it('clears the session cookie + redirects home', async () => {
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
      JSON.stringify(hashPassword('x'))
    );

    const login = await app.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=x',
    });
    const setCookie = login.headers.get('set-cookie') ?? '';
    const sid = /kelola_session=([^;]+)/.exec(setCookie)?.[1];
    expect(sid).toBeTruthy();

    const logout = await app.request('/logout', {
      method: 'POST',
      headers: { Cookie: `kelola_session=${sid}` },
    });
    expect(logout.status).toBe(302);
    expect(logout.headers.get('location')).toBe('/');
    const cleared = logout.headers.get('set-cookie') ?? '';
    expect(cleared).toMatch(/kelola_session=;/);
  });
});

describe('/admin/accounts actions', () => {
  it('POST /admin/accounts/:id/enable sets enabled=1', async () => {
    const db = openDb();
    createAccount(db, { id: 'acc_e', label: 'L', credit_type: 'payg', api_key: 'k' });
    db.prepare(`UPDATE accounts SET enabled = 0 WHERE id = 'acc_e'`).run();
    const res = await app.request('/admin/accounts/acc_e/enable', { method: 'POST' });
    expect(res.status).toBe(302);
    expect(getAccount(db, 'acc_e')?.enabled).toBe(1);
  });

  it('POST /admin/accounts/:id/disable sets enabled=0', async () => {
    const db = openDb();
    createAccount(db, { id: 'acc_d', label: 'L', credit_type: 'payg', api_key: 'k' });
    const res = await app.request('/admin/accounts/acc_d/disable', { method: 'POST' });
    expect(res.status).toBe(302);
    expect(getAccount(db, 'acc_d')?.enabled).toBe(0);
  });

  it('POST /admin/accounts/:id/delete removes the account', async () => {
    const db = openDb();
    createAccount(db, { id: 'acc_x', label: 'L', credit_type: 'payg', api_key: 'k' });
    const res = await app.request('/admin/accounts/acc_x/delete', { method: 'POST' });
    expect(res.status).toBe(302);
    expect(getAccount(db, 'acc_x')).toBeNull();
  });
});

describe('/admin/client-keys actions', () => {
  it('POST /admin/client-keys/:id/enable sets enabled=1', async () => {
    const db = openDb();
    createClientKey(db, { label: 'k', key: 'rk_1' });
    db.prepare(`UPDATE client_keys SET enabled = 0 WHERE id = ?`).run(1);
    const res = await app.request('/admin/client-keys/1/enable', { method: 'POST' });
    expect(res.status).toBe(302);
    expect(getClientKey(db, 1)?.enabled).toBe(1);
  });

  it('POST /admin/client-keys/:id/disable sets enabled=0', async () => {
    const db = openDb();
    createClientKey(db, { label: 'k', key: 'rk_d' });
    const res = await app.request('/admin/client-keys/1/disable', { method: 'POST' });
    expect(res.status).toBe(302);
    expect(getClientKey(db, 1)?.enabled).toBe(0);
  });

  it('POST /admin/client-keys/:id/delete removes the key', async () => {
    const db = openDb();
    createClientKey(db, { label: 'k', key: 'rk_x' });
    const res = await app.request('/admin/client-keys/1/delete', { method: 'POST' });
    expect(res.status).toBe(302);
    expect(getClientKey(db, 1)).toBeNull();
  });
});

describe('POST /admin/models/fetch', () => {
  it('returns 502 with clear error when upstream returns 404', async () => {
    const db = openDb();
    createAccount(db, { id: 'acc_x', label: 'L', credit_type: 'payg', api_key: 'k' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));
    const res = await app.request('/admin/models/fetch', { method: 'POST' });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/404|not.*found|not.*supported|does not expose/i);
  });

  it('redirects to /admin/models?fetched=N with friendly notice on success', async () => {
    const db = openDb();
    createAccount(db, { id: 'acc_y', label: 'L', credit_type: 'payg', api_key: 'k' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'MiniMax-M99' }] }), { status: 200 })
    );
    const res = await app.request('/admin/models/fetch', { method: 'POST' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/\/admin\/models/);
  });
});

describe('CSRF protection', () => {
  it('rejects POST from cross-origin', async () => {
    const db = openDb();
    createAccount(db, { id: 'acc_x', label: 'L', credit_type: 'payg', api_key: 'k' });
    const res = await app.request('http://127.0.0.1:20145/admin/accounts/acc_x/enable', {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com', Host: '127.0.0.1:20145' },
    });
    expect(res.status).toBe(403);
  });

  it('accepts POST from same-origin', async () => {
    const db = openDb();
    createAccount(db, { id: 'acc_x', label: 'L', credit_type: 'payg', api_key: 'k' });
    const res = await app.request('http://127.0.0.1:20145/admin/accounts/acc_x/enable', {
      method: 'POST',
      headers: { Origin: 'http://127.0.0.1:20145', Host: '127.0.0.1:20145' },
    });
    expect([302, 200]).toContain(res.status);
  });

  it('allows POST without Origin (curl / server-to-server)', async () => {
    const db = openDb();
    createAccount(db, { id: 'acc_x', label: 'L', credit_type: 'payg', api_key: 'k' });
    const res = await app.request('/admin/accounts/acc_x/enable', { method: 'POST' });
    expect([302, 200]).toContain(res.status);
  });
});
