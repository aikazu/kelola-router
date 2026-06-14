// src/providers/codebuddy/streamConvert.ts
import { randomUUID } from 'node:crypto';
import type { OpenAIResponse } from '../format/messageTypes.js';

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

export interface AnthropicEvent {
  event: string;
  data: Record<string, unknown>;
}

const FINISH_TO_STOP: Record<string, string> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  content_filter: 'refusal',
};

type BlockType = 'thinking' | 'text' | 'tool_use';

export class OpenAIToAnthropicSSEAssembler {
  private readonly messageId = `msg_${randomUUID().replace(/-/g, '')}`;
  private readonly model: string;
  private started = false;
  private stopped = false;
  private blockIndex = -1;
  private current: BlockType | null = null;
  /** Maps an OpenAI tool_call index → the Anthropic block index it opened. */
  private readonly toolBlocks = new Map<number, number>();
  private finishReason: string | null = null;
  private usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cache_read: number } | null = null;

  constructor(model: string) {
    this.model = model;
  }

  /** Last captured usage (for request-log accounting). */
  getUsage(): { prompt_tokens: number; completion_tokens: number; total_tokens: number; cache_read: number } | null {
    return this.usage;
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
    out.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index: this.blockIndex } });
    this.current = null;
  }

  private openBlock(out: AnthropicEvent[], type: BlockType, contentBlock: Record<string, unknown>): number {
    this.closeBlock(out);
    this.blockIndex++;
    this.current = type;
    out.push({
      event: 'content_block_start',
      data: { type: 'content_block_start', index: this.blockIndex, content_block: contentBlock },
    });
    return this.blockIndex;
  }

  process(chunk: OpenAIStreamChunk): AnthropicEvent[] {
    const out: AnthropicEvent[] = [];
    const choice = chunk.choices?.[0];
    const delta = choice?.delta ?? {};

    if (chunk.usage) {
      this.usage = {
        prompt_tokens: chunk.usage.prompt_tokens ?? 0,
        completion_tokens: chunk.usage.completion_tokens ?? 0,
        total_tokens: chunk.usage.total_tokens ?? (chunk.usage.prompt_tokens ?? 0) + (chunk.usage.completion_tokens ?? 0),
        cache_read: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
      };
    }

    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
      this.ensureStart(out);
      if (this.current !== 'thinking') this.openBlock(out, 'thinking', { type: 'thinking', thinking: '' });
      out.push({
        event: 'content_block_delta',
        data: { type: 'content_block_delta', index: this.blockIndex, delta: { type: 'thinking_delta', thinking: delta.reasoning_content } },
      });
    }

    if (typeof delta.content === 'string' && delta.content.length > 0) {
      this.ensureStart(out);
      if (this.current !== 'text') this.openBlock(out, 'text', { type: 'text', text: '' });
      out.push({
        event: 'content_block_delta',
        data: { type: 'content_block_delta', index: this.blockIndex, delta: { type: 'text_delta', text: delta.content } },
      });
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        this.ensureStart(out);
        let blockIdx = this.toolBlocks.get(tc.index);
        if (blockIdx === undefined) {
          blockIdx = this.openBlock(out, 'tool_use', {
            type: 'tool_use',
            id: tc.id ?? `call_${this.messageId}_${tc.index}`,
            name: tc.function?.name ?? '',
            input: {},
          });
          this.toolBlocks.set(tc.index, blockIdx);
        }
        const args = tc.function?.arguments;
        if (typeof args === 'string' && args.length > 0) {
          out.push({
            event: 'content_block_delta',
            data: { type: 'content_block_delta', index: blockIdx, delta: { type: 'input_json_delta', partial_json: args } },
          });
        }
      }
    }

    if (choice?.finish_reason) this.finishReason = choice.finish_reason;
    return out;
  }

  finalize(): AnthropicEvent[] {
    if (this.stopped) return [];
    this.stopped = true;
    const out: AnthropicEvent[] = [];
    this.ensureStart(out);
    this.closeBlock(out);
    out.push({
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: { stop_reason: this.finishReason ? (FINISH_TO_STOP[this.finishReason] ?? 'end_turn') : 'end_turn', stop_sequence: null },
        usage: { input_tokens: this.usage?.prompt_tokens ?? 0, output_tokens: this.usage?.completion_tokens ?? 0 },
      },
    });
    out.push({ event: 'message_stop', data: { type: 'message_stop' } });
    return out;
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

/** Wrap a CodeBuddy OpenAI-SSE response as an Anthropic Messages SSE response. */
export function openaiSSEToAnthropicSSE(
  upstream: Response,
  model: string,
  onUsage?: CodeBuddyUsageCallback,
): Response {
  const assembler = new OpenAIToAnthropicSSEAssembler(model);
  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (upstream.body) {
        for await (const chunk of iterSSEChunks(upstream.body)) {
          for (const ev of assembler.process(chunk)) controller.enqueue(serialize(ev));
        }
      }
      for (const ev of assembler.finalize()) controller.enqueue(serialize(ev));
      controller.close();
      const u = assembler.getUsage();
      onUsage?.(u ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cache_read: 0 });
    },
  });
  return new Response(out, {
    status: upstream.status,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
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
    .map(([, t]) => ({ id: t.id, type: 'function' as const, function: { name: t.name, arguments: t.args } }));

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
