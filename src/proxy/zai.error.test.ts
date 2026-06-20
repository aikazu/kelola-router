// src/proxy/zai.error.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('handleZaiProxy error handling', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'zai-err-')), 't.db');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 429 when the requested model is locked (pre-fetch gate)', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { upsertModel } = await import('../db/repos/models.js');
    const { setModelLock } = await import('../accounts/locks.js');
    const { handleZaiProxy } = await import('./zai.js');
    const db = openDb();
    const acc = createAccount(db, {
      id: 'acc_zai_lock',
      label: 'zai',
      credit_type: 'token-plan',
      api_key: 'zai_test',
      base_url: 'https://api.z.ai',
      provider: 'zai',
      enabled: true,
    });
    // Seed a model row so resolveModel succeeds and upstreamModel is the
    // stripped bare id (`glm-5.2`), not the `zai` placeholder.
    upsertModel(db, {
      name: 'zai/glm-5.2',
      provider: 'zai',
      upstream_model: 'zai/glm-5.2',
      enabled: 1,
      pricing_input: 0,
      pricing_output: 0,
    });
    setModelLock(db, acc.id, 'glm-5.2', 60_000);

    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) =>
        k === 'clientKey' ? { id: 'ck_row_1' } : k === 'startTime' ? Date.now() : undefined,
      set: () => {},
      json: (o: unknown, s?: number) => new Response(JSON.stringify(o), { status: s ?? 200 }),
      body: (b: BodyInit, s?: number) => new Response(b, { status: s }),
    } as unknown as Parameters<typeof handleZaiProxy>[0];

    const resp = await handleZaiProxy(
      c,
      'anthropic',
      '/v1/messages',
      {
        model: 'zai/glm-5.2',
        stream: false,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 64,
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
    const { handleZaiProxy } = await import('./zai.js');
    const db = openDb();
    const acc = createAccount(db, {
      id: 'acc_zai_bal',
      label: 'zai',
      credit_type: 'token-plan',
      api_key: 'zai_test',
      base_url: 'https://api.z.ai',
      provider: 'zai',
      enabled: true,
    });
    upsertModel(db, {
      name: 'zai/glm-5.2',
      provider: 'zai',
      upstream_model: 'zai/glm-5.2',
      enabled: 1,
      pricing_input: 0,
      pricing_output: 0,
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
    } as unknown as Parameters<typeof handleZaiProxy>[0];

    await handleZaiProxy(
      c,
      'anthropic',
      '/v1/messages',
      {
        model: 'zai/glm-5.2',
        stream: false,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 64,
      },
      db,
      { value: 0 },
      new Map()
    );
    expect(getAccount(db, acc.id)!.enabled).toBe(0);
  });
});
