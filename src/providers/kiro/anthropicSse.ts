/**
 * Kiro event-stream -> Anthropic Messages SSE assembler.
 *
 * Claude Code and hermes-agent prefer the native Anthropic `/v1/messages`
 * streaming protocol. This emits that wire format directly from decoded Kiro
 * events:
 *
 *   message_start
 *   (content_block_start / content_block_delta* / content_block_stop)*   ← per block
 *   message_delta  (stop_reason + output usage)
 *   message_stop
 *
 * Blocks are sequential (one open at a time): thinking → text → tool_use(s),
 * each with its own incrementing index. Adapted from the 9router reference (MIT).
 */
import { randomUUID } from 'node:crypto';
import type { KiroUsage } from './assembler.js';
import { decodeFrames, type KiroEvent } from './eventstream.js';

type BlockType = 'thinking' | 'text' | 'tool_use';

interface AnthropicEvent {
  event: string;
  data: Record<string, unknown>;
}

export class KiroAnthropicAssembler {
  private readonly messageId = `msg_${randomUUID().replace(/-/g, '')}`;
  private readonly model: string;
  private started = false;
  private stopped = false;
  private blockIndex = -1;
  private current: BlockType | null = null;
  private hasToolCalls = false;
  private readonly seenToolIds = new Map<string, number>();
  private usage: KiroUsage | null = null;
  private totalContentLength = 0;
  private contextUsagePercentage = 0;
  private hasMetering = false;
  private hasContextUsage = false;

  constructor(model: string) {
    this.model = model;
  }

  private ensureStart(out: AnthropicEvent[]): void {
    if (this.started) return;
    this.started = true;
    out.push({
      event: 'message_start',
      data: {
        type: 'message_start',
        message: {
          id: this.messageId,
          type: 'message',
          role: 'assistant',
          model: this.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      },
    });
  }

  private closeBlock(out: AnthropicEvent[]): void {
    if (this.current === null) return;
    out.push({
      event: 'content_block_stop',
      data: { type: 'content_block_stop', index: this.blockIndex },
    });
    this.current = null;
  }

  private openBlock(
    out: AnthropicEvent[],
    type: BlockType,
    contentBlock: Record<string, unknown>
  ): void {
    this.closeBlock(out);
    this.blockIndex++;
    this.current = type;
    out.push({
      event: 'content_block_start',
      data: { type: 'content_block_start', index: this.blockIndex, content_block: contentBlock },
    });
  }

  /** Process one Kiro event into zero or more Anthropic SSE events. */
  process(event: KiroEvent): AnthropicEvent[] {
    const out: AnthropicEvent[] = [];
    const payload = event.payload || {};

    if (
      (event.eventType === 'assistantResponseEvent' || event.eventType === 'codeEvent') &&
      typeof payload.content === 'string'
    ) {
      this.ensureStart(out);
      if (this.current !== 'text') this.openBlock(out, 'text', { type: 'text', text: '' });
      this.totalContentLength += payload.content.length;
      out.push({
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: this.blockIndex,
          delta: { type: 'text_delta', text: payload.content },
        },
      });
    }

    if (event.eventType === 'reasoningContentEvent') {
      const r = (payload.reasoningContentEvent ?? payload) as
        | string
        | { text?: string; content?: string };
      const text = typeof r === 'string' ? r : r.text || r.content || '';
      if (text) {
        this.ensureStart(out);
        if (this.current !== 'thinking') {
          this.openBlock(out, 'thinking', { type: 'thinking', thinking: '' });
        }
        this.totalContentLength += text.length;
        out.push({
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: this.blockIndex,
            delta: { type: 'thinking_delta', thinking: text },
          },
        });
      }
    }

    if (event.eventType === 'toolUseEvent' && payload) {
      this.hasToolCalls = true;
      const list = Array.isArray(payload) ? payload : [payload];
      for (const tu of list as Array<{ toolUseId?: string; name?: string; input?: unknown }>) {
        const toolCallId = tu.toolUseId || `toolu_${randomUUID().replace(/-/g, '')}`;
        const isNew = !this.seenToolIds.has(toolCallId);
        this.ensureStart(out);
        if (isNew) {
          this.seenToolIds.set(toolCallId, this.blockIndex + 1);
          this.openBlock(out, 'tool_use', {
            type: 'tool_use',
            id: toolCallId,
            name: tu.name || '',
            input: {},
          });
        }
        if (tu.input !== undefined) {
          const partial = typeof tu.input === 'string' ? tu.input : JSON.stringify(tu.input);
          out.push({
            event: 'content_block_delta',
            data: {
              type: 'content_block_delta',
              index: this.blockIndex,
              delta: { type: 'input_json_delta', partial_json: partial },
            },
          });
        }
      }
    }

    if (event.eventType === 'contextUsageEvent') {
      const pct = (payload as { contextUsagePercentage?: number }).contextUsagePercentage;
      if (pct) {
        this.contextUsagePercentage = pct;
        this.hasContextUsage = true;
      }
    }
    if (event.eventType === 'meteringEvent') this.hasMetering = true;
    if (event.eventType === 'metricsEvent') {
      const metrics = ((payload as { metricsEvent?: unknown }).metricsEvent ?? payload) as {
        inputTokens?: number;
        outputTokens?: number;
      };
      const inp = metrics.inputTokens || 0;
      const outTok = metrics.outputTokens || 0;
      if (inp > 0 || outTok > 0) {
        this.usage = { prompt_tokens: inp, completion_tokens: outTok, total_tokens: inp + outTok };
      }
    }

    if (event.eventType === 'messageStopEvent') {
      out.push(...this.finalize());
    }
    return out;
  }

  /** Emit the closing message_delta + message_stop (idempotent). */
  finalize(): AnthropicEvent[] {
    if (this.stopped) return [];
    this.stopped = true;
    const out: AnthropicEvent[] = [];
    this.ensureStart(out);
    this.closeBlock(out);
    if (!this.usage) {
      const outTok =
        this.totalContentLength > 0 ? Math.max(1, Math.floor(this.totalContentLength / 4)) : 0;
      const inp =
        this.contextUsagePercentage > 0
          ? Math.floor((this.contextUsagePercentage * 200000) / 100)
          : 0;
      this.usage = { prompt_tokens: inp, completion_tokens: outTok, total_tokens: inp + outTok };
    }
    out.push({
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: {
          stop_reason: this.hasToolCalls ? 'tool_use' : 'end_turn',
          stop_sequence: null,
        },
        usage: {
          input_tokens: this.usage.prompt_tokens,
          output_tokens: this.usage.completion_tokens,
        },
      },
    });
    out.push({ event: 'message_stop', data: { type: 'message_stop' } });
    return out;
  }

  get hasMeteringAndContext(): boolean {
    return this.hasMetering && this.hasContextUsage;
  }
}

const encoder = new TextEncoder();

function serialize(ev: { event: string; data: Record<string, unknown> }): Uint8Array {
  return encoder.encode(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`);
}

/** Wrap a Kiro binary response body as an Anthropic Messages SSE Response. */
export function kiroResponseToAnthropicSSE(response: Response, model: string): Response {
  const assembler = new KiroAnthropicAssembler(model);
  let rest: Uint8Array = new Uint8Array(0);

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const merged = new Uint8Array(rest.length + chunk.length);
      merged.set(rest);
      merged.set(chunk, rest.length);
      const { events, rest: leftover } = decodeFrames(merged);
      rest = leftover;
      for (const event of events) {
        for (const ev of assembler.process(event)) controller.enqueue(serialize(ev));
      }
    },
    flush(controller) {
      for (const ev of assembler.finalize()) controller.enqueue(serialize(ev));
    },
  });

  if (!response.body) {
    const out: Uint8Array[] = [];
    for (const ev of assembler.finalize()) out.push(serialize(ev));
    const merged = new Uint8Array(out.reduce((n, b) => n + b.length, 0));
    let off = 0;
    for (const b of out) {
      merged.set(b, off);
      off += b.length;
    }
    return new Response(merged, {
      status: response.status,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }
  return new Response(response.body.pipeThrough(transform), {
    status: response.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
