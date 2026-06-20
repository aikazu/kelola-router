// src/proxy/zai.anthropic.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('handleZaiProxy — anthropic-format SSE/JSON', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'zai-')), 't.db');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records prompt/completion tokens from real Anthropic Messages SSE (stream=true)', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { upsertModel } = await import('../db/repos/models.js');
    const { handleZaiProxy } = await import('./zai.js');
    const db = openDb();

    createAccount(db, {
      id: 'acc_zai1',
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

    // Real Anthropic Messages SSE stream — `pipeWithUsage(format='anthropic')`
    // must pick up usage from the message_delta event (10/5).
    const sse =
      'event: message_start\n' +
      'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"glm-5.2","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":2,"output_tokens":0}}}\n\n' +
      'event: content_block_start\n' +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"PONG"}}\n\n' +
      'event: content_block_stop\n' +
      'data: {"type":"content_block_stop","index":0}\n\n' +
      'event: message_delta\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":10,"output_tokens":5}}\n\n' +
      'event: message_stop\n' +
      'data: {"type":"message_stop"}\n\n';

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(sse, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    );

    const logged: Array<{
      prompt_tokens: number;
      completion_tokens: number;
      response_body: string | null;
    }> = [];
    vi.spyOn(
      await import('../db/repos/requestLogs.js'),
      'insertRequestLogDeferred'
    ).mockImplementation((_db, row) => {
      logged.push({
        prompt_tokens: row.prompt_tokens as number,
        completion_tokens: row.completion_tokens as number,
        response_body: row.response_body as string | null,
      });
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
    } as unknown as Parameters<typeof handleZaiProxy>[0];

    const resp = await handleZaiProxy(
      c,
      'anthropic',
      '/v1/messages',
      {
        model: 'zai/glm-5.2',
        stream: true,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 64,
      },
      db,
      { value: 0 },
      new Map()
    );
    const body = await resp.text();

    expect(body).toContain('PONG');
    expect(logged.length).toBeGreaterThan(0);
    const row = logged[logged.length - 1];
    expect(row.prompt_tokens).toBe(10);
    expect(row.completion_tokens).toBe(5);
    // The old code logged a literal placeholder instead of the real SSE bytes.
    expect(row.response_body).not.toBe('[anthropic-sse]');
  });

  it('records prompt/completion tokens from Anthropic Messages JSON (stream=false)', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { upsertModel } = await import('../db/repos/models.js');
    const { handleZaiProxy } = await import('./zai.js');
    const db = openDb();

    createAccount(db, {
      id: 'acc_zai2',
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

    const anthropicResp = {
      id: 'msg_2',
      type: 'message',
      role: 'assistant',
      model: 'glm-5.2',
      content: [{ type: 'text', text: 'PONG' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 8, output_tokens: 4 },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(anthropicResp), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const logged: Array<{ prompt_tokens: number; completion_tokens: number }> = [];
    vi.spyOn(
      await import('../db/repos/requestLogs.js'),
      'insertRequestLogDeferred'
    ).mockImplementation((_db, row) => {
      logged.push({
        prompt_tokens: row.prompt_tokens as number,
        completion_tokens: row.completion_tokens as number,
      });
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
    } as unknown as Parameters<typeof handleZaiProxy>[0];

    const resp = await handleZaiProxy(
      c,
      'anthropic',
      '/v1/messages',
      {
        model: 'zai/glm-5.2',
        stream: false,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 64,
      },
      db,
      { value: 0 },
      new Map()
    );
    const out = (await resp.json()) as {
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    expect(out.content[0].text).toBe('PONG');
    expect(logged.length).toBeGreaterThan(0);
    const row = logged[logged.length - 1];
    expect(row.prompt_tokens).toBe(8);
    expect(row.completion_tokens).toBe(4);
  });
});
