import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../db/index.js';
import { upsertAlias } from '../../db/repos/aliases.js';
import { createCombo } from '../../db/repos/combos.js';
import { upsertModel } from '../../db/repos/models.js';
import { app, resetDb } from '../../server.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'mr-')), 't.db');
  process.env.ROUTER_ADMIN_KEY = 'ak_test';
  resetDb();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/admin/models/:name/refs', () => {
  it('lists aliases + combos referencing the model', async () => {
    const db = openDb();
    upsertModel(db, {
      name: 'pioneer/claude-opus-4-8',
      upstream_model: 'claude-opus-4-8',
      provider: 'pioneer',
      source: 'fetched',
    });
    upsertAlias(db, { aliasName: 'opus', upstreamModel: 'claude-opus-4-8' });
    createCombo(db, 'fast', ['pioneer/claude-opus-4-8']);

    const res = await app.request('/api/admin/models/pioneer%2Fclaude-opus-4-8/refs', {
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      aliases: { aliasName: string }[];
      combos: { id: string; comboName: string }[];
    };
    expect(body.aliases.map((a) => a.aliasName)).toEqual(['opus']);
    expect(body.combos.map((c) => c.comboName)).toEqual(['fast']);
  });

  it('returns 404 when the model does not exist', async () => {
    const res = await app.request('/api/admin/models/pioneer%2Fnope/refs', {
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/models/:name', () => {
  it('deletes an unreferenced model', async () => {
    const db = openDb();
    upsertModel(db, {
      name: 'pioneer/lonely',
      upstream_model: 'lonely',
      provider: 'pioneer',
      source: 'fetched',
    });
    const res = await app.request('/api/admin/models/pioneer%2Flonely', {
      method: 'DELETE',
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(200);
    const row = db.prepare(`SELECT 1 FROM models WHERE name = 'pioneer/lonely'`).get();
    expect(row).toBeUndefined();
  });

  it('blocks delete with 409 when an alias references it', async () => {
    const db = openDb();
    upsertModel(db, {
      name: 'pioneer/gpt-5.5',
      upstream_model: 'gpt-5.5',
      provider: 'pioneer',
      source: 'fetched',
    });
    upsertAlias(db, { aliasName: 'gpt', upstreamModel: 'gpt-5.5' });
    const res = await app.request('/api/admin/models/pioneer%2Fgpt-5.5', {
      method: 'DELETE',
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      refs: { aliases: unknown[]; combos: unknown[] };
    };
    expect(body.error).toBe('has_refs');
    expect(body.refs.aliases).toHaveLength(1);
    expect(body.refs.combos).toHaveLength(0);
    // Model still exists (not deleted).
    const row = db.prepare(`SELECT 1 FROM models WHERE name = 'pioneer/gpt-5.5'`).get();
    expect(row).toBeDefined();
  });

  it('blocks delete with 409 when a combo references it', async () => {
    const db = openDb();
    upsertModel(db, {
      name: 'pioneer/cb',
      upstream_model: 'cb',
      provider: 'pioneer',
      source: 'fetched',
    });
    createCombo(db, 'chain', ['pioneer/cb']);
    const res = await app.request('/api/admin/models/pioneer%2Fcb', {
      method: 'DELETE',
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      refs: { combos: unknown[]; aliases: unknown[] };
    };
    expect(body.error).toBe('has_refs');
    expect(body.refs.combos).toHaveLength(1);
    expect(body.refs.aliases).toHaveLength(0);
  });
});
