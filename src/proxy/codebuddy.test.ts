// src/proxy/codebuddy.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetLockCleanupThrottle } from '../accounts/locks.js';

describe('handleCodeBuddyProxy', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'cb-')), 't.db');
    _resetLockCleanupThrottle();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('converts an upstream OpenAI SSE stream to Anthropic SSE for an anthropic client', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { handleCodeBuddyProxy } = await import('./codebuddy.js');
    const db = openDb();
    createAccount(db, {
      id: 'acc_cb1',
      label: 'cb',
      credit_type: 'token-plan',
      api_key: 'ck_test',
      base_url: 'https://www.codebuddy.ai',
      provider: 'codebuddy',
      enabled: true,
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        'data: ' +
          JSON.stringify({ choices: [{ delta: { content: 'PONG' } }] }) +
          '\n\n' +
          'data: ' +
          JSON.stringify({
            choices: [{ delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }) +
          '\n\n' +
          'data: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    );

    // Minimal Hono-like context stub.
    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) =>
        k === 'clientKey' ? { id: 'ck_row_1' } : k === 'startTime' ? Date.now() : undefined,
      set: () => {},
      json: (obj: unknown, status?: number) =>
        new Response(JSON.stringify(obj), { status: status ?? 200 }),
      body: (b: BodyInit, status?: number, headers?: Record<string, string>) =>
        new Response(b, { status, headers }),
    } as unknown as Parameters<typeof handleCodeBuddyProxy>[0];

    const resp = await handleCodeBuddyProxy(
      c,
      'anthropic',
      '/v1/messages',
      {
        model: 'cb/claude-opus-4.6',
        max_tokens: 10,
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      },
      db,
      { value: 0 },
      new Map()
    );
    const text = await resp.text();
    expect(text).toContain('event: message_start');
    expect(text).toContain('"text":"PONG"');
    expect(text).toContain('event: message_stop');
  });

  it('disables the account on a balance error (base_resp 1008)', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount, getAccount } = await import('../db/repos/accounts.js');
    const { handleCodeBuddyProxy } = await import('./codebuddy.js');
    const db = openDb();
    const acc = createAccount(db, {
      id: 'acc_cb_balance',
      label: 'cb',
      credit_type: 'token-plan',
      api_key: 'ck_test',
      base_url: 'https://www.codebuddy.ai',
      provider: 'codebuddy',
      enabled: true,
    });

    const errBody = JSON.stringify({ base_resp: { status_code: 1008 } });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(errBody, {
        status: 402,
        headers: { 'content-type': 'application/json' },
      })
    );

    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) =>
        k === 'clientKey' ? { id: 'ck_row_1' } : k === 'startTime' ? Date.now() : undefined,
      set: () => {},
      json: (obj: unknown, status?: number) =>
        new Response(JSON.stringify(obj), { status: status ?? 200 }),
      body: (b: BodyInit, status?: number, headers?: Record<string, string>) =>
        new Response(b, { status, headers }),
    } as unknown as Parameters<typeof handleCodeBuddyProxy>[0];

    await handleCodeBuddyProxy(
      c,
      'anthropic',
      '/v1/messages',
      {
        model: 'cb/claude-opus-4.6',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      },
      db,
      { value: 0 },
      new Map()
    );
    expect(getAccount(db, acc.id)!.enabled).toBe(0);
  });

  it('returns 429 when the upstream model is locked (pre-fetch gate)', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { setModelLock } = await import('../accounts/locks.js');
    const { handleCodeBuddyProxy } = await import('./codebuddy.js');
    const db = openDb();
    const acc = createAccount(db, {
      id: 'acc_cb_lock',
      label: 'cb',
      credit_type: 'token-plan',
      api_key: 'ck_test',
      base_url: 'https://www.codebuddy.ai',
      provider: 'codebuddy',
      enabled: true,
    });
    // No upsertModel → resolveModel throws → upstreamModel stays as the
    // 'codebuddy' placeholder. Lock must match that placeholder.
    setModelLock(db, acc.id, 'codebuddy', 60_000);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) =>
        k === 'clientKey' ? { id: 'ck_row_1' } : k === 'startTime' ? Date.now() : undefined,
      set: () => {},
      json: (obj: unknown, status?: number) =>
        new Response(JSON.stringify(obj), { status: status ?? 200 }),
      body: (b: BodyInit, status?: number, headers?: Record<string, string>) =>
        new Response(b, { status, headers }),
    } as unknown as Parameters<typeof handleCodeBuddyProxy>[0];

    const resp = await handleCodeBuddyProxy(
      c,
      'anthropic',
      '/v1/messages',
      {
        model: 'cb/claude-opus-4.6',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      },
      db,
      { value: 0 },
      new Map()
    );
    expect(resp.status).toBe(429);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
