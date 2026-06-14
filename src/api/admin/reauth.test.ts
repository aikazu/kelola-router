import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../../auth/password.js';
import { openDb } from '../../db/index.js';
import { clearCacheForDb } from '../../db/repos/settings.js';
import { app, resetDb } from '../../server.js';

const REAUTH_COOKIE = 'kelola_reauth';

/**
 * Insert a real (validly-hashed) admin password so isPasswordSet() === true and
 * verifyPassword() can actually succeed against the given plaintext.
 */
function seedPassword(plain: string): void {
  const db = openDb();
  const hash = hashPassword(plain);
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('admin_password', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(JSON.stringify(hash));
  clearCacheForDb(db);
}

function seedClientKey(): number {
  const db = openDb();
  db.prepare(
    `INSERT INTO client_keys (label, key, enabled, created_at) VALUES ('app', 'rk_secret_xyz', 1, ?)`
  ).run(new Date().toISOString());
  const row = db.prepare(`SELECT id FROM client_keys WHERE label='app'`).get() as { id: number };
  return row.id;
}

describe('POST /api/admin/reauth/verify', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reauth-')), 't.db');
    process.env.ROUTER_ADMIN_KEY = 'ak_test';
    resetDb();
  });

  it('returns 401 when password set and no admin auth provided', async () => {
    seedPassword('correct');
    const res = await app.request('/api/admin/reauth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 no_password_configured when no admin password set (open mode)', async () => {
    // No password seeded → isPasswordSet === false → cannot reauth what doesn't exist
    const res = await app.request('/api/admin/reauth/verify', {
      method: 'POST',
      headers: { 'x-admin-key': 'ak_test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'whatever' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('no_password_configured');
  });

  it('returns 401 wrong_password on mismatch', async () => {
    seedPassword('correct');
    const res = await app.request('/api/admin/reauth/verify', {
      method: 'POST',
      headers: { 'x-admin-key': 'ak_test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('wrong_password');
  });

  it('returns 200 + sets short-lived kelola_reauth cookie on correct password', async () => {
    seedPassword('correct');
    const res = await app.request('/api/admin/reauth/verify', {
      method: 'POST',
      headers: { 'x-admin-key': 'ak_test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct' }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    // Cookie carries the verified marker, is HttpOnly, SameSite=Strict, scoped to /api/admin,
    // and expires after 60 seconds.
    expect(setCookie).toContain(`${REAUTH_COOKIE}=verified`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toContain('Max-Age=60');
    expect(setCookie).toMatch(/Path=\/api\/admin/i);
    // Must NOT log the password or echo it back
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('correct');
  });

  it('returns 403 cross-origin POST without matching Origin', async () => {
    seedPassword('correct');
    const res = await app.request('/api/admin/reauth/verify', {
      method: 'POST',
      headers: {
        'x-admin-key': 'ak_test',
        'Content-Type': 'application/json',
        Origin: 'http://evil.com',
        Host: 'localhost:20137',
      },
      body: JSON.stringify({ password: 'correct' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('cross-origin request blocked');
  });

  it('succeeds when Origin omitted (permissive same-server / curl)', async () => {
    seedPassword('correct');
    const res = await app.request('/api/admin/reauth/verify', {
      method: 'POST',
      headers: { 'x-admin-key': 'ak_test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain(`${REAUTH_COOKIE}=verified`);
  });
});

describe('POST /api/admin/reauth/clear', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reauth-')), 't.db');
    process.env.ROUTER_ADMIN_KEY = 'ak_test';
    resetDb();
  });

  it('returns 401 when password set and no admin auth provided', async () => {
    seedPassword('correct');
    const res = await app.request('/api/admin/reauth/clear', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('returns 204 + clears the reauth cookie', async () => {
    const res = await app.request('/api/admin/reauth/clear', {
      method: 'POST',
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(204);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain(`${REAUTH_COOKIE}=`);
    expect(setCookie).toContain('Max-Age=0');
  });
});

describe('reauth gate on GET /api/admin/client-keys/:id/key', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reauth-')), 't.db');
    process.env.ROUTER_ADMIN_KEY = 'ak_test';
    resetDb();
  });

  it('open mode (no password set) returns raw key without any reauth cookie', async () => {
    const id = seedClientKey();
    const res = await app.request(`/api/admin/client-keys/${id}/key`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toBe('rk_secret_xyz');
  });

  it('password mode without reauth cookie returns 401 reauth_required', async () => {
    seedPassword('correct');
    const id = seedClientKey();
    const res = await app.request(`/api/admin/client-keys/${id}/key`, {
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('reauth_required');
  });

  it('password mode with valid reauth cookie returns raw key', async () => {
    seedPassword('correct');
    const id = seedClientKey();
    const res = await app.request(`/api/admin/client-keys/${id}/key`, {
      headers: {
        'x-admin-key': 'ak_test',
        Cookie: `${REAUTH_COOKIE}=verified`,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toBe('rk_secret_xyz');
  });

  it('password mode with stale/invalid reauth cookie value returns 401 reauth_required', async () => {
    seedPassword('correct');
    const id = seedClientKey();
    const res = await app.request(`/api/admin/client-keys/${id}/key`, {
      headers: {
        'x-admin-key': 'ak_test',
        Cookie: `${REAUTH_COOKIE}=stale`,
      },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('reauth_required');
  });
});

describe('reauth cookie expiry (Max-Age=60)', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reauth-')), 't.db');
    process.env.ROUTER_ADMIN_KEY = 'ak_test';
    resetDb();
  });
  afterEach(() => {
    delete process.env.ROUTER_COOKIE_SECURE;
  });

  /**
   * The reauth cookie is a pure client-side marker — there is no server-side
   * store. Expiry is enforced by the browser/cookie jar via Max-Age, not by
   * our gate (which only checks the cookie *value*). So the correct test for
   * "expires after 60s" is to assert the Set-Cookie header carries Max-Age=60;
   * real-time sleeping would only re-test the HTTP client's cookie jar.
   */
  it('verify response sets Max-Age=60 (short-lived) and not longer', async () => {
    seedPassword('correct');
    const res = await app.request('/api/admin/reauth/verify', {
      method: 'POST',
      headers: { 'x-admin-key': 'ak_test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct' }),
    });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('Max-Age=60');
    // Guard against accidental extension — no higher Max-Age should appear.
    const ageMatch = setCookie.match(/Max-Age=(\d+)/i);
    expect(ageMatch).not.toBeNull();
    expect(Number(ageMatch?.[1])).toBe(60);
  });

  it('adds Secure attribute when request is HTTPS (x-forwarded-proto=https)', async () => {
    seedPassword('correct');
    const res = await app.request('/api/admin/reauth/verify', {
      method: 'POST',
      headers: {
        'x-admin-key': 'ak_test',
        'Content-Type': 'application/json',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({ password: 'correct' }),
    });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/Secure/i);
  });
});
