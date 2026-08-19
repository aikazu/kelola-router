// src/proxy/pioneer.error.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('handlePioneerProxy error handling', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'pio-')), 't.db');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 429 when the requested model is locked (pre-fetch gate)', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { upsertModel } = await import('../db/repos/models.js');
    const { setModelLock } = await import('../accounts/locks.js');
    const { handlePioneerProxy } = await import('./pioneer.js');
    const db = openDb();
    const acc = createAccount(db, {
      id: 'acc_pio_lock',
      label: 'pio',
      credit_type: 'token-plan',
      api_key: 'pk_test',
      base_url: 'https://api.pioneer.app',
      provider: 'pioneer',
      enabled: true,
    });
    // Seed a model row so resolveModel succeeds and upstreamModel is the
    // stripped bare id (`sonnet`), not the `pioneer` placeholder.
    upsertModel(db, {
      name: 'pioneer/sonnet',
      upstream_model: 'pioneer/sonnet',
      provider: 'pioneer',
      enabled: 1,
    });
    setModelLock(db, acc.id, 'sonnet', 60_000);

    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) =>
        k === 'clientKey' ? { id: 'ck_row_1' } : k === 'startTime' ? Date.now() : undefined,
      set: () => {},
      json: (o: unknown, s?: number) => new Response(JSON.stringify(o), { status: s ?? 200 }),
      body: (b: BodyInit, s?: number) => new Response(b, { status: s }),
    } as unknown as Parameters<typeof handlePioneerProxy>[0];

    const resp = await handlePioneerProxy(
      c,
      'openai',
      '/v1/chat/completions',
      {
        model: 'pio/sonnet',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      },
      db,
      { value: 0 },
      new Map()
    );
    expect(resp.status).toBe(429);
  });

  it('disables the account on a balance error (base_resp.status_code 1008)', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount, getAccount } = await import('../db/repos/accounts.js');
    const { upsertModel } = await import('../db/repos/models.js');
    const { handlePioneerProxy } = await import('./pioneer.js');
    const db = openDb();
    const acc = createAccount(db, {
      id: 'acc_pio_bal',
      label: 'pio',
      credit_type: 'token-plan',
      api_key: 'pk_test',
      base_url: 'https://api.pioneer.app',
      provider: 'pioneer',
      enabled: true,
    });
    upsertModel(db, {
      name: 'pioneer/sonnet',
      upstream_model: 'pioneer/sonnet',
      provider: 'pioneer',
      enabled: 1,
    });

    // body contains base_resp.status_code === 1008 → balance decision → disableAccount.
    const balanceBody = JSON.stringify({
      base_resp: { status_code: 1008, status_msg: 'insufficient balance' },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(balanceBody, {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    );

    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) =>
        k === 'clientKey' ? { id: 'ck_row_1' } : k === 'startTime' ? Date.now() : undefined,
      set: () => {},
      json: (o: unknown, s?: number) => new Response(JSON.stringify(o), { status: s ?? 200 }),
      body: (b: BodyInit, s?: number) => new Response(b, { status: s }),
    } as unknown as Parameters<typeof handlePioneerProxy>[0];

    await handlePioneerProxy(
      c,
      'openai',
      '/v1/chat/completions',
      {
        model: 'pio/sonnet',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      },
      db,
      { value: 0 },
      new Map()
    );
    expect(getAccount(db, acc.id)!.enabled).toBe(0);
  });
});
