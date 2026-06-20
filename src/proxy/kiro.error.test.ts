// src/proxy/kiro.error.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('handleKiroProxy error handling', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'kiro-')), 't.db');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 429 when the requested model is locked (pre-fetch gate)', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount, updateAccount } = await import('../db/repos/accounts.js');
    const { upsertModel } = await import('../db/repos/models.js');
    const { setModelLock } = await import('../accounts/locks.js');
    const { handleKiroProxy } = await import('./kiro.js');
    const db = openDb();
    const acc = createAccount(db, {
      id: 'acc_k1',
      label: 'k',
      credit_type: 'token-plan',
      api_key: 'kk',
      provider: 'kiro',
      enabled: true,
    });
    // Cache a valid access token so ensureAccessToken short-circuits without a real refresh call.
    updateAccount(db, acc.id, {
      access_token: 'cached-bearer',
      token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    upsertModel(db, {
      name: 'kiro/claude',
      upstream_model: 'claude',
      provider: 'kiro',
      enabled: 1,
    });
    setModelLock(db, acc.id, 'claude', 60_000);

    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) =>
        k === 'clientKey' ? { id: 'ck_row_1' } : k === 'startTime' ? Date.now() : undefined,
      set: () => {},
      json: (o: unknown, s?: number) => new Response(JSON.stringify(o), { status: s ?? 200 }),
      body: (b: BodyInit, s?: number) => new Response(b, { status: s }),
    } as unknown as Parameters<typeof handleKiroProxy>[0];

    const resp = await handleKiroProxy(
      c,
      'openai',
      '/v1/chat/completions',
      {
        model: 'kr/claude',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      },
      db,
      { value: 0 },
      new Map()
    );
    expect(resp.status).toBe(429);
  });

  it('sets a model lock + applies error state on a 429 upstream', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount, updateAccount } = await import('../db/repos/accounts.js');
    const { upsertModel } = await import('../db/repos/models.js');
    const { getModelLock } = await import('../accounts/locks.js');
    const { handleKiroProxy } = await import('./kiro.js');
    const db = openDb();
    const acc = createAccount(db, {
      id: 'acc_k2',
      label: 'k',
      credit_type: 'token-plan',
      api_key: 'kk',
      provider: 'kiro',
      enabled: true,
    });
    updateAccount(db, acc.id, {
      access_token: 'cached-bearer',
      token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    upsertModel(db, {
      name: 'kiro/claude',
      upstream_model: 'claude',
      provider: 'kiro',
      enabled: 1,
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('rate limit reached', {
        status: 429,
        headers: { 'retry-after': '5' },
      })
    );

    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) =>
        k === 'clientKey' ? { id: 'ck_row_1' } : k === 'startTime' ? Date.now() : undefined,
      set: () => {},
      json: (o: unknown, s?: number) => new Response(JSON.stringify(o), { status: s ?? 200 }),
      body: (b: BodyInit, s?: number) => new Response(b, { status: s }),
    } as unknown as Parameters<typeof handleKiroProxy>[0];

    await handleKiroProxy(
      c,
      'openai',
      '/v1/chat/completions',
      {
        model: 'kr/claude',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      },
      db,
      { value: 0 },
      new Map()
    );
    expect(getModelLock(db, acc.id, 'claude')).toBeDefined();
  });
});
