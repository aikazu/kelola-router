# CodeBuddy OpenAI Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CodeBuddy provider actually work with Anthropic agents (Claude Code / hermes) by speaking CodeBuddy's real wire protocol — OpenAI Chat Completions, stream-only, system-message-required — instead of the broken Anthropic passthrough currently shipped.

**Architecture:** CodeBuddy's upstream (`https://www.codebuddy.ai/v2/chat/completions`) is an OpenAI-compatible, **stream-only** endpoint that **requires a `system` role message** and a Bearer `ck_…` API key. The router currently forwards Anthropic-format bodies → upstream returns `11101 invalid request`. Fix: convert the client's Anthropic body → OpenAI on the way in (reuse existing `bodyAnthropicToOpenAI`), force `stream:true`, guarantee a system message; on the way out convert CodeBuddy's OpenAI SSE → Anthropic Messages SSE (new assembler, mirrors the existing Kiro `KiroAnthropicAssembler`). For non-stream clients, aggregate the upstream SSE into one response and convert.

**Tech Stack:** TypeScript (strict, no `any`), Hono, Vitest, Web Streams API (`ReadableStream`/`TransformStream`), better-sqlite3.

---

## Background — verified facts (reverse-engineered from CLI `@tencent-ai/codebuddy-code@2.106.3` + live API tests with a real `ck_…` key)

- **Endpoint:** `POST https://www.codebuddy.ai/v2/chat/completions` (base `https://www.codebuddy.ai` + `/v2` + `/chat/completions`). The router account stores `base_url=https://www.codebuddy.ai`; the provider appends `/v2/chat/completions`.
- **Auth:** `Authorization: Bearer ck_…`. Returns `401` on bad key, `400` on bad body. (CLI also sends `x-api-key` + many `x-*` trace headers, but a bare `Authorization` Bearer works — verified.)
- **Format:** OpenAI Chat Completions. `messages[]` with `role`/`content` strings. NOT Anthropic. No `anthropic-version` header.
- **Stream mandatory:** `stream:false` → `{"code":11101,"msg":"Non-stream chat request is currently not supported"}`. Must send `stream:true`.
- **System message mandatory:** omitting a `role:"system"` message → `{"code":11101,"msg":"Parse message failed: 11101:invalid request"}`. Adding one fixes it. (This was the single most common cause of the 11101 error.)
- **Response:** `text/event-stream`, OpenAI chunk shape: `data: {"choices":[{"delta":{"content":"…","reasoning_content":"…","tool_calls":[…]},"finish_reason":""}],"usage":{…}}` … terminated by `data: [DONE]`.
- **Error body shape:** `{"code":NNNNN,"msg":"…","requestId":"…"}`.
- **Valid models (live-tested ✅ with this key):** `claude-opus-4.6`, `gemini-3.5-flash`, `gemini-3.1-pro`, `gpt-5.5`, `glm-5.0`, `kimi-k2.5`.
- **Invalid (❌ `service info not found`):** `claude-opus-4.7`, `claude-sonnet-4.5`, `deepseek-v3-2-volc`. **Opus 4.7 does NOT exist on CodeBuddy** — only 4.6.

## Existing infrastructure to REUSE (do not rebuild)

- `src/providers/format/transform.ts`
  - `bodyAnthropicToOpenAI(body)` — moves top-level `system` → `messages[0]`, converts `tools` to OpenAI function shape, drops Anthropic-only params. (Only injects a system message **if `body.system` was present**.)
  - `responseOpenAIToAnthropic(resp)` — non-stream OpenAI response → Anthropic response (handles `reasoning_content`→thinking, `tool_calls`→tool_use, usage).
- `src/providers/format/messageTypes.ts` — `AnthropicBody`, `OpenAIBody`, `OpenAIResponse`, `AnthropicResponse`, `ContentBlock`.
- `src/streaming/pipeWithUsage.ts` — `pipeWithUsage(resp, 'openai'|'anthropic', onUsage, signal?)` tees an SSE stream + extracts usage. Used for the **openai-client passthrough** case.
- `src/providers/kiro/anthropicSse.ts` — `KiroAnthropicAssembler` + `serialize()` pattern + `kiroResponseToAnthropicSSE()` ReadableStream wrapper. **Copy this structure** for the new OpenAI→Anthropic SSE assembler (event shapes are identical; only the *input* differs — OpenAI chunks instead of Kiro binary frames).

## Files to create / modify

- **Create** `src/providers/codebuddy/streamConvert.ts` — OpenAI SSE → Anthropic SSE assembler + wrapper, and OpenAI SSE → aggregated `OpenAIResponse` (for non-stream clients).
- **Create** `src/providers/codebuddy/streamConvert.test.ts`
- **Modify** `src/providers/codebuddy/transform.ts` — replace `ensureCodeBuddyDefaults` with `prepareCodeBuddyBody(body, clientFormat)` (convert + force stream + guarantee system message + strip prefix).
- **Modify** `src/providers/codebuddy/transform.test.ts`
- **Modify** `src/providers/codebuddy/index.ts` — `executeCodeBuddy` uses `prepareCodeBuddyBody`, OpenAI headers (no `anthropic-version`, add `Accept: text/event-stream`), always streams upstream.
- **Modify** `src/proxy/codebuddy.ts` — branch on client `format` + client `stream`: anthropic-stream → SSE convert; openai-stream → passthrough; non-stream → aggregate + convert.
- **Modify** `scripts/seed-codebuddy-models.ts` — corrected, live-verified model list.
- **Reference only:** `src/providers/format/transform.ts`, `src/providers/kiro/anthropicSse.ts`, `src/streaming/pipeWithUsage.ts`.

## Out of scope (note, don't build)

- Combos containing CodeBuddy members (`src/proxy/combo.ts`) — separate follow-up.
- OAuth device-login import for CodeBuddy — the user already has a long-lived `ck_…` API key; static Bearer is sufficient.
- Residential-proxy enforcement — `add-codebuddy-account.ts` already warns; sandbox tests hit the API directly without a proxy successfully, so it is not blocking for this plan.

---

### Task 1: OpenAI SSE → Anthropic SSE assembler (core converter)

**Files:**
- Create: `src/providers/codebuddy/streamConvert.ts`
- Test: `src/providers/codebuddy/streamConvert.test.ts`

This is the crux. It consumes parsed OpenAI streaming chunks and emits Anthropic Messages SSE events, mirroring `KiroAnthropicAssembler` (`src/providers/kiro/anthropicSse.ts`). One content block open at a time; blocks ordered thinking → text → tool_use(s), each with an incrementing index.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/providers/codebuddy/streamConvert.test.ts`
Expected: FAIL — `OpenAIToAnthropicSSEAssembler is not exported` / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/providers/codebuddy/streamConvert.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/codebuddy/streamConvert.ts src/providers/codebuddy/streamConvert.test.ts
git commit -m "feat(codebuddy): add OpenAI SSE to Anthropic SSE assembler"
```

---

### Task 2: SSE line parser + ReadableStream wrapper + non-stream aggregator

**Files:**
- Modify: `src/providers/codebuddy/streamConvert.ts`
- Test: `src/providers/codebuddy/streamConvert.test.ts`

Adds: (a) `openaiSSEToAnthropicSSE(resp, model, onUsage?)` — wraps a CodeBuddy OpenAI-SSE `Response` into an Anthropic-SSE `Response`; (b) `aggregateOpenAISSE(resp)` — buffers a full OpenAI-SSE stream into one `OpenAIResponse` (for non-stream clients).

- [ ] **Step 1: Write the failing test (append to existing test file)**

```ts
// append to src/providers/codebuddy/streamConvert.test.ts
import { aggregateOpenAISSE, openaiSSEToAnthropicSSE } from './streamConvert.js';

function sseResponse(lines: string[]): Response {
  const body = lines.map((l) => `data: ${l}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('openaiSSEToAnthropicSSE', () => {
  it('converts an upstream OpenAI SSE response into Anthropic SSE bytes', async () => {
    const upstream = sseResponse([
      JSON.stringify({ choices: [{ delta: { content: 'PING' } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
    ]);
    let captured: { prompt_tokens: number; completion_tokens: number } | null = null;
    const out = openaiSSEToAnthropicSSE(upstream, 'claude-opus-4.6', (u) => {
      captured = u;
    });
    const text = await out.text();
    expect(text).toContain('event: message_start');
    expect(text).toContain('"type":"text_delta","text":"PING"');
    expect(text).toContain('event: message_stop');
    expect(captured).toEqual({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cache_read: 0 });
    expect(out.headers.get('content-type')).toBe('text/event-stream');
  });
});

describe('aggregateOpenAISSE', () => {
  it('buffers streamed deltas into one OpenAI response', async () => {
    const upstream = sseResponse([
      JSON.stringify({ id: 'x', model: 'gemini-3.5-flash', choices: [{ delta: { role: 'assistant', content: 'he' } }] }),
      JSON.stringify({ choices: [{ delta: { content: 'llo' } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }),
    ]);
    const resp = await aggregateOpenAISSE(upstream);
    expect(resp.choices[0].message.content).toBe('hello');
    expect(resp.choices[0].finish_reason).toBe('stop');
    expect(resp.usage?.completion_tokens).toBe(2);
    expect(resp.object).toBe('chat.completion');
  });

  it('aggregates tool_calls fragments', async () => {
    const upstream = sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'f', arguments: '{"a"' } }] } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
    ]);
    const resp = await aggregateOpenAISSE(upstream);
    const tc = resp.choices[0].message.tool_calls?.[0];
    expect(tc?.id).toBe('c1');
    expect(tc?.function.name).toBe('f');
    expect(tc?.function.arguments).toBe('{"a":1}');
    expect(resp.choices[0].finish_reason).toBe('tool_calls');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/providers/codebuddy/streamConvert.test.ts`
Expected: FAIL — `openaiSSEToAnthropicSSE`/`aggregateOpenAISSE` not exported.

- [ ] **Step 3: Write the implementation (append to `streamConvert.ts`)**

```ts
// append to src/providers/codebuddy/streamConvert.ts
import type { OpenAIResponse } from '../format/messageTypes.js';

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
  onUsage?: CodeBuddyUsageCallback
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
```

> **Note:** If `tsc` reports that the `OpenAIResponse` literal is missing required fields or that `tool_calls`/`reasoning_content` aren't assignable, check the exact shape in `src/providers/format/messageTypes.ts` (lines 35-83) and adjust the returned object to match — keep the `as OpenAIResponse` cast only as a last resort and prefer matching the real interface. Do not introduce `any`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/providers/codebuddy/streamConvert.test.ts`
Expected: PASS (all tests, 5+).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/providers/codebuddy/streamConvert.ts src/providers/codebuddy/streamConvert.test.ts
git commit -m "feat(codebuddy): add SSE wrapper and non-stream aggregator"
```

---

### Task 3: Body preparation — convert, force stream, guarantee system message

**Files:**
- Modify: `src/providers/codebuddy/transform.ts`
- Test: `src/providers/codebuddy/transform.test.ts`

Replace `ensureCodeBuddyDefaults` (which wrongly injected a top-level Anthropic `system` field) with `prepareCodeBuddyBody(body, clientFormat)`.

- [ ] **Step 1: Write the failing test (replace the file contents)**

```ts
// src/providers/codebuddy/transform.test.ts
import { describe, expect, it } from 'vitest';
import { prepareCodeBuddyBody } from './transform.js';

describe('prepareCodeBuddyBody', () => {
  it('converts an Anthropic body to OpenAI, forces stream, and guarantees a system message', () => {
    const out = prepareCodeBuddyBody(
      { model: 'codebuddy/claude-opus-4.6', system: 'be terse', max_tokens: 50, messages: [{ role: 'user', content: 'hi' }] },
      'anthropic'
    );
    expect(out.model).toBe('claude-opus-4.6'); // prefix stripped
    expect(out.stream).toBe(true);
    expect((out.stream_options as { include_usage?: boolean }).include_usage).toBe(true);
    const msgs = out.messages as Array<{ role: string; content: unknown }>;
    expect(msgs[0].role).toBe('system'); // moved from top-level by bodyAnthropicToOpenAI
    expect(out.system).toBeUndefined();
  });

  it('injects a default system message when the client sent none', () => {
    const out = prepareCodeBuddyBody(
      { model: 'codebuddy/gemini-3.5-flash', max_tokens: 50, messages: [{ role: 'user', content: 'hi' }] },
      'anthropic'
    );
    const msgs = out.messages as Array<{ role: string }>;
    expect(msgs[0].role).toBe('system');
    expect(msgs.filter((m) => m.role === 'system')).toHaveLength(1);
  });

  it('passes an OpenAI client body through, still forcing stream + system', () => {
    const out = prepareCodeBuddyBody(
      { model: 'codebuddy/gpt-5.5', messages: [{ role: 'user', content: 'hi' }] },
      'openai'
    );
    expect(out.stream).toBe(true);
    const msgs = out.messages as Array<{ role: string }>;
    expect(msgs[0].role).toBe('system');
  });

  it('does not duplicate an existing OpenAI system message', () => {
    const out = prepareCodeBuddyBody(
      { model: 'glm-5.0', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }] },
      'openai'
    );
    const msgs = out.messages as Array<{ role: string }>;
    expect(msgs.filter((m) => m.role === 'system')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/providers/codebuddy/transform.test.ts`
Expected: FAIL — `prepareCodeBuddyBody` not exported.

- [ ] **Step 3: Write the implementation (replace `transform.ts` contents)**

```ts
// src/providers/codebuddy/transform.ts
import type { AnthropicBody } from '../format/messageTypes.js';
import { bodyAnthropicToOpenAI } from '../format/transform.js';
import { CODEBUDDY_DEFAULT_SYSTEM } from './index.js';

/**
 * Prepare a client request body for the CodeBuddy upstream.
 *
 * CodeBuddy speaks OpenAI Chat Completions and is **stream-only** and
 * **requires a `system` role message**. This:
 *   1. converts an Anthropic body → OpenAI (reusing the shared converter),
 *   2. strips the `codebuddy/` model prefix,
 *   3. guarantees a system message exists (injects a default if absent),
 *   4. forces `stream:true` + `stream_options.include_usage`.
 */
export function prepareCodeBuddyBody(
  body: Record<string, unknown>,
  clientFormat: 'openai' | 'anthropic'
): Record<string, unknown> {
  const out: Record<string, unknown> =
    clientFormat === 'anthropic'
      ? (bodyAnthropicToOpenAI(body as AnthropicBody) as unknown as Record<string, unknown>)
      : { ...body };

  if (typeof out.model === 'string' && out.model.startsWith('codebuddy/')) {
    out.model = out.model.slice('codebuddy/'.length);
  }

  const messages = Array.isArray(out.messages) ? [...(out.messages as unknown[])] : [];
  const hasSystem = messages.some(
    (m) => !!m && typeof m === 'object' && (m as { role?: string }).role === 'system'
  );
  if (!hasSystem) {
    messages.unshift({ role: 'system', content: CODEBUDDY_DEFAULT_SYSTEM });
  }
  out.messages = messages;

  out.stream = true;
  const so = out.stream_options as { include_usage?: boolean } | undefined;
  if (!so || !('include_usage' in so)) {
    out.stream_options = { ...(so ?? {}), include_usage: true };
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/providers/codebuddy/transform.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/codebuddy/transform.ts src/providers/codebuddy/transform.test.ts
git commit -m "feat(codebuddy): prepare body as OpenAI stream with guaranteed system message"
```

---

### Task 4: executeCodeBuddy — OpenAI headers, always-stream upstream

**Files:**
- Modify: `src/providers/codebuddy/index.ts`
- Test: `src/providers/codebuddy/index.test.ts` (create)

`executeCodeBuddy` must accept `clientFormat`, call `prepareCodeBuddyBody`, drop the bogus `anthropic-version` header, add `Accept: text/event-stream`, and keep the Bearer auth.

- [ ] **Step 1: Write the failing test**

```ts
// src/providers/codebuddy/index.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeCodeBuddy } from './index.js';

afterEach(() => vi.restoreAllMocks());

describe('executeCodeBuddy', () => {
  it('posts an OpenAI streaming body with Bearer auth to /v2/chat/completions', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
    );
    await executeCodeBuddy({
      body: { model: 'codebuddy/claude-opus-4.6', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] },
      account: { api_key: 'ck_test', base_url: 'https://www.codebuddy.ai', chat_endpoint: null },
      transport: null,
      clientFormat: 'anthropic',
    });
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe('https://www.codebuddy.ai/v2/chat/completions');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ck_test');
    expect(headers['anthropic-version']).toBeUndefined();
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.stream).toBe(true);
    expect(sent.model).toBe('claude-opus-4.6');
    expect(sent.messages[0].role).toBe('system');
  });
});
```

> **Note:** `upstreamFetch(url, body, headers, transport, proxyOpts)` calls `globalThis.fetch` internally; verify its argument order in `src/providers/upstreamFetch.ts` before finalizing the assertion. If it serializes the body itself, the `init.body` assertion above holds; if it accepts an already-stringified body, adjust accordingly.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/providers/codebuddy/index.test.ts`
Expected: FAIL — `executeCodeBuddy` does not accept `clientFormat` / still sends `anthropic-version`.

- [ ] **Step 3: Write the implementation (replace `executeCodeBuddy` in `index.ts`)**

Keep the existing constants block (`CODEBUDDY_BASE_URL`, `CODEBUDDY_CHAT_ENDPOINT`, `CODEBUDDY_DEFAULT_SYSTEM`, `CODEBUDDY_DEFAULT_TEMPERATURE`, `CODEBUDDY_MODELS`). Replace the import and the function:

```ts
// src/providers/codebuddy/index.ts — replace the transform import line:
import { prepareCodeBuddyBody } from './transform.js';

// ...keep the constants block unchanged...

export async function executeCodeBuddy(opts: {
  body: Record<string, unknown>;
  account: { api_key: string; base_url?: string | null; chat_endpoint?: string | null };
  transport: TransportConfig | null;
  proxyOpts?: ProxyFetchOpts;
  clientFormat: 'openai' | 'anthropic';
}): Promise<Response> {
  const { body, account, transport, proxyOpts, clientFormat } = opts;

  const prepared = prepareCodeBuddyBody(body, clientFormat);

  const baseUrl = account.base_url || CODEBUDDY_BASE_URL;
  const endpoint = account.chat_endpoint || CODEBUDDY_CHAT_ENDPOINT;
  const url = `${baseUrl}${endpoint}`;

  const extraHeaders: Record<string, string> = {
    Authorization: `Bearer ${account.api_key}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };

  return upstreamFetch(url, prepared, extraHeaders, transport, proxyOpts);
}
```

Also update the `CODEBUDDY_DEFAULT_SYSTEM` const value if needed (keep `'You are a helpful assistant.'`). Remove the now-unused `skipModelStrip` / `ensureCodeBuddyDefaults` references.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/providers/codebuddy/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors. (Will surface the `skipModelStrip`/`providerData.skip_model_strip` usage in `proxy/codebuddy.ts` — that is fixed in Task 5.)

- [ ] **Step 6: Commit**

```bash
git add src/providers/codebuddy/index.ts src/providers/codebuddy/index.test.ts
git commit -m "feat(codebuddy): execute as OpenAI stream, drop anthropic-version header"
```

---

### Task 5: Proxy handler — branch on client format + stream

**Files:**
- Modify: `src/proxy/codebuddy.ts`
- Test: `src/proxy/codebuddy.test.ts` (create)

Rewire `handleCodeBuddyProxy` so the upstream is always an OpenAI SSE response and the client gets the format it asked for:
- **anthropic client + stream** → `openaiSSEToAnthropicSSE`
- **openai client + stream** → `pipeWithUsage(resp, 'openai', …)` passthrough
- **non-stream (either)** → `aggregateOpenAISSE` → `responseOpenAIToAnthropic` (anthropic) or raw OpenAI JSON (openai)

Use the `format` parameter (currently `_format`). Keep account selection, the error-body parse, console events, and `insertRequestLogDeferred` accounting.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/proxy/codebuddy.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('handleCodeBuddyProxy', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'cb-')), 't.db');
  });
  afterEach(() => vi.restoreAllMocks());

  it('converts an upstream OpenAI SSE stream to Anthropic SSE for an anthropic client', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { handleCodeBuddyProxy } = await import('./codebuddy.js');
    const db = openDb();
    createAccount(db, {
      id: 'acc_cb1',
      label: 'cb',
      credit_type: 'token-plan',
      api_key: 'ck_test',
      base_url: 'https://www.codebuddy.ai',
      provider: 'codebuddy',
      enabled: true,
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'PONG' } }] }) + '\n\n' +
          'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) + '\n\n' +
          'data: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    );

    // Minimal Hono-like context stub.
    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) => (k === 'clientKey' ? { id: 'ck_row_1' } : k === 'startTime' ? Date.now() : undefined),
      set: () => {},
      json: (obj: unknown, status?: number) => new Response(JSON.stringify(obj), { status: status ?? 200 }),
      body: (b: BodyInit, status?: number, headers?: Record<string, string>) => new Response(b, { status, headers }),
    } as unknown as Parameters<typeof handleCodeBuddyProxy>[0];

    const resp = await handleCodeBuddyProxy(
      c,
      'anthropic',
      '/v1/messages',
      { model: 'codebuddy/claude-opus-4.6', max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'hi' }] },
      db,
      { value: null },
      new Map()
    );
    const text = await resp.text();
    expect(text).toContain('event: message_start');
    expect(text).toContain('"text":"PONG"');
    expect(text).toContain('event: message_stop');
  });
});
```

> **Note:** Match the real `handleCodeBuddyProxy` signature `(c, format, upstreamPath, body, db, cursorRef, stickyMap)` and the `CursorRef` type from `src/proxy/kiro.ts` (`{ value: string | null }`). If the context stub is missing a method the handler calls (e.g. `c.set('reqId', …)`), add a no-op for it. Inspect the current handler before writing the stub so every accessed field exists.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/proxy/codebuddy.test.ts`
Expected: FAIL — handler still does Anthropic passthrough; output has no `event: message_start` text-delta for `PONG`, or it throws on the removed `skipModelStrip` path.

- [ ] **Step 3: Rewrite the handler**

Edit `src/proxy/codebuddy.ts`:

1. Update imports — add the converters, drop nothing still used:

```ts
import { responseOpenAIToAnthropic } from '../providers/format/transform.js';
import { aggregateOpenAISSE, openaiSSEToAnthropicSSE } from '../providers/codebuddy/streamConvert.js';
```

2. Rename the `_format` param to `format` in the signature.

3. After account selection succeeds, replace the `executeCodeBuddy(...)` call so it passes `clientFormat: format` and drops `skipModelStrip`/`providerData.chat_endpoint` is still read for the bridge override:

```ts
const clientWantsStream = body.stream === true;
const resp = await executeCodeBuddy({
  body,
  account: {
    api_key: acc.api_key,
    base_url: acc.base_url,
    chat_endpoint: (providerData.chat_endpoint as string) || null,
  },
  transport,
  proxyOpts,
  clientFormat: format,
});
```

4. Keep the existing `if (!resp.ok) { … }` error block unchanged (it already parses `{code,msg}`), but ensure `format` is used for the logged `format` column (`format` instead of hard-coded `'anthropic'`).

5. Replace the success branch (the old `if (body.stream === true) { pipeWithUsage(resp, 'anthropic', …) }` + non-stream passthrough) with:

```ts
const model = stringValue(body.model) || 'codebuddy/claude-opus-4.6';

const logUsage = (
  prompt: number,
  completion: number,
  cacheRead: number,
  isStream: boolean,
  rawResp: string
) => {
  const cost = calculateCost(db, model, {
    prompt_tokens: prompt,
    completion_tokens: completion,
    cache_creation_tokens: 0,
    cache_read_tokens: cacheRead,
  });
  insertRequestLogDeferred(db, {
    client_key_id: clientKey.id,
    account_id: account.id,
    model,
    requested_model: model,
    endpoint: upstreamPath,
    format,
    prompt_tokens: prompt,
    completion_tokens: completion,
    cache_creation_tokens: 0,
    cache_read_tokens: cacheRead,
    total_tokens: prompt + completion,
    cost_usd: cost,
    latency_ms: Date.now() - startMs,
    status_code: resp.status,
    base_resp_code: undefined,
    stream: isStream ? 1 : 0,
    rtk_bytes_saved: 0,
    request_body: truncateBody(originalText),
    response_body: truncateBody(rawResp),
    request_headers: headersToJson(c.req.raw.headers),
    response_headers: headersToJson(resp.headers),
    req_id: reqId,
  });
  consoleBus.emit(
    buildDone(reqId, new Date().toISOString(), resp.status, null, prompt, completion, cacheRead, cost, Date.now() - startMs, 0)
  );
};

if (clientWantsStream) {
  if (format === 'anthropic') {
    return openaiSSEToAnthropicSSE(resp, model, (u) =>
      logUsage(u.prompt_tokens, u.completion_tokens, u.cache_read, true, '[anthropic-sse]')
    );
  }
  // openai client: passthrough OpenAI SSE, tee usage
  return pipeWithUsage(resp, 'openai', (usage, raw) =>
    logUsage(usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0, usage?.prompt_tokens_details?.cached_tokens ?? 0, true, raw)
  );
}

// Non-stream client: aggregate the forced upstream stream.
const aggregated = await aggregateOpenAISSE(resp);
const u = aggregated.usage;
logUsage(u?.prompt_tokens ?? 0, u?.completion_tokens ?? 0, u?.prompt_tokens_details?.cached_tokens ?? 0, false, JSON.stringify(aggregated).slice(0, 2000));
if (format === 'anthropic') {
  return c.json(responseOpenAIToAnthropic(aggregated));
}
return c.json(aggregated);
```

6. Remove the old `// Streaming passthrough — zero conversion` and `// Non-stream passthrough` blocks and any now-unused locals (`usage` object built from `input_tokens`, etc.).

> **Note:** Confirm `SSEUsage` from `pipeWithUsage` exposes `prompt_tokens_details`. If not, read `cache_read` differently per `src/streaming/extractUsage.ts`. Keep `account` error/recovery (`updateAccount`, `checkFallbackError`) exactly as in the current handler — only the success path changes.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/proxy/codebuddy.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/proxy/codebuddy.ts src/proxy/codebuddy.test.ts
git commit -m "feat(codebuddy): bridge OpenAI upstream to client format (stream + non-stream)"
```

---

### Task 6: Correct the seeded model list

**Files:**
- Modify: `scripts/seed-codebuddy-models.ts`

Replace the model list with the live-verified set. Remove unverified `gemini-2.5-flash`; add the tested `gemini-3.5-flash`, `gpt-5.5`, `glm-5.0`. Keep `claude-opus-4.6`, `gemini-3.1-pro`, `kimi-k2.5`. **Do not add `claude-opus-4.7`** — it returns `service info not found`.

- [ ] **Step 1: Edit the `MODELS` array**

```ts
// scripts/seed-codebuddy-models.ts — replace the MODELS array:
const MODELS: CodeBuddyModel[] = [
  { name: 'codebuddy/claude-opus-4.6', display: 'Claude Opus 4.6', context: 1000000 },
  { name: 'codebuddy/gemini-3.5-flash', display: 'Gemini 3.5 Flash', context: 1000000 },
  { name: 'codebuddy/gemini-3.1-pro', display: 'Gemini 3.1 Pro', context: 400000 },
  { name: 'codebuddy/gpt-5.5', display: 'GPT-5.5', context: 1000000 },
  { name: 'codebuddy/glm-5.0', display: 'GLM-5.0', context: 200000 },
  { name: 'codebuddy/kimi-k2.5', display: 'Kimi K2.5', context: 164000 },
];
```

- [ ] **Step 2: Run the seed against a throwaway DB to verify it executes**

Run: `ROUTER_DB_PATH=$(mktemp -d)/seed.db npx tsx scripts/seed-codebuddy-models.ts`
Expected: prints `Seeded 6 CodeBuddy models (6 new, 0 updated).`

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-codebuddy-models.ts
git commit -m "fix(codebuddy): seed live-verified model list, drop opus-4.7"
```

---

### Task 7: End-to-end live verification + account setup

**Files:** none (operational). Requires the real `ck_…` API key and network access.

- [ ] **Step 1: Seed models into the real DB**

Run: `npx tsx scripts/seed-codebuddy-models.ts`
Expected: `Seeded 6 CodeBuddy models`.

- [ ] **Step 2: Add the CodeBuddy account**

Run: `npx tsx scripts/add-codebuddy-account.ts ck_fp3jnkrwvd34.Mo6w3XepNYi5WVpqVZhQrcrTKzsGJOYqdX9CtTbgWBQ codebuddy-main`
Expected: `✓ Added CodeBuddy account: codebuddy-main`.

- [ ] **Step 3: Start the server**

Run: `npm run dev:server` (port 20137) — leave running in a background shell.

- [ ] **Step 4: Anthropic-format streaming request (Claude Code path)**

Run (replace `<CLIENT_KEY>` with a real client key from `npm run add-client-key`):

```bash
curl -N -s http://127.0.0.1:20137/v1/messages \
  -H "Authorization: Bearer <CLIENT_KEY>" -H "Content-Type: application/json" \
  -d '{"model":"codebuddy/claude-opus-4.6","max_tokens":50,"stream":true,"messages":[{"role":"user","content":"say PING only"}]}'
```

Expected: SSE with `event: message_start`, `content_block_delta` text `PING`, `event: message_stop`. No `11101`.

- [ ] **Step 5: Anthropic-format non-stream request**

```bash
curl -s http://127.0.0.1:20137/v1/messages \
  -H "Authorization: Bearer <CLIENT_KEY>" -H "Content-Type: application/json" \
  -d '{"model":"codebuddy/gemini-3.5-flash","max_tokens":50,"messages":[{"role":"user","content":"say PONG only"}]}'
```

Expected: JSON `{"type":"message","role":"assistant","content":[{"type":"text","text":"PONG"}], …}`.

- [ ] **Step 6: Confirm the request log recorded usage**

Run: `sqlite3 "$ROUTER_DB_PATH" "SELECT model, status_code, prompt_tokens, completion_tokens, stream FROM request_logs ORDER BY id DESC LIMIT 3;"`
Expected: rows with `status_code=200`, non-broken model names, `stream` 1 and 0 respectively.

- [ ] **Step 7: Point Claude Code / hermes at the router and run one real turn.** Confirm a normal assistant reply (no protocol errors in the router Console page).

---

## Self-Review

**Spec coverage:**
- Verify CodeBuddy docs vs implementation → Background section documents the real protocol; Tasks 3-5 align the implementation to it. ✅
- "mulus dipakai Anthropic agent (Claude Code / hermes)" → Task 5 anthropic-stream + non-stream branches + Task 7 live agent turn. ✅
- "claude-opus-4.6/4.7, gemini-3.5-flash" → 4.6 ✅ and gemini-3.5-flash ✅ seeded (Task 6); **4.7 does not exist on CodeBuddy** — called out in Background + Task 6, surface to user. ⚠️ documented gap, not a code gap.
- Account setup ("biar bisa dipasang dengan baik") → Task 7 Steps 1-2 reuse existing `add-codebuddy-account.ts` (already correct). ✅

**Placeholder scan:** No `TBD`/`handle edge cases`/`similar to`/`write tests for the above` — every code step has full code; every test step has full test bodies. ✅

**Type consistency:** `prepareCodeBuddyBody(body, clientFormat)` used identically in Tasks 3 & 4. `OpenAIToAnthropicSSEAssembler` / `openaiSSEToAnthropicSSE` / `aggregateOpenAISSE` names consistent across Tasks 1, 2, 5. `executeCodeBuddy({…, clientFormat})` signature matches between Task 4 definition and Task 5 caller. `CodeBuddyUsageCallback` shape `{prompt_tokens, completion_tokens, total_tokens, cache_read}` consistent between assembler `getUsage()` and wrapper callback. ✅

**Known verification points flagged inline** (resolve while implementing, not blockers): `OpenAIResponse` exact field shape (`messageTypes.ts`), `upstreamFetch` argument order, `SSEUsage.prompt_tokens_details` presence, Hono context stub completeness.
