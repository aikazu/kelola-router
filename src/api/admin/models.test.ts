import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../db/index.js';
import { getModel } from '../../db/repos/models.js';
import { app, resetDb } from '../../server.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'mpost-')), 't.db');
  process.env.ROUTER_ADMIN_KEY = 'ak_test';
  resetDb();
});

describe('POST /api/admin/models', () => {
  it('persists family on manual POST /api/admin/models', async () => {
    const res = await app.request('/api/admin/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': 'ak_test' },
      body: JSON.stringify({
        name: 'my-custom-model',
        displayName: 'My Custom',
        provider: 'minimax',
        contextWindow: 32000,
        pricingInput: 1,
        pricingOutput: 2,
        family: 'custom',
      }),
    });
    expect(res.status).toBe(201);
    const db = openDb();
    const row = getModel(db, 'my-custom-model');
    expect(row?.family).toBe('custom');
  });

  it('leaves family null when omitted on manual POST', async () => {
    const res = await app.request('/api/admin/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': 'ak_test' },
      body: JSON.stringify({
        name: 'no-family-model',
        displayName: 'No Family',
        provider: 'minimax',
      }),
    });
    expect(res.status).toBe(201);
    const db = openDb();
    const row = getModel(db, 'no-family-model');
    expect(row?.family).toBeNull();
  });

  it('normalizes whitespace-only family to null on manual POST', async () => {
    const res = await app.request('/api/admin/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': 'ak_test' },
      body: JSON.stringify({
        name: 'ws-family-model',
        displayName: 'WS Family',
        provider: 'minimax',
        family: '   ',
      }),
    });
    expect(res.status).toBe(201);
    const db = openDb();
    const row = getModel(db, 'ws-family-model');
    expect(row?.family).toBeNull();
  });
});
