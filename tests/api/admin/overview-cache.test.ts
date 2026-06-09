import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAdminCache } from '../../../src/api/admin/cache.js';
import { clearCache as clearSettingsCache } from '../../../src/db/repos/settings.js';
import { app, resetDb } from '../../../src/server.js';

describe('admin overview cache', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'overview-cache-')), 't.db');
    process.env.ROUTER_ADMIN_KEY = 'admin';
    resetDb();
    clearSettingsCache();
    clearAdminCache();
  });

  it('returns the same payload on repeated GET /api/admin/overview?days=1 requests', async () => {
    const first = await app.request('/api/admin/overview?days=1', {
      headers: { 'x-admin-key': 'admin' },
    });
    const second = await app.request('/api/admin/overview?days=1', {
      headers: { 'x-admin-key': 'admin' },
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
  });
});
