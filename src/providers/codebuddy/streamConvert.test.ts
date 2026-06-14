// src/providers/codebuddy/streamConvert.test.ts
import { describe, expect, it } from 'vitest';
import {
  aggregateOpenAISSE,
  OpenAIToAnthropicSSEAssembler,
  openaiSSEToAnthropicSSE,
} from './streamConvert.js';

// Minimal OpenAI streaming chunk shape used by the assembler.
type Chunk = {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

function run(chunks: Chunk[]): { event: string; data: Record<string, unknown> }[] {
  const a = new OpenAIToAnthropicSSEAssembler('claude-opus-4.6');
  const out: { event: string; data: Record<string, unknown> }[] = [];
  for (const ch of chunks) out.push(...a.process(ch));
  out.push(...a.finalize());
  return out;
}

describe('OpenAIToAnthropicSSEAssembler', () => {
  it('emits a well-formed text message', () => {
    const ev = run([
      { choices: [{ delta: { content: 'PI' } }] },
      { choices: [{ delta: { content: 'NG' } }] },
      {
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      },
    ]);
    const types = ev.map((e) => e.event);
    expect(types[0]).toBe('message_start');
    expect(types).toContain('content_block_start');
    expect(types).toContain('content_block_delta');
    expect(types).toContain('content_block_stop');
    expect(types).toContain('message_delta');
    expect(types.at(-1)).toBe('message_stop');

    const text = ev
      .filter((e) => e.event === 'content_block_delta')
      .map((e) => (e.data.delta as { text?: string }).text ?? '')
      .join('');
    expect(text).toBe('PING');

    const md = ev.find((e) => e.event === 'message_delta');
    expect((md?.data.delta as { stop_reason?: string }).stop_reason).toBe('end_turn');
    expect((md?.data.usage as { output_tokens?: number }).output_tokens).toBe(2);
  });

  it('maps reasoning_content to a thinking block before text', () => {
    const ev = run([
      { choices: [{ delta: { reasoning_content: 'hmm' } }] },
      { choices: [{ delta: { content: 'hi' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]);
    const starts = ev.filter((e) => e.event === 'content_block_start');
    expect((starts[0].data.content_block as { type: string }).type).toBe('thinking');
    expect((starts[1].data.content_block as { type: string }).type).toBe('text');
  });

  it('assembles streamed tool_calls into a tool_use block with input_json_delta', () => {
    const ev = run([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '{"ci' } },
              ],
            },
          },
        ],
      },
      {
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ty":"SF"}' } }] } }],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const start = ev.find((e) => e.event === 'content_block_start');
    expect((start?.data.content_block as { type: string; name: string; id: string }).type).toBe(
      'tool_use'
    );
    expect((start?.data.content_block as { name: string }).name).toBe('get_weather');
    expect((start?.data.content_block as { id: string }).id).toBe('call_1');
    const json = ev
      .filter((e) => e.event === 'content_block_delta')
      .map((e) => (e.data.delta as { partial_json?: string }).partial_json ?? '')
      .join('');
    expect(json).toBe('{"city":"SF"}');
    const md = ev.find((e) => e.event === 'message_delta');
    expect((md?.data.delta as { stop_reason?: string }).stop_reason).toBe('tool_use');
  });
});

function sseResponse(lines: string[]): Response {
  const body = lines.map((l) => `data: ${l}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('openaiSSEToAnthropicSSE', () => {
  it('converts an upstream OpenAI SSE response into Anthropic SSE bytes', async () => {
    const upstream = sseResponse([
      JSON.stringify({ choices: [{ delta: { content: 'PING' } }] }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    ]);
    let captured: { prompt_tokens: number; completion_tokens: number } | null = null;
    const out = openaiSSEToAnthropicSSE(upstream, 'claude-opus-4.6', (u) => {
      captured = u;
    });
    const text = await out.text();
    expect(text).toContain('event: message_start');
    expect(text).toContain('"type":"text_delta","text":"PING"');
    expect(text).toContain('event: message_stop');
    expect(captured).toEqual({
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
      cache_read: 0,
    });
    expect(out.headers.get('content-type')).toBe('text/event-stream');
  });
});

describe('openaiSSEToAnthropicSSE error propagation', () => {
  it('propagates a mid-stream upstream error instead of truncating silently', async () => {
    // Build a stream that errors after the first chunk is delivered.
    // iterSSEChunks uses reader.read() in a loop; erroring the controller
    // on the second pull causes reader.read() to reject, which propagates
    // through the try/catch in openaiSSEToAnthropicSSE's start() and
    // calls controller.error(err) on the output stream.
    let pulled = 0;
    const failing = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(
          new TextEncoder().encode(
            'data: ' + JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }) + '\n\n'
          )
        );
      },
      pull(c) {
        pulled++;
        if (pulled >= 1) c.error(new Error('upstream exploded'));
      },
    });
    const upstream = new Response(failing, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    const out = openaiSSEToAnthropicSSE(upstream, 'claude-opus-4.6');
    // Reading the converted response must reject (not silently truncate).
    await expect(out.text()).rejects.toThrow();
  });
});

describe('aggregateOpenAISSE', () => {
  it('buffers streamed deltas into one OpenAI response', async () => {
    const upstream = sseResponse([
      JSON.stringify({
        id: 'x',
        model: 'gemini-3.5-flash',
        choices: [{ delta: { role: 'assistant', content: 'he' } }],
      }),
      JSON.stringify({ choices: [{ delta: { content: 'llo' } }] }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }),
    ]);
    const resp = await aggregateOpenAISSE(upstream);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(resp.choices![0].message.content).toBe('hello');
    expect(resp.choices![0].finish_reason).toBe('stop');
    expect(resp.usage?.completion_tokens).toBe(2);
    expect(resp.object).toBe('chat.completion');
  });

  it('aggregates tool_calls fragments', async () => {
    const upstream = sseResponse([
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: 'c1', function: { name: 'f', arguments: '{"a"' } }],
            },
          },
        ],
      }),
      JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] } }],
      }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
    ]);
    const resp = await aggregateOpenAISSE(upstream);
    const tc = resp.choices![0].message.tool_calls?.[0];
    expect(tc?.id).toBe('c1');
    expect(tc?.function.name).toBe('f');
    expect(tc?.function.arguments).toBe('{"a":1}');
    expect(resp.choices![0].finish_reason).toBe('tool_calls');
  });
});
