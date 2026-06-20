// src/proxy/pioneer.cost.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('handlePioneerProxy — cost accounting', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'pio-')), 't.db');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records non-zero cost when pricing is keyed by upstream model (pioneer/<model>)', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { upsertModel } = await import('../db/repos/models.js');
    const { handlePioneerProxy } = await import('./pioneer.js');
    const db = openDb();

    createAccount(db, {
      id: 'acc_pio1',
      label: 'pio',
      credit_type: 'token-plan',
      api_key: 'pk_test',
      base_url: 'https://api.pioneer.app',
      provider: 'pioneer',
      enabled: true,
    });

    upsertModel(db, {
      name: 'pioneer/claude-opus-4-8',
      provider: 'pioneer',
      upstream_model: 'pioneer/claude-opus-4-8',
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
    } as unknown as Parameters<typeof handlePioneerProxy>[0];

    const resp = await handlePioneerProxy(
      c,
      'openai',
      '/v1/chat/completions',
      {
        model: 'pio/claude-opus-4-8',
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
    expect(row.model).toBe('pioneer/claude-opus-4-8');
    expect(row.costUsd).toBeGreaterThan(0);
  });
});
