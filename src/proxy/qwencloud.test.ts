// src/proxy/qwencloud.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('handleQwenCloudProxy — happy path', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'qwencloud-')), 't.db');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const setup = async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { upsertModel } = await import('../db/repos/models.js');
    const { handleQwenCloudProxy } = await import('./qwencloud.js');
    const db = openDb();

    createAccount(db, {
      id: 'acc_qc1',
      label: 'qwencloud',
      credit_type: 'token-plan',
      api_key: 'sk-sp-test',
      base_url: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic',
      provider: 'qwencloud',
      enabled: true,
    });
    // qwencloud rows store bare ids (no `qctp/` prefix).
    upsertModel(db, {
      name: 'qwen3.8-max',
      provider: 'qwencloud',
      upstream_model: 'qwen3.8-max',
      enabled: 1,
      pricing_input: 0,
      pricing_output: 0,
    });

    const logged: Array<{
      prompt_tokens: number;
      completion_tokens: number;
      requested_model: string | null;
    }> = [];
    vi.spyOn(
      await import('../db/repos/request-logs.js'),
      'insertRequestLogDeferred'
    ).mockImplementation((_db, row) => {
      logged.push({
        prompt_tokens: row.prompt_tokens as number,
        completion_tokens: row.completion_tokens as number,
        requested_model: row.requested_model as string | null,
      });
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

    return { db, handleQwenCloudProxy, c, logged };
  };

  const anthropicSse = (messageId: string): string =>
    'event: ping\n' +
    'data:{"type":"ping"}\n\n' +
    'event: message_start\n' +
    `data:{"type":"message_start","message":{"id":"${messageId}","type":"message","role":"assistant","model":"qwen3.8-max","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":63,"output_tokens":0}}}\n\n` +
    'event: content_block_start\n' +
    'data:{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}\n\n' +
    'event: content_block_delta\n' +
    'data:{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"We"}}\n\n' +
    'event: content_block_delta\n' +
    'data:{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig123"}}\n\n' +
    'event: content_block_stop\n' +
    'data:{"type":"content_block_stop","index":0}\n\n' +
    'event: content_block_start\n' +
    'data:{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n' +
    'event: content_block_delta\n' +
    'data:{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"ok"}}\n\n' +
    'event: content_block_stop\n' +
    'data:{"type":"content_block_stop","index":1}\n\n' +
    'event: message_delta\n' +
    'data:{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":63,"output_tokens":23,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"prompt_tokens_details":{"cached_tokens":0}}}\n\n' +
    'event: message_stop\n' +
    'data:{"type":"message_stop"}\n\n';

  it('streams native Anthropic SSE + records usage from message_delta (anthropic client, stream=true)', async () => {
    const { db, handleQwenCloudProxy, c, logged } = await setup();

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(anthropicSse('msg_stream_1'), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    );

    const resp = await handleQwenCloudProxy(
      c,
      'anthropic',
      '/v1/messages',
      {
        model: 'qctp/qwen3.8-max',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 64,
      },
      db,
      { value: 0 },
      new Map()
    );
    const body = await resp.text();

    expect(body).toContain('ok');
    expect(logged.length).toBeGreaterThan(0);
    const row = logged[logged.length - 1];
    expect(row.prompt_tokens).toBe(63);
    expect(row.completion_tokens).toBe(23);
    expect(row.requested_model).toBe('qctp/qwen3.8-max');
  });

  it('aggregates API to JSON for a non-stream anthropic client', async () => {
    const { db, handleQwenCloudProxy, c, logged } = await setup();

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(anthropicSse('msg_2'), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    );

    const resp = await handleQwenCloudProxy(
      c,
      'anthropic',
      '/v1/messages',
      {
        model: 'qctp/qwen3.8-max',
        // no stream key → non-stream client, but upstream transform forces stream:true
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 64,
      },
      db,
      { value: 0 },
      new Map()
    );
    const out = (await resp.json()) as {
      id: string;
      type: string;
      content: Array<{ type: string; text?: string; thinking?: string }>;
      stop_reason: string | null;
      usage: { input_tokens: number; output_tokens: number };
    };

    expect(out.type).toBe('message');
    expect(out.id).toBe('msg_2');
    // thinking block first, then text block.
    expect(out.content[0].type).toBe('thinking');
    expect(out.content[0].thinking).toContain('We');
    expect(out.content[1].type).toBe('text');
    expect(out.content[1].text).toBe('ok');
    expect(out.stop_reason).toBe('end_turn');
    expect(out.usage.input_tokens).toBe(63);
    expect(out.usage.output_tokens).toBe(23);

    expect(logged.length).toBeGreaterThan(0);
    const row = logged[logged.length - 1];
    expect(row.prompt_tokens).toBe(63);
    expect(row.completion_tokens).toBe(23);
  });

  it('converts the response to OpenAI shape for a non-stream openai client', async () => {
    const { db, handleQwenCloudProxy, c, logged } = await setup();

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(anthropicSse('msg_3'), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    );

    const resp = await handleQwenCloudProxy(
      c,
      'openai',
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
    const out = (await resp.json()) as {
      object: string;
      choices: Array<{ message: { content: string | null; reasoning_content?: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    expect(out.object).toBe('chat.completion');
    expect(out.choices[0].message.content).toBe('ok');
    expect(out.choices[0].message.reasoning_content).toContain('We');
    expect(out.usage.prompt_tokens).toBe(63);
    expect(out.usage.completion_tokens).toBe(23);

    expect(logged.length).toBeGreaterThan(0);
    const row = logged[logged.length - 1];
    expect(row.prompt_tokens).toBe(63);
    expect(row.completion_tokens).toBe(23);
  });

  it('rejects OpenAI streaming explicitly with 501', async () => {
    const { db, handleQwenCloudProxy, c } = await setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const resp = await handleQwenCloudProxy(
      c,
      'openai',
      '/v1/messages',
      {
        model: 'qctp/qwen3.8-max',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 64,
      },
      db,
      { value: 0 },
      new Map()
    );
    const body = (await resp.json()) as { error: { message: string } };

    expect(resp.status).toBe(501);
    expect(body.error.message).toContain('does not support OpenAI streaming');
    // no upstream call was made for the rejected combination
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
