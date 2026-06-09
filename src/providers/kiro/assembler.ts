/**
 * Kiro event-stream -> OpenAI assembler.
 *
 * Turns decoded Kiro events into OpenAI `chat.completion.chunk` objects (for
 * SSE streaming) and can aggregate them into a single `chat.completion` object
 * (for non-streaming responses). Adapted from the 9router reference (MIT).
 */

import { ChunkAccumulator } from './chunkAccumulator.js';
import { decodeFrames, type KiroEvent } from './eventstream.js';

export interface OpenAIToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}
export interface OpenAIDelta {
  role?: string;
  content?: string;
  reasoning_content?: string;
  tool_calls?: OpenAIToolCallDelta[];
}
export interface OpenAIChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{ index: number; delta: OpenAIDelta; finish_reason: string | null }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}
export interface KiroUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface AssemblerState {
  chunkIndex: number;
  hasToolCalls: boolean;
  reasoningChunkCount: number;
  toolCallIndex: number;
  seenToolIds: Map<string, number>;
  finishEmitted: boolean;
  hasMetering: boolean;
  hasContextUsage: boolean;
  totalContentLength: number;
  contextUsagePercentage: number;
  usage: KiroUsage | null;
}

export class KiroAssembler {
  readonly responseId = `chatcmpl-${Date.now()}`;
  readonly created = Math.floor(Date.now() / 1000);
  private readonly model: string;
  private readonly state: AssemblerState = {
    chunkIndex: 0,
    hasToolCalls: false,
    reasoningChunkCount: 0,
    toolCallIndex: 0,
    seenToolIds: new Map(),
    finishEmitted: false,
    hasMetering: false,
    hasContextUsage: false,
    totalContentLength: 0,
    contextUsagePercentage: 0,
    usage: null,
  };

  constructor(model: string) {
    this.model = model;
  }

  get usage(): KiroUsage | null {
    return this.state.usage;
  }
  get finishReason(): string {
    return this.state.hasToolCalls ? 'tool_calls' : 'stop';
  }

  private chunk(delta: OpenAIDelta, finish: string | null = null): OpenAIChunk {
    return {
      id: this.responseId,
      object: 'chat.completion.chunk',
      created: this.created,
      model: this.model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    };
  }

  /** Process one decoded Kiro event into zero or more OpenAI chunks. */
  process(event: KiroEvent): OpenAIChunk[] {
    const s = this.state;
    const out: OpenAIChunk[] = [];
    const payload = event.payload || {};

    if (event.eventType === 'assistantResponseEvent' && typeof payload.content === 'string') {
      const content = payload.content;
      s.totalContentLength += content.length;
      out.push(this.chunk(s.chunkIndex === 0 ? { role: 'assistant', content } : { content }));
      s.chunkIndex++;
    }

    if (event.eventType === 'reasoningContentEvent') {
      const r = (payload.reasoningContentEvent ?? payload) as
        | string
        | { text?: string; content?: string };
      const text = typeof r === 'string' ? r : r.text || r.content || '';
      if (text) {
        s.totalContentLength += text.length;
        const delta: OpenAIDelta =
          s.reasoningChunkCount === 0 && s.chunkIndex === 0
            ? { role: 'assistant', reasoning_content: text }
            : { reasoning_content: text };
        out.push(this.chunk(delta));
        s.chunkIndex++;
        s.reasoningChunkCount++;
      }
    }

    if (event.eventType === 'codeEvent' && typeof payload.content === 'string') {
      out.push(this.chunk({ content: payload.content }));
      s.chunkIndex++;
    }

    if (event.eventType === 'toolUseEvent' && payload) {
      s.hasToolCalls = true;
      const list = Array.isArray(payload) ? payload : [payload];
      for (const tu of list as Array<{ toolUseId?: string; name?: string; input?: unknown }>) {
        const toolCallId = tu.toolUseId || `call_${Date.now()}`;
        const isNew = !s.seenToolIds.has(toolCallId);
        let toolIndex: number;
        if (isNew) {
          toolIndex = s.toolCallIndex++;
          s.seenToolIds.set(toolCallId, toolIndex);
          out.push(
            this.chunk({
              ...(s.chunkIndex === 0 ? { role: 'assistant' } : {}),
              tool_calls: [
                {
                  index: toolIndex,
                  id: toolCallId,
                  type: 'function',
                  function: { name: tu.name || '', arguments: '' },
                },
              ],
            })
          );
          s.chunkIndex++;
        } else {
          toolIndex = s.seenToolIds.get(toolCallId)!;
        }
        if (tu.input !== undefined) {
          const args = typeof tu.input === 'string' ? tu.input : JSON.stringify(tu.input);
          out.push(
            this.chunk({ tool_calls: [{ index: toolIndex, function: { arguments: args } }] })
          );
          s.chunkIndex++;
        }
      }
    }

    if (event.eventType === 'messageStopEvent') {
      s.finishEmitted = true;
      out.push(this.chunk({}, this.finishReason));
    }

    if (event.eventType === 'contextUsageEvent') {
      const pct = (payload as { contextUsagePercentage?: number }).contextUsagePercentage;
      if (pct) {
        s.contextUsagePercentage = pct;
        s.hasContextUsage = true;
      }
    }

    if (event.eventType === 'meteringEvent') s.hasMetering = true;

    if (event.eventType === 'metricsEvent') {
      const metrics = ((payload as { metricsEvent?: unknown }).metricsEvent ?? payload) as {
        inputTokens?: number;
        outputTokens?: number;
      };
      const inputTokens = metrics.inputTokens || 0;
      const outputTokens = metrics.outputTokens || 0;
      if (inputTokens > 0 || outputTokens > 0) {
        s.usage = {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
        };
      }
    }

    // Emit final chunk after both metering + context-usage events seen.
    if (s.hasMetering && s.hasContextUsage && !s.finishEmitted) {
      s.finishEmitted = true;
      this.estimateUsageIfMissing();
      const finishChunk = this.chunk({}, this.finishReason);
      if (s.usage) finishChunk.usage = s.usage;
      out.push(finishChunk);
    }

    return out;
  }

  /** Flush a finish chunk if upstream never emitted one. */
  flush(): OpenAIChunk[] {
    if (this.state.finishEmitted) return [];
    this.state.finishEmitted = true;
    this.estimateUsageIfMissing();
    const finishChunk = this.chunk({}, this.finishReason);
    if (this.state.usage) finishChunk.usage = this.state.usage;
    return [finishChunk];
  }

  private estimateUsageIfMissing(): void {
    const s = this.state;
    if (s.usage) return;
    const out = s.totalContentLength > 0 ? Math.max(1, Math.floor(s.totalContentLength / 4)) : 0;
    const inp =
      s.contextUsagePercentage > 0 ? Math.floor((s.contextUsagePercentage * 200000) / 100) : 0;
    s.usage = { prompt_tokens: inp, completion_tokens: out, total_tokens: inp + out };
  }
}

const encoder = new TextEncoder();

/** Wrap a Kiro binary response body as an OpenAI SSE Response. */
export function kiroResponseToOpenAISSE(response: Response, model: string): Response {
  const assembler = new KiroAssembler(model);
  const acc = new ChunkAccumulator();

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      acc.push(chunk);
      const merged = acc.view();
      const { events, rest: leftover } = decodeFrames(merged);
      acc.consume(merged.length - leftover.length);
      for (const event of events) {
        for (const c of assembler.process(event)) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
        }
      }
    },
    flush(controller) {
      for (const c of assembler.flush()) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    },
  });

  if (!response.body) {
    return new Response('data: [DONE]\n\n', {
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

export interface OpenAICompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      reasoning_content?: string;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage: KiroUsage;
}

/** Consume a Kiro binary response fully and aggregate into a chat.completion. */
export async function kiroResponseToOpenAIJson(
  response: Response,
  model: string
): Promise<OpenAICompletion> {
  const assembler = new KiroAssembler(model);
  const chunks: OpenAIChunk[] = [];
  if (response.body) {
    const reader = response.body.getReader();
    const acc = new ChunkAccumulator();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      acc.push(value);
      const merged = acc.view();
      const { events, rest: leftover } = decodeFrames(merged);
      acc.consume(merged.length - leftover.length);
      for (const event of events) chunks.push(...assembler.process(event));
    }
  }
  chunks.push(...assembler.flush());

  let content = '';
  let reasoning = '';
  const toolMap = new Map<number, { id: string; name: string; arguments: string }>();
  let finishReason = assembler.finishReason;

  for (const chunk of chunks) {
    const choice = chunk.choices[0];
    if (!choice) continue;
    const d = choice.delta;
    if (typeof d.content === 'string') content += d.content;
    if (typeof d.reasoning_content === 'string') reasoning += d.reasoning_content;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    for (const tc of d.tool_calls || []) {
      const existing = toolMap.get(tc.index) || { id: '', name: '', arguments: '' };
      if (tc.id) existing.id = tc.id;
      if (tc.function?.name) existing.name = tc.function.name;
      if (tc.function?.arguments) existing.arguments += tc.function.arguments;
      toolMap.set(tc.index, existing);
    }
  }

  const toolCalls = [...toolMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, t]) => ({
      id: t.id || `call_${Date.now()}`,
      type: 'function' as const,
      function: { name: t.name, arguments: t.arguments },
    }));

  return {
    id: assembler.responseId,
    object: 'chat.completion',
    created: assembler.created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: content || (toolCalls.length ? null : ''),
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
    usage: assembler.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
