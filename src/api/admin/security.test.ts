import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../../auth/password.js';
import { openDb } from '../../db/index.js';
import { clearCacheForDb } from '../../db/repos/settings.js';
import { app, resetDb } from '../../server.js';

/**
 * Insert a real (validly-hashed) admin password so isPasswordSet() === true,
 * which in turn makes requireAdminJson enforce auth on /admin/*.
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

describe('GET /api/admin/security/status', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'sec-')), 't.db');
    process.env.ROUTER_ADMIN_KEY = 'ak_test';
    resetDb();
  });

  afterEach(() => {
    // Never leak ROUTER_DB_KEY between tests — it controls the dbEncrypted flag.
    delete process.env.ROUTER_DB_KEY;
    delete process.env.ROUTER_ADMIN_KEY;
  });

  it('returns 401 when password is set and no admin auth is provided', async () => {
    seedPassword('correct');
    const res = await app.request('/api/admin/security/status');
    expect(res.status).toBe(401);
  });

  it('returns 200 { adminPasswordSet: false, dbEncrypted: false } in open mode without ROUTER_DB_KEY', async () => {
    // No password seeded (open mode) → requireAdminJson lets the request through.
    // No ROUTER_DB_KEY set.
    const res = await app.request('/api/admin/security/status', {
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ adminPasswordSet: false, dbEncrypted: false });
    // Must not leak any secret material.
    expect(JSON.stringify(body)).not.toContain('ak_test');
  });

  it('returns 200 { adminPasswordSet: true, dbEncrypted: false } when password set but no ROUTER_DB_KEY', async () => {
    seedPassword('correct');
    const res = await app.request('/api/admin/security/status', {
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ adminPasswordSet: true, dbEncrypted: false });
    // Never echo the password or its hash.
    expect(JSON.stringify(body)).not.toContain('correct');
  });

  it('returns 200 { adminPasswordSet: true, dbEncrypted: true } when password set and ROUTER_DB_KEY set', async () => {
    // Set the key BEFORE seeding the password so the DB file is created
    // encrypted from the start. openDb() refuses a plaintext file once
    // ROUTER_DB_KEY is set (fresh-deploy-only policy, v0.15).
    process.env.ROUTER_DB_KEY = '0'.repeat(64);
    seedPassword('correct');
    const res = await app.request('/api/admin/security/status', {
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ adminPasswordSet: true, dbEncrypted: true });
    // Must never expose the key value itself.
    expect(JSON.stringify(body)).not.toContain('0'.repeat(64));
  });
});
