// src/providers/codebuddy/streamConvert.ts
import { randomUUID } from 'node:crypto';
import {
  type AnthropicEvent,
  type BlockSpec,
  SseAssemblerBase,
} from '../common/SseAssemblerBase.js';
import type { OpenAIResponse } from '../format/message-types.js';

/** OpenAI streaming chunk (subset the converter reads). */
export interface OpenAIStreamChunk {
  id?: string;
  model?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

const FINISH_TO_STOP: Record<string, string> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  content_filter: 'refusal',
};

/**
 * OpenAI SSE → Anthropic Messages SSE assembler.
 *
 * Extends {@link SseAssemblerBase} — the shared state machine (ensureStart,
 * closeBlock, openBlock, flush) lives in the base. This subclass provides
 * OpenAI-chunk-specific encoding via the abstract hooks, plus a `process()`
 * override because a single OpenAI chunk can carry multiple content types
 * (reasoning_content + content + tool_calls[]) that each need their own
 * block/delta — richer than the base's default 1-block-1-delta orchestrator.
 *
 * Emitted wire format:
 *   message_start
 *   (content_block_start / content_block_delta* / content_block_stop)*
 *   message_delta  (stop_reason + usage)
 *   message_stop
 */
export class OpenAIToAnthropicSSEAssembler extends SseAssemblerBase<OpenAIStreamChunk> {
  /** Maps an OpenAI tool_call index → the Anthropic block index it opened. */
  private readonly toolBlocks = new Map<number, number>();
  private finishReason: string | null = null;
  private usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cache_read: number;
  } | null = null;

  /** Last captured usage (for request-log accounting). */
  getUsage(): {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cache_read: number;
  } | null {
    return this.usage;
  }

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

  protected createBlockEvent(chunk: OpenAIStreamChunk): BlockSpec | null {
    const delta = chunk.choices?.[0]?.delta ?? {};

    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
      if (this.current === 'thinking') return null;
      return { type: 'thinking', contentBlock: { type: 'thinking', thinking: '' } };
    }
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      if (this.current === 'text') return null;
      return { type: 'text', contentBlock: { type: 'text', text: '' } };
    }
    return null;
  }

  protected createDeltaEvent(chunk: OpenAIStreamChunk): AnthropicEvent | null {
    const delta = chunk.choices?.[0]?.delta ?? {};

    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
      return {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: this.blockIndex,
          delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
        },
      };
    }
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      return {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: this.blockIndex,
          delta: { type: 'text_delta', text: delta.content },
        },
      };
    }
    return null;
  }

  protected createFinishEvent(): AnthropicEvent[] {
    return [
      {
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: {
            stop_reason: this.finishReason
              ? (FINISH_TO_STOP[this.finishReason] ?? 'end_turn')
              : 'end_turn',
            stop_sequence: null,
          },
          usage: {
            input_tokens: this.usage?.prompt_tokens ?? 0,
            output_tokens: this.usage?.completion_tokens ?? 0,
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
  // Process — OpenAI chunk routing
  // -------------------------------------------------------------------------

  /**
   * Process one OpenAI chunk into zero or more Anthropic SSE events.
   *
   * Overrides the base template method because a single OpenAI chunk can carry
   * multiple content types (reasoning_content, content, tool_calls[]) that each
   * emit their own block-open + delta sequence. Tool-call arrays can open
   * multiple blocks from one chunk. Uses inherited ensureStart / openBlock /
   * push helpers — the state machine is NOT reimplemented.
   */
  process(chunk: OpenAIStreamChunk): AnthropicEvent[] {
    // Capture usage (side-effect, emits no events).
    if (chunk.usage) {
      this.usage = {
        prompt_tokens: chunk.usage.prompt_tokens ?? 0,
        completion_tokens: chunk.usage.completion_tokens ?? 0,
        total_tokens:
          chunk.usage.total_tokens ??
          (chunk.usage.prompt_tokens ?? 0) + (chunk.usage.completion_tokens ?? 0),
        cache_read: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
      };
    }

    const choice = chunk.choices?.[0];
    const delta = choice?.delta ?? {};

    // reasoning_content → thinking block + delta.
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
      this.ensureStart();
      if (this.current !== 'thinking') {
        this.openBlock('thinking', { type: 'thinking', thinking: '' });
      }
      this.push({
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: this.blockIndex,
          delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
        },
      });
    }

    // content → text block + delta.
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      this.ensureStart();
      if (this.current !== 'text') {
        this.openBlock('text', { type: 'text', text: '' });
      }
      this.push({
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: this.blockIndex,
          delta: { type: 'text_delta', text: delta.content },
        },
      });
    }

    // tool_calls → tool_use block(s) + input_json_delta(s).
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        this.ensureStart();
        let blockIdx = this.toolBlocks.get(tc.index);
        if (blockIdx === undefined) {
          this.openBlock('tool_use', {
            type: 'tool_use',
            id: tc.id ?? `call_${this.messageId}_${tc.index}`,
            name: tc.function?.name ?? '',
            input: {},
          });
          blockIdx = this.blockIndex;
          this.toolBlocks.set(tc.index, blockIdx);
        }
        const args = tc.function?.arguments;
        if (typeof args === 'string' && args.length > 0) {
          this.push({
            event: 'content_block_delta',
            data: {
              type: 'content_block_delta',
              index: blockIdx,
              delta: { type: 'input_json_delta', partial_json: args },
            },
          });
        }
      }
    }

    if (choice?.finish_reason) this.finishReason = choice.finish_reason;
    return this.drain();
  }

  /** Emit the closing message_delta + message_stop (idempotent). */
  finalize(): AnthropicEvent[] {
    this.flush();
    return this.drain();
  }
}

const encoder = new TextEncoder();

function serialize(ev: AnthropicEvent): Uint8Array {
  return encoder.encode(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`);
}

/** Iterate `data:` JSON payloads from an SSE stream, skipping `[DONE]` and blanks. */
async function* iterSSEChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<OpenAIStreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf('\n');
    while (nl !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (payload && payload !== '[DONE]') {
          try {
            yield JSON.parse(payload) as OpenAIStreamChunk;
          } catch {
            /* ignore malformed line */
          }
        }
      }
      nl = buf.indexOf('\n');
    }
  }
}

export type CodeBuddyUsageCallback = (usage: {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cache_read: number;
}) => void;

export type CodeBuddyStreamCallback = (
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cache_read: number;
  },
  capturedBody: string
) => void;

const CAPTURE_MAX_BYTES = 256 * 1024;

class CaptureBuffer {
  private chunks: string[] = [];
  private len = 0;
  constructor(private readonly maxBytes: number) {}
  push(chunk: string): void {
    this.chunks.push(chunk);
    this.len += chunk.length;
    while (this.len > this.maxBytes && this.chunks.length > 1) {
      const dropped = this.chunks.shift()!;
      this.len -= dropped.length;
    }
  }
  snapshot(): string {
    return this.chunks.join('');
  }
}

/** Wrap a CodeBuddy OpenAI-SSE response as an Anthropic Messages SSE response. */
export function openaiSSEToAnthropicSSE(
  upstream: Response,
  model: string,
  onUsage?: CodeBuddyUsageCallback | CodeBuddyStreamCallback
): Response {
  const assembler = new OpenAIToAnthropicSSEAssembler(model);
  const capture = new CaptureBuffer(CAPTURE_MAX_BYTES);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (upstream.body) {
          for await (const chunk of iterSSEChunks(upstream.body)) {
            for (const ev of assembler.process(chunk)) {
              const s = serialize(ev);
              capture.push(decoder.decode(s, { stream: true }));
              controller.enqueue(s);
            }
          }
        }
        for (const ev of assembler.finalize()) {
          const s = serialize(ev);
          capture.push(decoder.decode(s, { stream: true }));
          controller.enqueue(s);
        }
        controller.close();
        const u = assembler.getUsage();
        const usage = u ?? {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          cache_read: 0,
        };
        // Callback signature: (usage) for legacy callers, (usage, capturedBody) for new ones.
        // Use arity to choose — preserves backward compat without breaking the type union.
        if (onUsage && onUsage.length >= 2) {
          (onUsage as CodeBuddyStreamCallback)(usage, capture.snapshot());
        } else {
          (onUsage as CodeBuddyUsageCallback | undefined)?.(usage);
        }
      } catch (err) {
        controller.error(err);
      }
    },
  });
  return new Response(out, {
    status: upstream.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

/** Buffer a full CodeBuddy OpenAI-SSE stream into a single OpenAI chat.completion response. */
export async function aggregateOpenAISSE(upstream: Response): Promise<OpenAIResponse> {
  let id = `chatcmpl_${randomUUID().replace(/-/g, '')}`;
  let model = '';
  let content = '';
  let reasoning = '';
  let finish: string | null = null;
  let usage: OpenAIResponse['usage'] | undefined;
  const tools = new Map<number, { id: string; name: string; args: string }>();

  if (upstream.body) {
    for await (const chunk of iterSSEChunks(upstream.body)) {
      if (chunk.id) id = chunk.id;
      if (chunk.model) model = chunk.model;
      const choice = chunk.choices?.[0];
      const delta = choice?.delta ?? {};
      if (typeof delta.content === 'string') content += delta.content;
      if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content;
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const cur = tools.get(tc.index) ?? { id: '', name: '', args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          tools.set(tc.index, cur);
        }
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (chunk.usage) {
        usage = {
          prompt_tokens: chunk.usage.prompt_tokens ?? 0,
          completion_tokens: chunk.usage.completion_tokens ?? 0,
          total_tokens: chunk.usage.total_tokens ?? 0,
          cache_creation_tokens: 0,
          prompt_tokens_details: chunk.usage.prompt_tokens_details?.cached_tokens
            ? { cached_tokens: chunk.usage.prompt_tokens_details.cached_tokens }
            : undefined,
        };
      }
    }
  }

  const toolCalls = [...tools.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, t]) => ({
      id: t.id,
      type: 'function' as const,
      function: { name: t.name, arguments: t.args },
    }));

  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        finish_reason: finish ?? 'stop',
        message: {
          role: 'assistant',
          content: content.length > 0 ? content : null,
          ...(reasoning.length > 0 ? { reasoning_content: reasoning } : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    usage,
  } as OpenAIResponse;
}
