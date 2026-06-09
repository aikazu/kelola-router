import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAdminCache } from '../../../src/api/admin/cache.js';
import { openDb } from '../../../src/db/index.js';
import { createAccount } from '../../../src/db/repos/accounts.js';
import { createClientKey } from '../../../src/db/repos/client_keys.js';
import { insertRequestLog } from '../../../src/db/repos/requestLogs.js';
import { clearCache as clearSettingsCache } from '../../../src/db/repos/settings.js';
import { app, resetDb } from '../../../src/server.js';

describe('admin usage cache', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'usage-cache-')), 't.db');
    process.env.ROUTER_ADMIN_KEY = 'admin';
    resetDb();
    clearSettingsCache();
    clearAdminCache();
  });

  it('returns the same payload on repeated GET /api/admin/usage?days=1 requests', async () => {
    const first = await app.request('/api/admin/usage?days=1', {
      headers: { 'x-admin-key': 'admin' },
    });
    const second = await app.request('/api/admin/usage?days=1', {
      headers: { 'x-admin-key': 'admin' },
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
  });

  it('separates cached usage responses by response-shaping query params', async () => {
    const db = openDb();
    const clientKey = createClientKey(db, { label: 'usage-cache', key: 'rk_usage_cache' });
    createAccount(db, { id: 'acc-1', label: 'Main', credit_type: 'payg', api_key: 'k' });

    insertRequestLog(db, {
      client_key_id: clientKey.id,
      account_id: 'acc-1',
      model: 'alpha',
      endpoint: '/v1/messages',
      format: 'openai',
      prompt_tokens: 1,
      completion_tokens: 1,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 2,
      cost_usd: 1,
      latency_ms: 10,
      status_code: 200,
      stream: 0,
      rtk_bytes_saved: 0,
    });
    insertRequestLog(db, {
      client_key_id: clientKey.id,
      account_id: 'acc-1',
      model: 'beta',
      endpoint: '/v1/messages',
      format: 'openai',
      prompt_tokens: 1,
      completion_tokens: 1,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 2,
      cost_usd: 2,
      latency_ms: 20,
      status_code: 500,
      stream: 0,
      rtk_bytes_saved: 0,
    });

    const first = await app.request(
      '/api/admin/usage?days=1&page_size=1&sort_by=cost_usd&sort_dir=asc',
      {
        headers: { 'x-admin-key': 'admin' },
      }
    );
    const second = await app.request(
      '/api/admin/usage?days=1&page_size=1&sort_by=cost_usd&sort_dir=desc',
      {
        headers: { 'x-admin-key': 'admin' },
      }
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(firstBody.page.rows).toHaveLength(1);
    expect(secondBody.page.rows).toHaveLength(1);
    expect(firstBody.page.rows[0]?.model).toBe('alpha');
    expect(secondBody.page.rows[0]?.model).toBe('beta');
  });
});
