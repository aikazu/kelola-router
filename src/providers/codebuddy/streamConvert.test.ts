// src/providers/codebuddy/streamConvert.test.ts
import { describe, expect, it } from 'vitest';
import { OpenAIToAnthropicSSEAssembler } from './streamConvert.js';

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
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } },
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
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '{"ci' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ty":"SF"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const start = ev.find((e) => e.event === 'content_block_start');
    expect((start?.data.content_block as { type: string; name: string; id: string }).type).toBe('tool_use');
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
