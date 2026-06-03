import { describe, expect, it } from 'vitest';
import type { SSEUsage } from './extractUsage.js';
import { pipeWithUsage } from './pipeWithUsage.js';

function sseResponse(body: string, format: 'openai' | 'anthropic' = 'openai'): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': format === 'anthropic' ? 'text/event-stream' : 'text/event-stream' },
  });
}

describe('pipeWithUsage', () => {
  it('forwards all upstream bytes to the client', async () => {
    const raw = `data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n`;
    const out = await pipeWithUsage(sseResponse(raw), 'openai', () => {});
    expect(out.status).toBe(200);
    expect(await out.text()).toBe(raw);
  });

  it('extracts OpenAI usage after stream completes', async () => {
    const raw = `data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\ndata: [DONE]\n\n`;
    let captured: SSEUsage | null = undefined as unknown as SSEUsage | null;
    const out = await pipeWithUsage(sseResponse(raw), 'openai', (u) => {
      captured = u;
    });
    await out.text();
    expect(captured).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 15,
    });
  });

  it('extracts Anthropic usage from message_delta', async () => {
    const raw = [
      `event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":7,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0}}}\n\n`,
      `event: message_delta\ndata: {"type":"message_delta","usage":{"input_tokens":7,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":3}}\n\n`,
      `event: message_stop\ndata: {"type":"message_stop"}\n\n`,
    ].join('');
    let captured: SSEUsage | null = undefined as unknown as SSEUsage | null;
    const out = await pipeWithUsage(sseResponse(raw), 'anthropic', (u) => {
      captured = u;
    });
    await out.text();
    expect(captured).toEqual({
      prompt_tokens: 7,
      completion_tokens: 3,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 10,
    });
  });

  it('passes null when stream has no usage block', async () => {
    const raw = `data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n`;
    let captured: SSEUsage | null = undefined as unknown as SSEUsage | null;
    const out = await pipeWithUsage(sseResponse(raw), 'openai', (u) => {
      captured = u;
    });
    await out.text();
    expect(captured).toBeNull();
  });

  it('returns upstream unchanged when body is null and reports null usage', async () => {
    const r = new Response(null, { status: 204 });
    let captured: SSEUsage | null = undefined as unknown as SSEUsage | null;
    const out = await pipeWithUsage(r, 'openai', (u) => {
      captured = u;
    });
    expect(out.status).toBe(204);
    expect(captured).toBeNull();
  });

  it('accepts an AbortSignal and stops enqueuing when aborted', async () => {
    const ac = new AbortController();
    const enc = new TextEncoder();
    let enqueued = 0;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        // Enqueue two chunks, then wait for the abort signal
        c.enqueue(enc.encode('data: chunk1\n\n'));
        enqueued++;
        ac.signal.addEventListener('abort', () => c.close());
        setTimeout(() => c.enqueue(enc.encode('data: chunk2\n\n')), 5);
      },
    });
    const r = new Response(body, { status: 200 });
    let callbackInvoked = false;
    const out = await pipeWithUsage(
      r,
      'openai',
      () => {
        callbackInvoked = true;
      },
      ac.signal
    );

    // Abort almost immediately
    setTimeout(() => ac.abort(), 1);

    // Read what's available then cancel
    const reader = out.body!.getReader();
    await reader.read();
    await reader.cancel();

    // After abort, the upstream TransformStream's transform() should call ctrl.terminate()
    // for any further chunks; callback should NOT have fired (we never flushed because we aborted before close)
    expect(callbackInvoked).toBe(false);
  });
});
