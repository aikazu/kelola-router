/**
 * Kiro event-stream -> Anthropic Messages SSE assembler.
 *
 * Extends {@link SseAssemblerBase} — the shared state machine (ensureStart,
 * closeBlock, openBlock, flush) lives in the base. This subclass provides the
 * Kiro-specific per-event encoding logic via the abstract hooks, plus a
 * `process()` override for Kiro event types that don't fit the base's default
 * 1-block-1-delta orchestrator (tool arrays, metadata-only events,
 * messageStop-triggered finalization).
 *
 * Emitted wire format:
 *   message_start
 *   (content_block_start / content_block_delta* / content_block_stop)*   ← per block
 *   message_delta  (stop_reason + output usage)
 *   message_stop
 *
 * Blocks are sequential (one open at a time): thinking → text → tool_use(s),
 * each with its own incrementing index. Adapted from the 9router reference (MIT).
 */
import { randomUUID } from 'node:crypto';
import {
  type AnthropicEvent,
  type BlockSpec,
  SseAssemblerBase,
} from '../common/SseAssemblerBase.js';
import type { KiroUsage } from './assembler.js';
import type { KiroEvent } from './eventstream.js';
import { consumeKiroFrames } from './streamConsumer.js';

export class KiroAnthropicAssembler extends SseAssemblerBase<KiroEvent> {
  private hasToolCalls = false;
  private readonly seenToolIds = new Map<string, number>();
  private usage: KiroUsage | null = null;
  private totalContentLength = 0;
  private contextUsagePercentage = 0;
  private hasMetering = false;
  private hasContextUsage = false;

  // -------------------------------------------------------------------------
  // Abstract-hook implementations
  // -------------------------------------------------------------------------

  protected createStartEvent(): AnthropicEvent {
    return {
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
    };
  }

  protected createBlockEvent(input: KiroEvent): BlockSpec | null {
    const payload = input.payload || {};

    // Text content
    if (
      (input.eventType === 'assistantResponseEvent' || input.eventType === 'codeEvent') &&
      typeof payload.content === 'string'
    ) {
      if (this.current === 'text') return null;
      return { type: 'text', contentBlock: { type: 'text', text: '' } };
    }

    // Thinking content
    if (input.eventType === 'reasoningContentEvent') {
      if (this.current === 'thinking') return null;
      return { type: 'thinking', contentBlock: { type: 'thinking', thinking: '' } };
    }

    return null;
  }

  protected createDeltaEvent(input: KiroEvent): AnthropicEvent | null {
    const payload = input.payload || {};

    // Text content
    if (
      (input.eventType === 'assistantResponseEvent' || input.eventType === 'codeEvent') &&
      typeof payload.content === 'string'
    ) {
      this.totalContentLength += payload.content.length;
      return {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: this.blockIndex,
          delta: { type: 'text_delta', text: payload.content },
        },
      };
    }

    // Thinking content
    if (input.eventType === 'reasoningContentEvent') {
      const r = (payload.reasoningContentEvent ?? payload) as
        | string
        | { text?: string; content?: string };
      const text = typeof r === 'string' ? r : r.text || r.content || '';
      if (!text) return null;
      this.totalContentLength += text.length;
      return {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: this.blockIndex,
          delta: { type: 'thinking_delta', thinking: text },
        },
      };
    }

    return null;
  }

  protected createFinishEvent(): AnthropicEvent[] {
    if (!this.usage) {
      const outTok =
        this.totalContentLength > 0 ? Math.max(1, Math.floor(this.totalContentLength / 4)) : 0;
      const inp =
        this.contextUsagePercentage > 0
          ? Math.floor((this.contextUsagePercentage * 200000) / 100)
          : 0;
      this.usage = { prompt_tokens: inp, completion_tokens: outTok, total_tokens: inp + outTok };
    }
    return [
      {
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
      },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ];
  }

  protected getErrorEvent(err: unknown): AnthropicEvent {
    return { event: 'error', data: { type: 'error', error: String(err) } };
  }

  // -------------------------------------------------------------------------
  // Process — Kiro-specific event routing
  // -------------------------------------------------------------------------

  /**
   * Process one Kiro event into zero or more Anthropic SSE events.
   *
   * Overrides the base template method because Kiro events are richer than the
   * default 1-block-1-delta orchestrator supports: metadata events emit nothing,
   * tool-use events can carry an array of tool calls (multiple blocks + deltas),
   * and `messageStopEvent` triggers finalization. Text/thinking events delegate
   * to `super.process()` which uses the abstract hooks.
   */
  process(event: KiroEvent): AnthropicEvent[] {
    const payload = event.payload || {};

    // Metadata events — update internal state, emit nothing.
    if (event.eventType === 'contextUsageEvent') {
      const pct = (payload as { contextUsagePercentage?: number }).contextUsagePercentage;
      if (pct) {
        this.contextUsagePercentage = pct;
        this.hasContextUsage = true;
      }
      return this.drain();
    }
    if (event.eventType === 'meteringEvent') {
      this.hasMetering = true;
      return this.drain();
    }
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
      return this.drain();
    }

    // messageStopEvent — trigger finalization.
    if (event.eventType === 'messageStopEvent') {
      this.flush();
      return this.drain();
    }

    // Tool use — custom handling: one event can carry multiple tool calls,
    // each opening its own block and emitting its own input_json_delta.
    if (event.eventType === 'toolUseEvent' && payload) {
      this.hasToolCalls = true;
      const list = Array.isArray(payload) ? payload : [payload];
      this.ensureStart();
      for (const tu of list as Array<{ toolUseId?: string; name?: string; input?: unknown }>) {
        const toolCallId = tu.toolUseId || `toolu_${randomUUID().replace(/-/g, '')}`;
        const isNew = !this.seenToolIds.has(toolCallId);
        if (isNew) {
          this.seenToolIds.set(toolCallId, this.blockIndex + 1);
          this.openBlock('tool_use', {
            type: 'tool_use',
            id: toolCallId,
            name: tu.name || '',
            input: {},
          });
        }
        if (tu.input !== undefined) {
          const partial = typeof tu.input === 'string' ? tu.input : JSON.stringify(tu.input);
          this.push({
            event: 'content_block_delta',
            data: {
              type: 'content_block_delta',
              index: this.blockIndex,
              delta: { type: 'input_json_delta', partial_json: partial },
            },
          });
        }
      }
      return this.drain();
    }

    // Text + thinking events — delegate to the base template method which
    // uses createBlockEvent + createDeltaEvent.
    super.process(event);
    return this.drain();
  }

  /** Emit the closing message_delta + message_stop (idempotent). */
  finalize(): AnthropicEvent[] {
    this.flush();
    return this.drain();
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

  const outputStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for await (const event of consumeKiroFrames(response.body!)) {
        for (const ev of assembler.process(event)) controller.enqueue(serialize(ev));
      }
      for (const ev of assembler.finalize()) controller.enqueue(serialize(ev));
      controller.close();
    },
  });

  return new Response(outputStream, {
    status: response.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
