// src/providers/codebuddy/streamConvert.ts
import { randomUUID } from 'node:crypto';

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
