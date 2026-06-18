import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../db/index.js';
import { createCombo } from '../../db/repos/combos.js';
import { getModel, upsertModel } from '../../db/repos/models.js';
import { app, resetDb } from '../../server.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'mp-')), 't.db');
  process.env.ROUTER_ADMIN_KEY = 'ak_test';
  resetDb();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('PATCH /api/admin/models/:name', () => {
  it('updates editable fields, leaves name + upstream_model immutable', async () => {
    const db = openDb();
    upsertModel(db, {
      name: 'pioneer/gpt-5.5',
      upstream_model: 'gpt-5.5',
      provider: 'pioneer',
      source: 'fetched',
      pricing_input: 1,
    });
    const res = await app.request('/api/admin/models/pioneer%2Fgpt-5.5', {
      method: 'PATCH',
      headers: { 'x-admin-key': 'ak_test', 'content-type': 'application/json' },
      body: JSON.stringify({ pricingInput: 5, contextOutput: 8192, displayName: 'GPT 5.5' }),
    });
    expect(res.status).toBe(200);
    const m = getModel(db, 'pioneer/gpt-5.5')!;
    expect(m.pricing_input).toBe(5);
    expect(m.context_output).toBe(8192);
    expect(m.display_name).toBe('GPT 5.5');
    expect(m.upstream_model).toBe('gpt-5.5');
  });

  it('returns 404 when the model does not exist', async () => {
    const res = await app.request('/api/admin/models/pioneer%2Fnope', {
      method: 'PATCH',
      headers: { 'x-admin-key': 'ak_test', 'content-type': 'application/json' },
      body: JSON.stringify({ pricingInput: 5 }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_found');
  });

  it('rejects an empty patch with 400', async () => {
    const db = openDb();
    upsertModel(db, {
      name: 'pioneer/gpt-5.5',
      upstream_model: 'gpt-5.5',
      provider: 'pioneer',
      source: 'fetched',
    });
    const res = await app.request('/api/admin/models/pioneer%2Fgpt-5.5', {
      method: 'PATCH',
      headers: { 'x-admin-key': 'ak_test', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid field types with 400', async () => {
    const db = openDb();
    upsertModel(db, {
      name: 'pioneer/gpt-5.5',
      upstream_model: 'gpt-5.5',
      provider: 'pioneer',
      source: 'fetched',
    });
    const res = await app.request('/api/admin/models/pioneer%2Fgpt-5.5', {
      method: 'PATCH',
      headers: { 'x-admin-key': 'ak_test', 'content-type': 'application/json' },
      body: JSON.stringify({ pricingInput: 'not-a-number' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects unknown fields with 400', async () => {
    const db = openDb();
    upsertModel(db, {
      name: 'pioneer/gpt-5.5',
      upstream_model: 'gpt-5.5',
      provider: 'pioneer',
      source: 'fetched',
    });
    const res = await app.request('/api/admin/models/pioneer%2Fgpt-5.5', {
      method: 'PATCH',
      headers: { 'x-admin-key': 'ak_test', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'pioneer/hacked' }),
    });
    expect(res.status).toBe(400);
    const m = getModel(db, 'pioneer/gpt-5.5');
    expect(m?.name).toBe('pioneer/gpt-5.5'); // immutable — not renamed
  });
});

describe('GET /api/admin/models list response', () => {
  it('includes contextOutput and comboCount per model', async () => {
    const db = openDb();
    upsertModel(db, {
      name: 'pioneer/gpt-5.5',
      upstream_model: 'gpt-5.5',
      provider: 'pioneer',
      source: 'fetched',
      context_output: 4096,
    });
    createCombo(db, 'chain', ['pioneer/gpt-5.5']);
    const res = await app.request('/api/admin/models', { headers: { 'x-admin-key': 'ak_test' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    const target = body.find((m) => m.name === 'pioneer/gpt-5.5');
    expect(target).toBeDefined();
    expect(target!.contextOutput).toBe(4096);
    expect(target!.comboCount).toBe(1);
  });
});
