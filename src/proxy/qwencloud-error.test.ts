// src/proxy/qwencloud-error.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('handleQwenCloudProxy error handling', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'qwencloud-err-')), 't.db');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const setup = async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount, getAccount } = await import('../db/repos/accounts.js');
    const { upsertModel } = await import('../db/repos/models.js');
    const { handleQwenCloudProxy } = await import('./qwencloud.js');
    const db = openDb();
    const acc = createAccount(db, {
      id: 'acc_qc_err',
      label: 'qwencloud',
      credit_type: 'token-plan',
      api_key: 'sk-sp-test',
      base_url: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic',
      provider: 'qwencloud',
      enabled: true,
    });
    upsertModel(db, {
      name: 'qwen3.8-max',
      provider: 'qwencloud',
      upstream_model: 'qwen3.8-max',
      enabled: 1,
      pricing_input: 0,
      pricing_output: 0,
    });

    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) =>
        k === 'clientKey' ? { id: 'ck_qc' } : k === 'startTime' ? Date.now() : undefined,
      set: () => {},
      json: (obj: unknown, status?: number) =>
        new Response(JSON.stringify(obj), { status: status ?? 200 }),
      body: (b: BodyInit, status?: number, h?: Record<string, string>) =>
        new Response(b, { status, headers: h }),
    } as unknown as Parameters<typeof handleQwenCloudProxy>[0];

    return { db, getAccount, handleQwenCloudProxy, c, acc };
  };

  it('applies account error state and forwards the Aliyun envelope on 401 InvalidApiKey', async () => {
    const { db, getAccount, handleQwenCloudProxy, c, acc } = await setup();

    const envelope = JSON.stringify({
      request_id: '20a7caee-94d2-4834-8f37-86f5e4dd26fc',
      code: 'InvalidApiKey',
      message: 'Invalid API-key provided.',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(envelope, {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    );

    const resp = await handleQwenCloudProxy(
      c,
      'anthropic',
      '/v1/messages',
      {
        model: 'qctp/qwen3.8-max',
        stream: false,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 64,
      },
      db,
      { value: 0 },
      new Map()
    );

    expect(resp.status).toBe(401);
    const body = (await resp.json()) as { code: string };
    expect(body.code).toBe('InvalidApiKey');
    // 401 → account status flips to 'error' via applyErrorState.
    expect(getAccount(db, acc.id)!.status).toBe('error');
  });

  it('forwards the Aliyun envelope on 400 InvalidParameter (unknown model)', async () => {
    const { db, getAccount, handleQwenCloudProxy, c, acc } = await setup();

    const envelope = JSON.stringify({
      request_id: 'a34a0eab-771a-4bfe-af86-47cb11f34773',
      code: 'InvalidParameter',
      message: 'Model not exist.',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(envelope, {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    );

    const resp = await handleQwenCloudProxy(
      c,
      'anthropic',
      '/v1/messages',
      {
        model: 'qctp/qwen3.8-max',
        stream: false,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 64,
      },
      db,
      { value: 0 },
      new Map()
    );

    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { code: string; message: string };
    expect(body.code).toBe('InvalidParameter');
    expect(body.message).toContain('Model not exist');
    // 400 is a caller error → account stays active (status unchanged).
    expect(getAccount(db, acc.id)!.status).toBe('active');
  });
});
