import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../db/index.js';
import { createAccount } from '../../db/repos/accounts.js';
import { app, resetDb } from '../../server.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'mf-')), 't.db');
  process.env.ROUTER_ADMIN_KEY = 'ak_test';
  resetDb();
});

describe('POST /api/admin/models/fetch/:provider', () => {
  it('seeds minimax models from the first active minimax account', async () => {
    const db = openDb();
    createAccount(db, {
      id: 'acc_mm',
      label: 'MM',
      credit_type: 'payg',
      api_key: 'mm_k',
      provider: 'minimax',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'MiniMax-M3' }] }), { status: 200 })
    );
    const res = await app.request('/api/admin/models/fetch/minimax', {
      method: 'POST',
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { added: number; total: number };
    expect(body.added).toBe(1);
  });

  it('seeds pioneer models (deduped) from the first active pioneer account', async () => {
    const db = openDb();
    createAccount(db, {
      id: 'acc_pio',
      label: 'PIO',
      credit_type: 'payg',
      api_key: 'pio_sk_test',
      provider: 'pioneer',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: 'gpt-5.5', max_input_tokens: 1000, max_tokens: 500 },
            { id: 'anthropic/pioneer/gpt-5.5', max_input_tokens: 1000, max_tokens: 500 },
          ],
        }),
        { status: 200 }
      )
    );
    const res = await app.request('/api/admin/models/fetch/pioneer', {
      method: 'POST',
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { added: number; total: number };
    expect(body.total).toBe(1);
  });

  it('returns 404 for a provider without a model-list endpoint', async () => {
    const res = await app.request('/api/admin/models/fetch/kiro', {
      method: 'POST',
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when no active account exists for the provider', async () => {
    const res = await app.request('/api/admin/models/fetch/minimax', {
      method: 'POST',
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(400);
  });
});
