import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../db/index.js';
import { clearCacheForDb } from '../../db/repos/settings.js';
import { app, resetDb } from '../../server.js';

describe('GET /api/admin/settings', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'settings-')), 't.db');
    process.env.ROUTER_ADMIN_KEY = 'ak_test';
    resetDb();
  });

  // Migration 001-initial.ts seeds defaults for all four keys, so this branch
  // is unreachable in production. We test it explicitly because A7 makes null
  // a documented contract; any future migration that drops a seed must keep
  // the client fallback working.
  it('returns null when a setting has been deleted (not defaulted)', async () => {
    const db = openDb();
    db.prepare(`DELETE FROM settings WHERE key IN ('caveman','caching','rtk','minimax')`).run();
    clearCacheForDb(db);

    const res = await app.request('/api/admin/settings', {
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.caveman).toBeNull();
    expect(body.caching).toBeNull();
    expect(body.rtk).toBeNull();
    expect(body.minimax).toBeNull();
  });

  it('returns the persisted value when a key is written', async () => {
    await app.request('/api/admin/settings/caveman', {
      method: 'POST',
      headers: { 'x-admin-key': 'ak_test', 'content-type': 'application/json' },
      body: JSON.stringify({ level: 'terse' }),
    });
    const res = await app.request('/api/admin/settings', {
      headers: { 'x-admin-key': 'ak_test' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.caveman).toEqual({ level: 'terse' });
    // caching/rtk/minimax were seeded by migration — keep their existing values.
    expect((body.caching as { autoBreakpoints?: boolean }).autoBreakpoints).toBe(true);
    expect((body.rtk as { enabled?: boolean }).enabled).toBe(true);
  });
});
