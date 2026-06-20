// src/proxy/codebuddy.cost.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('handleCodeBuddyProxy — cost accounting', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'cb-cost-')), 't.db');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records non-zero cost when pricing is keyed by upstream model (codebuddy/<model>)', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { upsertModel } = await import('../db/repos/models.js');
    const { handleCodeBuddyProxy } = await import('./codebuddy.js');
    const db = openDb();

    createAccount(db, {
      id: 'acc_cb_cost1',
      label: 'cb',
      credit_type: 'token-plan',
      api_key: 'ck_test',
      base_url: 'https://www.codebuddy.ai',
      provider: 'codebuddy',
      enabled: true,
    });

    upsertModel(db, {
      name: 'codebuddy/claude-opus-4.6',
      provider: 'codebuddy',
      upstream_model: 'codebuddy/claude-opus-4.6',
      enabled: 1,
      pricing_input: 15,
      pricing_output: 75,
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        'data: ' +
          JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }) +
          '\n\n' +
          'data: ' +
          JSON.stringify({
            choices: [{ delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }) +
          '\n\n' +
          'data: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    );

    const logged: Array<{ model: string; costUsd: number }> = [];
    vi.spyOn(
      await import('../db/repos/requestLogs.js'),
      'insertRequestLogDeferred'
    ).mockImplementation((_db, row) => {
      logged.push({ model: row.model as string, costUsd: row.cost_usd as number });
    });

    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) =>
        k === 'clientKey' ? { id: 'ck1' } : k === 'startTime' ? Date.now() : undefined,
      set: () => {},
      json: (obj: unknown, status?: number) =>
        new Response(JSON.stringify(obj), { status: status ?? 200 }),
      body: (b: BodyInit, status?: number, h?: Record<string, string>) =>
        new Response(b, { status, headers: h }),
    } as unknown as Parameters<typeof handleCodeBuddyProxy>[0];

    const resp = await handleCodeBuddyProxy(
      c,
      'openai',
      '/v1/chat/completions',
      {
        model: 'cb/claude-opus-4.6',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      },
      db,
      { value: 0 },
      new Map()
    );
    await resp.text();

    expect(logged.length).toBeGreaterThan(0);
    const row = logged[logged.length - 1];
    expect(row.model).toBe('codebuddy/claude-opus-4.6');
    expect(row.costUsd).toBeGreaterThan(0);
  });
});
