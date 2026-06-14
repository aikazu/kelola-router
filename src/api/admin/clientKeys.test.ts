import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../../auth/password.js';
import { openDb } from '../../db/index.js';
import { clearCacheForDb } from '../../db/repos/settings.js';
import { app, resetDb } from '../../server.js';

const REAUTH_COOKIE = 'kelola_reauth';

function seedPassword(plain: string): void {
  const db = openDb();
  const hash = hashPassword(plain);
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('admin_password', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(JSON.stringify(hash));
  clearCacheForDb(db);
}

function seedClientKey(key = 'rk_secret_xyz'): number {
  const db = openDb();
  db.prepare(
    `INSERT INTO client_keys (label, key, enabled, created_at) VALUES ('app', ?, 1, ?)`
  ).run(key, new Date().toISOString());
  const row = db.prepare(`SELECT id FROM client_keys WHERE label='app'`).get() as { id: number };
  return row.id;
}

function auditRows(): Array<{
  id: number;
  event: string;
  client_key_id: number | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}> {
  const db = openDb();
  return db
    .prepare(
      `SELECT id, event, client_key_id, ip, user_agent, created_at
       FROM audit_log ORDER BY id ASC`
    )
    .all() as Array<{
    id: number;
    event: string;
    client_key_id: number | null;
    ip: string | null;
    user_agent: string | null;
    created_at: string;
  }>;
}

describe('GET /api/admin/client-keys/:id/key — audit log', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ck-')), 't.db');
    process.env.ROUTER_ADMIN_KEY = 'ak_test';
    resetDb();
  });

  it('open mode: successful reveal writes one audit row with event/ip/key id/timestamp', async () => {
    const id = seedClientKey();
    const before = Date.now();
    const res = await app.request(`/api/admin/client-keys/${id}/key`, {
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
    });
    expect(res.status).toBe(200);

    const rows = auditRows();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.event).toBe('client_key.reveal');
    expect(row.client_key_id).toBe(id);
    // Left-most x-forwarded-for entry wins.
    expect(row.ip).toBe('203.0.113.7');
    expect(row.user_agent).toBeNull();
    // created_at is a UTC second-precision timestamp (SQLite datetime('now')).
    // Date.now() has ms precision, so allow 1s slack for the truncation.
    const ts = Date.parse(`${row.created_at.replace(' ', 'T')}Z`);
    expect(Number.isNaN(ts)).toBe(false);
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
  });

  it('password mode with valid reauth cookie writes an audit row', async () => {
    seedPassword('correct');
    const id = seedClientKey();
    const res = await app.request(`/api/admin/client-keys/${id}/key`, {
      headers: {
        'x-admin-key': 'ak_test',
        Cookie: `${REAUTH_COOKIE}=verified`,
        'x-forwarded-for': '198.51.100.42',
      },
    });
    expect(res.status).toBe(200);
    const rows = auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event: 'client_key.reveal',
      client_key_id: id,
      ip: '198.51.100.42',
    });
  });

  it('captures User-Agent when provided', async () => {
    const id = seedClientKey();
    await app.request(`/api/admin/client-keys/${id}/key`, {
      headers: {
        'x-forwarded-for': '203.0.113.9',
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Dashboard',
      },
    });
    const rows = auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].user_agent).toBe('Mozilla/5.0 (X11; Linux x86_64) Dashboard');
  });

  it('falls back to "unknown" ip when no x-forwarded-for present', async () => {
    const id = seedClientKey();
    await app.request(`/api/admin/client-keys/${id}/key`);
    const rows = auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].ip).toBe('unknown');
  });

  it('404 (key not found) does NOT write an audit row', async () => {
    const res = await app.request('/api/admin/client-keys/9999/key');
    expect(res.status).toBe(404);
    expect(auditRows()).toHaveLength(0);
  });

  it('401 reauth_required does NOT write an audit row', async () => {
    seedPassword('correct');
    const id = seedClientKey();
    const res = await app.request(`/api/admin/client-keys/${id}/key`, {
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(401);
    expect(auditRows()).toHaveLength(0);
  });

  it('audit insert failure never blocks the key reveal', async () => {
    const id = seedClientKey();
    // Sabotage the audit_log table so the insert throws. The handler must
    // swallow the error and still return 200 + the raw key.
    const db = openDb();
    db.exec('DROP TABLE audit_log');

    const res = await app.request(`/api/admin/client-keys/${id}/key`, {
      headers: { 'x-forwarded-for': '203.0.113.99' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toBe('rk_secret_xyz');
  });

  it('multiple reveals accumulate multiple audit rows', async () => {
    const id = seedClientKey();
    await app.request(`/api/admin/client-keys/${id}/key`, {
      headers: { 'x-forwarded-for': '203.0.113.10' },
    });
    await app.request(`/api/admin/client-keys/${id}/key`, {
      headers: { 'x-forwarded-for': '203.0.113.11' },
    });
    const rows = auditRows();
    expect(rows).toHaveLength(2);
    expect(rows[0].ip).toBe('203.0.113.10');
    expect(rows[1].ip).toBe('203.0.113.11');
  });
});
