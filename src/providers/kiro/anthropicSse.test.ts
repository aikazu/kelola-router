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

  // ---------------------------------------------------------------------------
  // Byte-identical snapshot fixture (regression detector for SseAssemblerBase refactor)
  // ---------------------------------------------------------------------------
  // Captures the full AnthropicEvent[] output for a representative KiroEvent
  // sequence (text + thinking + text + tool_use + contextUsage + metrics + stop).
  // The `message.id` is masked to "msg_UUID" so the snapshot is deterministic.
  // If a future change alters the emitted event shape, this test fails BEFORE
  // shipping — protecting every Anthropic client using provider=kiro streaming.
  it('emits byte-identical output for representative input (regression fixture)', () => {
    const a = new KiroAnthropicAssembler('claude-sonnet-4-5');
    const out: Array<{ event: string; data: Record<string, unknown> }> = [];
    for (const e of [
      ev('assistantResponseEvent', { content: 'Hello ' }),
      ev('reasoningContentEvent', { text: 'thinking...' }),
      ev('assistantResponseEvent', { content: 'world!' }),
      ev('toolUseEvent', { toolUseId: 't1', name: 'get_weather', input: { city: 'London' } }),
      ev('contextUsageEvent', { contextUsagePercentage: 75 }),
      ev('metricsEvent', { inputTokens: 100, outputTokens: 50 }),
      ev('meteringEvent', {}),
      ev('messageStopEvent', {}),
    ]) {
      out.push(...a.process(e));
    }
    out.push(...a.finalize());

    // Mask dynamic messageId (UUID) so snapshot is deterministic.
    const normalized = JSON.stringify(out, null, 2).replace(
      /"id":\s*"msg_[a-f0-9]+"/g,
      '"id": "msg_UUID"'
    );
    expect(normalized).toMatchInlineSnapshot(`
      "[
        {
          "event": "message_start",
          "data": {
            "type": "message_start",
            "message": {
              "id": "msg_UUID",
              "type": "message",
              "role": "assistant",
              "model": "claude-sonnet-4-5",
              "content": [],
              "stop_reason": null,
              "stop_sequence": null,
              "usage": {
                "input_tokens": 0,
                "output_tokens": 0
              }
            }
          }
        },
        {
          "event": "content_block_start",
          "data": {
            "type": "content_block_start",
            "index": 0,
            "content_block": {
              "type": "text",
              "text": ""
            }
          }
        },
        {
          "event": "content_block_delta",
          "data": {
            "type": "content_block_delta",
            "index": 0,
            "delta": {
              "type": "text_delta",
              "text": "Hello "
            }
          }
        },
        {
          "event": "content_block_stop",
          "data": {
            "type": "content_block_stop",
            "index": 0
          }
        },
        {
          "event": "content_block_start",
          "data": {
            "type": "content_block_start",
            "index": 1,
            "content_block": {
              "type": "thinking",
              "thinking": ""
            }
          }
        },
        {
          "event": "content_block_delta",
          "data": {
            "type": "content_block_delta",
            "index": 1,
            "delta": {
              "type": "thinking_delta",
              "thinking": "thinking..."
            }
          }
        },
        {
          "event": "content_block_stop",
          "data": {
            "type": "content_block_stop",
            "index": 1
          }
        },
        {
          "event": "content_block_start",
          "data": {
            "type": "content_block_start",
            "index": 2,
            "content_block": {
              "type": "text",
              "text": ""
            }
          }
        },
        {
          "event": "content_block_delta",
          "data": {
            "type": "content_block_delta",
            "index": 2,
            "delta": {
              "type": "text_delta",
              "text": "world!"
            }
          }
        },
        {
          "event": "content_block_stop",
          "data": {
            "type": "content_block_stop",
            "index": 2
          }
        },
        {
          "event": "content_block_start",
          "data": {
            "type": "content_block_start",
            "index": 3,
            "content_block": {
              "type": "tool_use",
              "id": "t1",
              "name": "get_weather",
              "input": {}
            }
          }
        },
        {
          "event": "content_block_delta",
          "data": {
            "type": "content_block_delta",
            "index": 3,
            "delta": {
              "type": "input_json_delta",
              "partial_json": "{\\"city\\":\\"London\\"}"
            }
          }
        },
        {
          "event": "content_block_stop",
          "data": {
            "type": "content_block_stop",
            "index": 3
          }
        },
        {
          "event": "message_delta",
          "data": {
            "type": "message_delta",
            "delta": {
              "stop_reason": "tool_use",
              "stop_sequence": null
            },
            "usage": {
              "input_tokens": 100,
              "output_tokens": 50
            }
          }
        },
        {
          "event": "message_stop",
          "data": {
            "type": "message_stop"
          }
        }
      ]"
    `);
  });
});
