import { describe, expect, it } from 'vitest';
import { KiroAnthropicAssembler } from './anthropicSse.js';
import type { KiroEvent } from './eventstream.js';

function run(events: KiroEvent[]): Array<{ event: string; data: Record<string, unknown> }> {
  const a = new KiroAnthropicAssembler('claude-sonnet-4-5');
  const out: Array<{ event: string; data: Record<string, unknown> }> = [];
  for (const e of events) out.push(...a.process(e));
  out.push(...a.finalize());
  return out;
}

const ev = (eventType: string, payload: Record<string, unknown>): KiroEvent => ({
  eventType,
  headers: {},
  payload,
});

describe('KiroAnthropicAssembler', () => {
  it('emits a well-formed text message stream', () => {
    const out = run([
      ev('assistantResponseEvent', { content: 'Hello ' }),
      ev('assistantResponseEvent', { content: 'world' }),
      ev('messageStopEvent', {}),
    ]);
    const types = out.map((e) => e.event);
    expect(types[0]).toBe('message_start');
    expect(types).toContain('content_block_start');
    expect(types).toContain('content_block_delta');
    expect(types).toContain('content_block_stop');
    expect(types).toContain('message_delta');
    expect(types[types.length - 1]).toBe('message_stop');

    const deltas = out.filter((e) => e.event === 'content_block_delta');
    const texts = deltas.map((d) => (d.data.delta as { text?: string }).text);
    expect(texts.join('')).toBe('Hello world');

    const start = out[0]!.data.message as { content: unknown[]; role: string };
    expect(start.role).toBe('assistant');
  });

  it('emits a thinking block before text when reasoning arrives first', () => {
    const out = run([
      ev('reasoningContentEvent', { text: 'thinking...' }),
      ev('assistantResponseEvent', { content: 'answer' }),
      ev('messageStopEvent', {}),
    ]);
    const starts = out.filter((e) => e.event === 'content_block_start');
    expect((starts[0]!.data.content_block as { type: string }).type).toBe('thinking');
    expect((starts[1]!.data.content_block as { type: string }).type).toBe('text');
    const thinkingDelta = out.find(
      (e) =>
        e.event === 'content_block_delta' &&
        (e.data.delta as { type?: string }).type === 'thinking_delta'
    );
    expect((thinkingDelta!.data.delta as { thinking: string }).thinking).toBe('thinking...');
  });

  it('emits tool_use blocks with input_json_delta and tool_use stop reason', () => {
    const out = run([
      ev('toolUseEvent', { toolUseId: 't1', name: 'get_weather', input: { city: 'London' } }),
      ev('messageStopEvent', {}),
    ]);
    const start = out.find((e) => e.event === 'content_block_start')!;
    const block = start.data.content_block as { type: string; id: string; name: string };
    expect(block.type).toBe('tool_use');
    expect(block.id).toBe('t1');
    expect(block.name).toBe('get_weather');
    const jsonDelta = out.find(
      (e) =>
        e.event === 'content_block_delta' &&
        (e.data.delta as { type?: string }).type === 'input_json_delta'
    )!;
    expect((jsonDelta.data.delta as { partial_json: string }).partial_json).toBe(
      JSON.stringify({ city: 'London' })
    );
    const msgDelta = out.find((e) => e.event === 'message_delta')!;
    expect((msgDelta.data.delta as { stop_reason: string }).stop_reason).toBe('tool_use');
  });

  it('finalize is idempotent (messageStop then flush emits stop once)', () => {
    const a = new KiroAnthropicAssembler('claude-sonnet-4-5');
    const out = [
      ...a.process(ev('assistantResponseEvent', { content: 'hi' })),
      ...a.process(ev('messageStopEvent', {})),
      ...a.finalize(),
    ];
    expect(out.filter((e) => e.event === 'message_stop')).toHaveLength(1);
  });
});
