# Human-Readable Request/Response Body Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decode `request_body` / `response_body` / headers in the dashboard request detail modal into human-readable, channel-specific views (chat timeline for requests; Reconstructed / Events / Raw for SSE responses; unpacked completions for non-stream).

**Architecture:** Pure decode functions in a new `client/src/lib/decodeBody.ts` (strict TS, no `any`, discriminated unions). `client/src/pages/RequestDetail.tsx` renders the decoded structures, replacing the naive `JsonView`. Detection uses body shape + `content-type` header only (the `/api/admin/request-logs/:id` response lacks `stream`/`endpoint`/`format`). All client-side, no server/DB/capture change.

**Tech Stack:** Preact, TypeScript (strict), vitest (globals + jest-dom types), @tanstack/react-query, @testing-library/preact.

**Spec:** `docs/superpowers/specs/2026-06-21-human-readable-body-design.md`

---

## File Structure

- **Create** `client/src/lib/decodeBody.ts`, pure decode functions + types. Single responsibility: turn DB body strings into typed views.
- **Create** `client/src/lib/decodeBody.test.ts`, vitest unit tests for all decode functions.
- **Create** `client/src/lib/__fixtures__/decodeFixtures.ts`, real-ish body strings (openai completion, anthropic message, anthropic SSE multi-event, SSE partial, error object, plain error) as test inputs.
- **Create** `client/src/components/CollapsibleText.tsx`, `<details>`-style text block that auto-collapses >2 KB with "show more".
- **Create** `client/src/components/HeadersTable.tsx`, key-value table with sensitive-value masking, replacing inline `HeadersView`.
- **Modify** `client/src/pages/RequestDetail.tsx`, wire decoded views into tabs, add Response sub-tabs, use new components.
- **Create** `client/src/pages/RequestDetail.test.tsx`, render tests per tab + Raw fallback.

Conventions to follow (verified in repo):
- Test pattern: `import { describe, expect, it, vi } from 'vitest'` + `@testing-library/preact` (`render, screen, fireEvent`). Use `.toBeInTheDocument()` / `.toBeTruthy()` as in `client/src/__tests__/Button.test.tsx`.
- Test environment: `happy-dom`, `globals: true`, setup `./src/__tests__/setup.ts` (imports `@testing-library/jest-dom/vitest`). Config lives in `client/vite.config.ts` `test` block, NO separate `vitest.config.ts`.
- Provider tests: wrap in `QueryClientProvider` with `retry:false` QueryClient (see `client/src/__tests__/Overview.test.tsx:23-30`). Mock `../lib/api` via `vi.mock` OR `vi.spyOn(globalThis,'fetch')`, prefer fetch spy for detail queries to avoid module mock complexity.
- Type definition: inline `interface` near consumer (no `client/src/types/` dir exists).
- Component styling: inline `style` objects + CSS vars (`var(--ink)`, `var(--obsidian-3)`, `var(--grid)`, `var(--gold)`, `var(--ink-dim)`, `var(--radius-sm)`, `var(--font-mono)`), classes `mono`, `card-eyebrow`, `card-sub`, `specsheet`/`specsheet-row`/`specsheet-label`/`specsheet-value`, match `RequestDetail.tsx`.
- TS config: `strict: true`, `noImplicitAny`, jsx `react-jsx` (jsxImportSource `preact`). Import types at top of file, not inline `import('...')` in JSX.
- Lint: `biome check .` (script `lint`). No prettier. Run `npm run lint` before claiming done.

**CRITICAL test-caveat:** `RequestDetail` defaults to `tab='summary'`. Request/Response content is NOT in the DOM until the corresponding tab button is clicked. Render tests MUST click the tab before asserting on body content: `fireEvent.click(screen.getByRole('tab', { name: /^request$/i }))` (tab buttons use `role="tab"` with the tab name as text). Asserting `getByText('hi there')` without clicking will fail.

---

## Task 1: Type definitions + truncation helper

**Files:**
- Create: `client/src/lib/decodeBody.ts`
- Test: `client/src/lib/decodeBody.test.ts`

- [ ] **Step 1: Write the failing test for truncation detection**

```ts
// client/src/lib/decodeBody.test.ts
import { describe, expect, it } from 'vitest';
import { isTruncated, type BodyMeta } from './decodeBody';

describe('isTruncated', () => {
  it('returns true when body ends with truncation suffix', () => {
    expect(isTruncated('some data...truncated...')).toBe(true);
  });
  it('returns false for clean body', () => {
    expect(isTruncated('{"ok":true}')).toBe(false);
  });
  it('returns false for null', () => {
    expect(isTruncated(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/lib/decodeBody.test.ts`
Expected: FAIL, module `./decodeBody` not found.

- [ ] **Step 3: Write minimal implementation, types + isTruncated**

```ts
// client/src/lib/decodeBody.ts

export const TRUNCATION_SUFFIX = '...truncated...';

export interface BodyMeta {
  contentType?: string;
}

export type DecodedFormat =
  | 'openai-completion'
  | 'anthropic-message'
  | 'anthropic-sse'
  | 'error'
  | 'plain-text';

export interface ContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result' | 'reasoning';
  text?: string;
  mediaType?: string;
  byteLength?: number;
  toolName?: string;
  toolInput?: unknown;
  isError?: boolean;
}

export interface MessageCard {
  role: string;
  blocks: ContentBlock[];
}

export interface RequestSummary {
  messageCount: number;
  toolCount: number;
  hasSystem: boolean;
  stream: boolean;
}

export interface RequestView {
  kind: 'request';
  system?: ContentBlock[];
  tools?: Array<{ name: string; inputSchema?: unknown }>;
  messages: MessageCard[];
  summary: RequestSummary;
  raw: string;
  parseError?: string;
}

export interface SseEvent {
  type: string;
  data?: string;
}

export interface ReconstructedText {
  index: number;
  blockType: string;
  text: string;
  toolInput?: unknown;
  toolInputParseError?: boolean;
}

export type ResponseView =
  | { kind: 'nonstream'; contentBlocks: ContentBlock[]; finishReason?: string; usage?: unknown; raw: string }
  | {
      kind: 'sse';
      events: SseEvent[];
      reconstructed: ReconstructedText[];
      complete: boolean;
      raw: string;
    }
  | { kind: 'error'; errorType?: string; message: string; requestId?: string; raw: string }
  | { kind: 'plain-text'; text: string; raw: string };

export function isTruncated(body: string | null | undefined): boolean {
  return body != null && body.endsWith(TRUNCATION_SUFFIX);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/lib/decodeBody.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/decodeBody.ts client/src/lib/decodeBody.test.ts
git commit -m "feat(decode): add body decode types and truncation detector"
```

---

## Task 2: detectFormat

**Files:**
- Modify: `client/src/lib/decodeBody.ts`
- Test: `client/src/lib/decodeBody.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `client/src/lib/decodeBody.test.ts`:

```ts
import { detectFormat } from './decodeBody';

describe('detectFormat', () => {
  it('detects anthropic-sse from event: lines', () => {
    const body = 'event: message_start\ndata: {"type":"message_start"}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';
    expect(detectFormat(body, {})).toBe('anthropic-sse');
  });
  it('detects openai-completion from choices[]', () => {
    const body = JSON.stringify({ id: 'x', choices: [{ message: { content: 'hi' } }] });
    expect(detectFormat(body, {})).toBe('openai-completion');
  });
  it('detects anthropic-message from content[] + stop_reason', () => {
    const body = JSON.stringify({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' });
    expect(detectFormat(body, {})).toBe('anthropic-message');
  });
  it('detects error from error object', () => {
    const body = JSON.stringify({ error: { type: 'api_error', message: 'boom' } });
    expect(detectFormat(body, {})).toBe('error');
  });
  it('detects plain-text for unparseable body', () => {
    expect(detectFormat('fetch failed', {})).toBe('plain-text');
  });
  it('uses content-type event-stream as sse hint even without event: prefix', () => {
    expect(detectFormat('not json at all', { contentType: 'text/event-stream' })).toBe('anthropic-sse');
  });
  it('defaults to plain-text for non-json non-sse', () => {
    expect(detectFormat('some random text', {})).toBe('plain-text');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/lib/decodeBody.test.ts`
Expected: FAIL, `detectFormat` is not exported.

- [ ] **Step 3: Implement detectFormat**

Append to `client/src/lib/decodeBody.ts`:

```ts
export function detectFormat(body: string | null | undefined, meta: BodyMeta): DecodedFormat {
  if (body == null) return 'plain-text';
  const trimmed = body.trimStart();
  if (trimmed.startsWith('event:')) return 'anthropic-sse';
  if (meta.contentType?.includes('text/event-stream')) return 'anthropic-sse';
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return 'plain-text';
  }
  if (parsed !== null && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.choices)) return 'openai-completion';
    if (Array.isArray(obj.content) && 'stop_reason' in obj) return 'anthropic-message';
    if ('error' in obj) return 'error';
  }
  return 'plain-text';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/lib/decodeBody.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/decodeBody.ts client/src/lib/decodeBody.test.ts
git commit -m "feat(decode): add detectFormat with content-type hint"
```

---

## Task 3: decodeRequestBody: messages + system + tools

**Files:**
- Modify: `client/src/lib/decodeBody.ts`
- Test: `client/src/lib/decodeBody.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { decodeRequestBody } from './decodeBody';

describe('decodeRequestBody', () => {
  it('builds message cards from string content', () => {
    const body = JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] });
    const view = decodeRequestBody(body);
    expect(view.kind).toBe('request');
    expect(view.messages).toHaveLength(1);
    expect(view.messages[0].role).toBe('user');
    expect(view.messages[0].blocks[0]).toEqual({ type: 'text', text: 'hello' });
    expect(view.summary).toEqual({ messageCount: 1, toolCount: 0, hasSystem: false, stream: false });
  });

  it('maps array content blocks (text + tool_use + tool_result + image)', () => {
    const body = JSON.stringify({
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'get_weather', input: { city: 'Jakarta' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'sunny', is_error: false }] },
        { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }] },
      ],
    });
    const view = decodeRequestBody(body);
    expect(view.messages[0].blocks[0]).toEqual({ type: 'tool_use', toolName: 'get_weather', toolInput: { city: 'Jakarta' } });
    expect(view.messages[1].blocks[0]).toEqual({ type: 'tool_result', text: 'sunny', isError: false });
    const img = view.messages[2].blocks[0];
    expect(img.type).toBe('image');
    expect(img.mediaType).toBe('image/png');
    expect(img.byteLength).toBeGreaterThan(0);
  });

  it('captures system as text blocks (string)', () => {
    const body = JSON.stringify({ system: 'you are helpful', messages: [] });
    const view = decodeRequestBody(body);
    expect(view.system).toEqual([{ type: 'text', text: 'you are helpful' }]);
    expect(view.summary.hasSystem).toBe(true);
  });

  it('captures tools[] with name + input_schema', () => {
    const body = JSON.stringify({
      tools: [{ name: 'get_weather', input_schema: { type: 'object' } }],
      messages: [],
    });
    const view = decodeRequestBody(body);
    expect(view.tools).toEqual([{ name: 'get_weather', inputSchema: { type: 'object' } }]);
    expect(view.summary.toolCount).toBe(1);
  });

  it('sets summary.stream true when stream:true', () => {
    const view = decodeRequestBody(JSON.stringify({ stream: true, messages: [] }));
    expect(view.summary.stream).toBe(true);
  });

  it('returns parseError when body is not JSON', () => {
    const view = decodeRequestBody('not json');
    expect(view.parseError).toBeDefined();
    expect(view.raw).toBe('not json');
    expect(view.messages).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/lib/decodeBody.test.ts`
Expected: FAIL, `decodeRequestBody` not exported.

- [ ] **Step 3: Implement decodeRequestBody**

Append to `client/src/lib/decodeBody.ts`:

```ts
interface AnthropicContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  is_error?: boolean;
  source?: { type?: string; media_type?: string; data?: string };
}

interface AnthropicMessage {
  role: string;
  content: string | AnthropicContentBlock[];
}

export function decodeRequestBody(body: string | null | undefined): RequestView {
  const raw = body ?? '';
  const base: RequestView = {
    kind: 'request',
    messages: [],
    summary: { messageCount: 0, toolCount: 0, hasSystem: false, stream: false },
    raw,
  };
  if (!body) return base;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    return { ...base, parseError: e instanceof Error ? e.message : 'parse failed' };
  }
  if (parsed === null || typeof parsed !== 'object') return { ...base, parseError: 'not an object' };
  const obj = parsed as Record<string, unknown>;

  const systemBlocks = toSystemBlocks(obj.system);
  const tools = toTools(obj.tools);
  const messages = toMessages(obj.messages);

  return {
    ...base,
    system: systemBlocks,
    tools,
    messages,
    summary: {
      messageCount: messages.length,
      toolCount: tools?.length ?? 0,
      hasSystem: systemBlocks !== undefined,
      stream: obj.stream === true,
    },
  };
}

function toSystemBlocks(system: unknown): ContentBlock[] | undefined {
  if (system == null) return undefined;
  if (typeof system === 'string') return [{ type: 'text', text: system }];
  if (Array.isArray(system)) {
    return system
      .filter((b): b is AnthropicContentBlock => b !== null && typeof b === 'object' && 'type' in b)
      .map((b) => ({ type: 'text', text: b.text ?? '' }));
  }
  return undefined;
}

function toTools(tools: unknown): Array<{ name: string; inputSchema?: unknown }> | undefined {
  if (!Array.isArray(tools)) return undefined;
  return tools
    .filter((t): t is Record<string, unknown> => t !== null && typeof t === 'object')
    .map((t) => ({ name: String(t.name ?? ''), inputSchema: t.input_schema }));
}

function toMessages(messages: unknown): MessageCard[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m): m is AnthropicMessage => m !== null && typeof m === 'object' && 'role' in m)
    .map((m) => ({ role: m.role, blocks: toContentBlocks(m.content) }));
}

function toContentBlocks(content: string | AnthropicContentBlock[]): ContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  return content.map(toContentBlock);
}

function toContentBlock(b: AnthropicContentBlock): ContentBlock {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text ?? '' };
    case 'image':
      return {
        type: 'image',
        mediaType: b.source?.media_type,
        byteLength: b.source?.data?.length ?? 0,
      };
    case 'tool_use':
      return { type: 'tool_use', toolName: b.name, toolInput: b.input };
    case 'tool_result': {
      const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '');
      return { type: 'tool_result', text, isError: b.is_error === true };
    }
    default:
      return { type: 'text', text: JSON.stringify(b) };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/lib/decodeBody.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/decodeBody.ts client/src/lib/decodeBody.test.ts
git commit -m "feat(decode): add decodeRequestBody — messages, system, tools"
```

---

## Task 4: decodeResponseBody: non-stream (openai + anthropic) + error + plain

**Files:**
- Modify: `client/src/lib/decodeBody.ts`
- Test: `client/src/lib/decodeBody.test.ts`
- Create: `client/src/lib/__fixtures__/decodeFixtures.ts`

- [ ] **Step 1: Create fixtures file**

```ts
// client/src/lib/__fixtures__/decodeFixtures.ts

export const openaiCompletionBody = JSON.stringify({
  id: 'chatcmpl-x',
  object: 'chat.completion',
  choices: [
    {
      index: 0,
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'Hello there.', reasoning_content: 'thinking...' },
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
});

export const anthropicMessageBody = JSON.stringify({
  id: 'msg_x',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'Hi from anthropic' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 5, output_tokens: 2 },
});

export const errorObjectBody = JSON.stringify({
  error: { type: 'overloaded_error', message: 'Overloaded' },
  request_id: 'req_123',
});

export const plainErrorBody = 'fetch failed';

export const sseFullBody = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_1","model":"x","usage":{"input_tokens":3,"output_tokens":0}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":3,"output_tokens":2}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
].join('\n');

export const ssePartialBody = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_1","model":"x","usage":{"input_tokens":3,"output_tokens":0}}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}',
  '',
].join('\n');
```

- [ ] **Step 2: Write the failing tests**

```ts
import { decodeResponseBody } from './decodeBody';
import {
  openaiCompletionBody,
  anthropicMessageBody,
  errorObjectBody,
  plainErrorBody,
} from './__fixtures__/decodeFixtures';

describe('decodeResponseBody non-stream', () => {
  it('unpacks openai completion content + reasoning + usage', () => {
    const view = decodeResponseBody(openaiCompletionBody, {});
    expect(view.kind).toBe('nonstream');
    if (view.kind !== 'nonstream') throw new Error('nonstream');
    expect(view.contentBlocks).toEqual([
      { type: 'reasoning', text: 'thinking...' },
      { type: 'text', text: 'Hello there.' },
    ]);
    expect(view.finishReason).toBe('stop');
    expect(view.usage).toEqual({ prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 });
  });

  it('unpacks anthropic message content blocks', () => {
    const view = decodeResponseBody(anthropicMessageBody, {});
    expect(view.kind).toBe('nonstream');
    if (view.kind !== 'nonstream') throw new Error('nonstream');
    expect(view.contentBlocks).toEqual([{ type: 'text', text: 'Hi from anthropic' }]);
    expect(view.finishReason).toBe('end_turn');
  });

  it('decodes error object', () => {
    const view = decodeResponseBody(errorObjectBody, {});
    expect(view.kind).toBe('error');
    if (view.kind !== 'error') throw new Error('error');
    expect(view.errorType).toBe('overloaded_error');
    expect(view.message).toBe('Overloaded');
    expect(view.requestId).toBe('req_123');
  });

  it('decodes plain error text', () => {
    const view = decodeResponseBody(plainErrorBody, {});
    expect(view.kind).toBe('plain-text');
    if (view.kind !== 'plain-text') throw new Error('plain');
    expect(view.text).toBe('fetch failed');
  });

  it('returns plain-text for null body', () => {
    const view = decodeResponseBody(null, {});
    expect(view.kind).toBe('plain-text');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd client && npx vitest run src/lib/decodeBody.test.ts`
Expected: FAIL, `decodeResponseBody` not exported.

- [ ] **Step 4: Implement non-stream + error + plain branches**

Append to `client/src/lib/decodeBody.ts`:

```ts
export function decodeResponseBody(
  body: string | null | undefined,
  meta: BodyMeta,
): ResponseView {
  const raw = body ?? '';
  const format = detectFormat(body, meta);
  switch (format) {
    case 'openai-completion':
      return decodeOpenaiCompletion(raw);
    case 'anthropic-message':
      return decodeAnthropicMessage(raw);
    case 'anthropic-sse':
      return decodeAnthropicSse(raw);
    case 'error':
      return decodeErrorObject(raw);
    case 'plain-text':
    default:
      return { kind: 'plain-text', text: raw, raw };
  }
}

function decodeOpenaiCompletion(raw: string): ResponseView {
  const obj = JSON.parse(raw) as {
    choices?: Array<{ finish_reason?: string; message?: { content?: string; reasoning_content?: string } }>;
    usage?: unknown;
  };
  const choice = obj.choices?.[0];
  const blocks: ContentBlock[] = [];
  if (choice?.message?.reasoning_content) {
    blocks.push({ type: 'reasoning', text: choice.message.reasoning_content });
  }
  if (choice?.message?.content != null) {
    blocks.push({ type: 'text', text: choice.message.content });
  }
  return {
    kind: 'nonstream',
    contentBlocks: blocks,
    finishReason: choice?.finish_reason,
    usage: obj.usage,
    raw,
  };
}

function decodeAnthropicMessage(raw: string): ResponseView {
  const obj = JSON.parse(raw) as {
    content?: AnthropicContentBlock[];
    stop_reason?: string;
    usage?: unknown;
  };
  return {
    kind: 'nonstream',
    contentBlocks: Array.isArray(obj.content) ? obj.content.map(toContentBlock) : [],
    finishReason: obj.stop_reason,
    usage: obj.usage,
    raw,
  };
}

function decodeErrorObject(raw: string): ResponseView {
  const obj = JSON.parse(raw) as {
    error?: { type?: string; message?: string };
    request_id?: string;
    message?: string;
  };
  return {
    kind: 'error',
    errorType: obj.error?.type,
    message: obj.error?.message ?? obj.message ?? '',
    requestId: obj.request_id,
    raw,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd client && npx vitest run src/lib/decodeBody.test.ts`
Expected: PASS, all non-stream/error/plain tests green. (SSE tests added in Task 5, not yet present.)

- [ ] **Step 6: Commit (green, SSE deferred to Task 5)**

```bash
git add client/src/lib/decodeBody.ts client/src/lib/decodeBody.test.ts client/src/lib/__fixtures__/decodeFixtures.ts
git commit -m "feat(decode): add non-stream + error + plain response decode"
```

> Do NOT add SSE tests here. Task 5 adds SSE tests + `decodeAnthropicSse` together (red→green in one task) so every commit is green.

---

## Task 5: decodeResponseBody: SSE branch (events + reconstruction)

**Files:**
- Modify: `client/src/lib/decodeBody.ts`
- Test: `client/src/lib/decodeBody.test.ts`

- [ ] **Step 1: Write the failing SSE tests**

```ts
import { sseFullBody, ssePartialBody } from './__fixtures__/decodeFixtures';

describe('decodeResponseBody sse', () => {
  it('parses events list', () => {
    const view = decodeResponseBody(sseFullBody, {});
    expect(view.kind).toBe('sse');
    if (view.kind !== 'sse') throw new Error('sse');
    expect(view.events.map((e) => e.type)).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
  });

  it('reconstructs text from deltas', () => {
    const view = decodeResponseBody(sseFullBody, {});
    if (view.kind !== 'sse') throw new Error('sse');
    expect(view.reconstructed).toHaveLength(1);
    expect(view.reconstructed[0]).toEqual({
      index: 0,
      blockType: 'text',
      text: 'Hello world',
    });
    expect(view.complete).toBe(true);
  });

  it('marks incomplete when message_stop missing', () => {
    const view = decodeResponseBody(ssePartialBody, {});
    if (view.kind !== 'sse') throw new Error('sse');
    expect(view.complete).toBe(false);
    expect(view.reconstructed[0].text).toBe('partial');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/lib/decodeBody.test.ts`
Expected: FAIL, `decodeAnthropicSse` not defined.

- [ ] **Step 3: Implement decodeAnthropicSse**

Append to `client/src/lib/decodeBody.ts`:

```ts
interface SseDelta {
  type: string;
  text?: string;
  partial_json?: string;
}

interface SseEventPayload {
  type: string;
  index?: number;
  content_block?: { type: string };
  delta?: SseDelta;
  usage?: unknown;
  message?: { model?: string; usage?: unknown };
}

function decodeAnthropicSse(raw: string): ResponseView {
  const events: SseEvent[] = [];
  const blocks = new Map<number, { type: string; parts: string[]; toolParts: string[] }>();
  let complete = false;

  for (const chunk of raw.split('\n\n')) {
    const lines = chunk.split('\n');
    let type: string | undefined;
    let dataLine: string | undefined;
    for (const line of lines) {
      if (line.startsWith('event: ')) type = line.slice(7).trim();
      else if (line.startsWith('data: ')) dataLine = line.slice(6);
    }
    if (!type) continue;
    events.push({ type, data: dataLine });
    let payload: SseEventPayload | undefined;
    if (dataLine) {
      try {
        payload = JSON.parse(dataLine) as SseEventPayload;
      } catch {
        payload = undefined;
      }
    }
    if (!payload) continue;
    if (type === 'message_stop') complete = true;
    if (type === 'content_block_start' && typeof payload.index === 'number') {
      blocks.set(payload.index, {
        type: payload.content_block?.type ?? 'text',
        parts: [],
        toolParts: [],
      });
    }
    if (type === 'content_block_delta' && typeof payload.index === 'number') {
      const block = blocks.get(payload.index);
      if (!block) continue;
      if (payload.delta?.type === 'text_delta' && typeof payload.delta.text === 'string') {
        block.parts.push(payload.delta.text);
      } else if (payload.delta?.type === 'input_json_delta' && typeof payload.delta.partial_json === 'string') {
        block.toolParts.push(payload.delta.partial_json);
      }
    }
  }

  const reconstructed: ReconstructedText[] = [...blocks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, block]) => {
      if (block.type === 'tool_use') {
        const joined = block.toolParts.join('');
        try {
          return { index, blockType: block.type, text: block.parts.join(''), toolInput: JSON.parse(joined) };
        } catch {
          return { index, blockType: block.type, text: block.parts.join(''), toolInputParseError: true };
        }
      }
      return { index, blockType: block.type, text: block.parts.join('') };
    });

  return { kind: 'sse', events, reconstructed, complete, raw };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/lib/decodeBody.test.ts`
Expected: PASS (all tests, including SSE).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/decodeBody.ts client/src/lib/decodeBody.test.ts
git commit -m "feat(decode): add SSE decode — events list + text reconstruction"
```

---

## Task 6: CollapsibleText component

**Files:**
- Create: `client/src/components/CollapsibleText.tsx`
- Test: `client/src/components/CollapsibleText.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/CollapsibleText.test.tsx
import { describe, expect, it } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/preact';
import { CollapsibleText } from './CollapsibleText';

describe('CollapsibleText', () => {
  it('renders short text fully without collapse', () => {
    const { container } = render(<CollapsibleText text="short" />);
    expect(container.textContent).toBe('short');
    expect(screen.queryByText('show more')).toBeNull();
  });

  it('collapses text over 2KB and shows toggle', () => {
    const long = 'x'.repeat(3000);
    const { container } = render(<CollapsibleText text={long} />);
    // Collapsed preview: first 1992 chars + "..."
    expect(container.textContent).toContain('...');
    expect(screen.getByText('show more')).toBeTruthy();
  });

  it('expands full text on click', () => {
    const long = 'x'.repeat(3000);
    const { container } = render(<CollapsibleText text={long} />);
    fireEvent.click(screen.getByText('show more'));
    expect(container.textContent).not.toContain('...');
    expect(screen.getByText('show less')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/CollapsibleText.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement CollapsibleText**

```tsx
// client/src/components/CollapsibleText.tsx
import { useState } from 'preact/hooks';

const COLLAPSE_THRESHOLD = 2048;
const PREVIEW_LENGTH = 1992;

export function CollapsibleText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= COLLAPSE_THRESHOLD) {
    return <span>{text}</span>;
  }
  return (
    <span>
      <span>{expanded ? text : `${text.slice(0, PREVIEW_LENGTH)}...`}</span>{' '}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        class="mono"
        style={{
          background: 'none',
          border: 0,
          padding: 0,
          color: 'var(--gold)',
          cursor: 'pointer',
          fontSize: 11,
        }}
      >
        {expanded ? 'show less' : 'show more'}
      </button>
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/CollapsibleText.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/CollapsibleText.tsx client/src/components/CollapsibleText.test.tsx
git commit -m "feat(ui): add CollapsibleText component for large blocks"
```

> Verify `@testing-library/preact` is installed: `cd client && npm ls @testing-library/preact`. If missing, run `npm i -D @testing-library/preact` and commit `package.json` + lockfile with this task.

---

## Task 7: HeadersTable component with masking

**Files:**
- Create: `client/src/components/HeadersTable.tsx`
- Test: `client/src/components/HeadersTable.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/HeadersTable.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { HeadersTable, maskHeaderValue } from './HeadersTable';

describe('maskHeaderValue', () => {
  it('masks authorization with scheme prefix + 4 chars', () => {
    expect(maskHeaderValue('authorization', 'Bearer sk-abc123456')).toBe('Bearer sk-a****');
  });
  it('does not mask content-type', () => {
    expect(maskHeaderValue('content-type', 'application/json')).toBe('application/json');
  });
  it('handles short sensitive values', () => {
    expect(maskHeaderValue('x-api-key', 'abc')).toBe('a****');
  });
});

describe('HeadersTable', () => {
  it('renders masked sensitive + plain values sorted', () => {
    render(<HeadersTable headers={{ 'content-type': 'application/json', authorization: 'Bearer secret-token' }} />);
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('Bearer sec****')).toBeTruthy();
    expect(screen.getByText('application/json')).toBeTruthy();
  });
  it('shows empty message when no headers', () => {
    render(<HeadersTable headers={null} />);
    expect(screen.getByText(/No headers recorded/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/HeadersTable.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement HeadersTable**

```tsx
// client/src/components/HeadersTable.tsx

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'proxy-authorization',
  'cookie',
  'set-cookie',
]);

export function maskHeaderValue(key: string, value: string): string {
  if (!SENSITIVE_HEADERS.has(key.toLowerCase())) return value;
  const spaceIdx = value.indexOf(' ');
  const prefix = spaceIdx >= 0 ? value.slice(0, spaceIdx + 1) : '';
  const rest = spaceIdx >= 0 ? value.slice(spaceIdx + 1) : value;
  const shown = rest.slice(0, 4);
  return `${prefix}${shown}****`;
}

export function HeadersTable({ headers }: { headers: Record<string, string> | null }) {
  if (!headers || Object.keys(headers).length === 0) {
    return (
      <p class="card-sub" style={{ color: 'var(--ink-dim)', marginBottom: 0 }}>
        No headers recorded.
      </p>
    );
  }
  const entries = Object.entries(headers).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div class="specsheet" style={{ marginBottom: 16 }}>
      {entries.map(([k, v]) => (
        <div class="specsheet-row" role="row" key={k}>
          <span class="specsheet-label">{k}</span>
          <span class="specsheet-value mono" style={{ wordBreak: 'break-all' }}>
            {maskHeaderValue(k, v)}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/HeadersTable.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/HeadersTable.tsx client/src/components/HeadersTable.test.tsx
git commit -m "feat(ui): add HeadersTable with sensitive-value masking"
```

---

## Task 8: Wire decode into RequestDetail: Request tab + Headers tab

**Files:**
- Modify: `client/src/pages/RequestDetail.tsx:27` (Tab type), `:301-312` (request tab), `:78-97` (HeadersView usage)
- Test: `client/src/pages/RequestDetail.test.tsx`

- [ ] **Step 1: Write the failing render test for Request tab**

```tsx
// client/src/pages/RequestDetail.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RequestDetail } from './RequestDetail';

function mockLog(body: Record<string, unknown>) {
  const base = {
    id: 1,
    createdAt: '2026-06-21T00:00:00Z',
    model: 'test',
    statusCode: 200,
    latencyMs: 10,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0,
    clientKeyId: null,
    accountId: null,
    requestBody: null,
    responseBody: null,
    requestHeaders: null,
    responseHeaders: null,
    error: null,
    ...body,
  };
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(base), { status: 200, headers: { 'content-type': 'application/json' } })
  );
}

function withClient(node: preact.JSX.Element) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

async function openTab(label: RegExp) {
  await waitFor(() => expect(screen.getByRole('tab', { name: label })).toBeTruthy());
  fireEvent.click(screen.getByRole('tab', { name: label }));
}

beforeEach(() => vi.restoreAllMocks());

describe('RequestDetail request tab', () => {
  it('renders decoded message timeline', async () => {
    mockLog({ requestBody: JSON.stringify({ messages: [{ role: 'user', content: 'hi there' }] }) });
    render(withClient(<RequestDetail id={1} onClose={() => {}} />));
    await openTab(/^request$/i);
    await waitFor(() => expect(screen.getByText('hi there')).toBeTruthy());
  });

  it('shows Raw fallback when request body unparseable', async () => {
    mockLog({ requestBody: 'not json {{{' });
    render(withClient(<RequestDetail id={1} onClose={() => {}} />));
    await openTab(/^request$/i);
    await waitFor(() => expect(screen.getByText(/Unparseable request body/i)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/RequestDetail.test.tsx`
Expected: FAIL, Request tab still renders raw JsonView, "Unparseable" message absent.

- [ ] **Step 3: Update RequestDetail.tsx, imports + Request tab + Headers**

Edit the imports block (top of file):

```tsx
import { useQuery } from '@tanstack/react-query';
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { CollapsibleText } from '../components/CollapsibleText';
import { HeadersTable } from '../components/HeadersTable';
import { ErrorState } from '../components/ErrorState';
import { Modal } from '../components/Modal';
import { apiFetch } from '../lib/api';
import { decodeRequestBody, decodeResponseBody, isTruncated } from '../lib/decodeBody';
import type { ContentBlock, MessageCard, ResponseView } from '../lib/decodeBody';
```

Replace the `JsonView` function (lines 45-76), keep it as a Raw-only renderer (rename usage but keep function for Raw):

```tsx
function RawView({ data }: { data: string | null | undefined }) {
  if (data == null)
    return (
      <p class="card-sub" style={{ color: 'var(--ink-dim)', marginBottom: 0 }}>
        No body captured for this phase.
      </p>
    );
  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(data), null, 2);
  } catch {
    formatted = data;
  }
  return (
    <pre
      class="mono"
      style={{
        maxHeight: '40vh',
        overflow: 'auto',
        background: 'var(--obsidian-3)',
        border: '1px solid var(--grid)',
        padding: 12,
        borderRadius: 'var(--radius-sm)',
        fontSize: 12,
        lineHeight: 1.5,
        color: 'var(--ink)',
      }}
    >
      {formatted}
    </pre>
  );
}
```

Delete the old `HeadersView` function (lines 78-97), replaced by `<HeadersTable>`.

Add a `ContentBlockView` + `MessageCard` renderer above the `RequestDetail` component:

```tsx
function ContentBlockView({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'text':
      return (
        <div class="mono" style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          <CollapsibleText text={block.text ?? ''} />
        </div>
      );
    case 'reasoning':
      return (
        <div class="mono" style={{ fontSize: 12, opacity: 0.7, borderLeft: '2px solid var(--gold-dim)', paddingLeft: 8 }}>
          <CollapsibleText text={block.text ?? ''} />
        </div>
      );
    case 'image':
      return (
        <div class="mono" style={{ fontSize: 11, color: 'var(--ink-dim)' }}>
          [image · {block.mediaType ?? 'unknown'} · {block.byteLength ?? 0} bytes]
        </div>
      );
    case 'tool_use':
      return (
        <div class="mono" style={{ fontSize: 11 }}>
          <span style={{ color: 'var(--gold)' }}>tool_use: {block.toolName}</span>
          <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{JSON.stringify(block.toolInput, null, 2)}</pre>
        </div>
      );
    case 'tool_result':
      return (
        <div class="mono" style={{ fontSize: 11 }}>
          <span style={{ color: block.isError ? 'var(--crit)' : 'var(--ink-dim)' }}>tool_result{block.isError ? ' (error)' : ''}</span>
          <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{block.text ?? ''}</pre>
        </div>
      );
    default:
      return null;
  }
}

function MessageCardView({ card }: { card: MessageCard }) {
  const ink = card.role === 'user' ? 'var(--gold)' : 'var(--ink)';
  return (
    <div style={{ marginBottom: 12 }}>
      <div class="card-eyebrow" style={{ color: ink, marginBottom: 4 }}>{card.role}</div>
      {card.blocks.map((b, i) => <ContentBlockView key={i} block={b} />)}
    </div>
  );
}

function RequestTimeline({ data }: { data: RequestLog }) {
  const view = useMemo(() => decodeRequestBody(data.requestBody), [data.requestBody]);
  const truncated = isTruncated(data.requestBody);
  return (
    <div>
      {truncated && (
        <div class="card-eyebrow" style={{ color: 'var(--gold)', marginBottom: 8 }}>truncated — full body not captured</div>
      )}
      <div class="mono" style={{ fontSize: 11, color: 'var(--ink-dim)', marginBottom: 12 }}>
        {view.summary.messageCount} messages · {view.summary.toolCount} tools · {view.summary.hasSystem ? 'system' : 'no system'} · {view.summary.stream ? 'stream' : 'non-stream'}
      </div>
      {view.parseError ? (
        <div>
          <p class="card-sub" style={{ color: 'var(--crit)', marginBottom: 8 }}>Unparseable request body, see Raw.</p>
          <RawView data={data.requestBody} />
        </div>
      ) : (
        <>
          {view.system && view.system.length > 0 && (
            <details style={{ marginBottom: 12 }}>
              <summary class="card-eyebrow" style={{ cursor: 'pointer' }}>SYSTEM</summary>
              <div style={{ marginTop: 8 }}>
                {view.system.map((b, i) => <ContentBlockView key={i} block={b} />)}
              </div>
            </details>
          )}
          {view.tools && view.tools.length > 0 && (
            <details style={{ marginBottom: 12 }}>
              <summary class="card-eyebrow" style={{ cursor: 'pointer' }}>TOOLS ({view.tools.length})</summary>
              <div style={{ marginTop: 8 }}>
                {view.tools.map((t, i) => (
                  <div key={i} class="mono" style={{ fontSize: 11, marginBottom: 8 }}>
                    <span style={{ color: 'var(--gold)' }}>{t.name}</span>
                    <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{JSON.stringify(t.inputSchema, null, 2)}</pre>
                  </div>
                ))}
              </div>
            </details>
          )}
          {view.messages.map((m, i) => <MessageCardView key={i} card={m} />)}
          <div class="card-eyebrow" style={{ margin: '16px 0 8px' }}>REQUEST BODY (RAW)</div>
          <RawView data={data.requestBody} />
        </>
      )}
    </div>
  );
}
```

Replace the request tab body (the `{data && tab === 'request' && (...)}` block, lines 301-312):

```tsx
      {data && tab === 'request' && (
        <div id="tabpanel-request" role="tabpanel" aria-labelledby="tab-request">
          <div class="card-eyebrow" style={{ marginBottom: 8 }}>REQUEST</div>
          <RequestTimeline data={data} />
          <div class="card-eyebrow" style={{ margin: '16px 0 8px' }}>REQUEST HEADERS</div>
          <HeadersTable headers={data.requestHeaders} />
        </div>
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/RequestDetail.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Run typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/RequestDetail.tsx client/src/pages/RequestDetail.test.tsx
git commit -m "feat(ui): decode request body into chat timeline in modal"
```

---

## Task 9: Response tab: sub-tabs (Reconstructed / Events / Raw) + non-stream + error

**Files:**
- Modify: `client/src/pages/RequestDetail.tsx:27` (Tab type, add 'response'), `:314-325` (response tab)
- Test: `client/src/pages/RequestDetail.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `client/src/pages/RequestDetail.test.tsx`:

```tsx
describe('RequestDetail response tab', () => {
  it('renders reconstructed SSE text and raw sub-tab', async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"model":"x"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');
    mockLog({
      responseBody: sse,
      responseHeaders: { 'content-type': 'text/event-stream' },
    });
    render(withClient(<RequestDetail id={1} onClose={() => {}} />));
    await openTab(/^response$/i);
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy());
  });

  it('renders unpacked non-stream completion content', async () => {
    mockLog({
      responseBody: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'final answer' } }] }),
      responseHeaders: { 'content-type': 'application/json' },
    });
    render(withClient(<RequestDetail id={1} onClose={() => {}} />));
    await openTab(/^response$/i);
    await waitFor(() => expect(screen.getByText('final answer')).toBeTruthy());
  });

  it('renders Raw fallback when response decode throws', async () => {
    mockLog({ responseBody: 'fetch failed', responseHeaders: null });
    render(withClient(<RequestDetail id={1} onClose={() => {}} />));
    await openTab(/^response$/i);
    await waitFor(() => expect(screen.getByText('fetch failed')).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/pages/RequestDetail.test.tsx`
Expected: FAIL, response tab still uses old `JsonView`.

- [ ] **Step 3: Implement ResponsePanel with sub-tabs**

Add above `RequestDetail` in `client/src/pages/RequestDetail.tsx`:

```tsx
type ResponseSubTab = 'reconstructed' | 'events' | 'content' | 'error' | 'raw';

function ResponsePanel({ data }: { data: RequestLog }) {
  const contentType = data.responseHeaders?.['content-type'];
  const view = useMemo(
    () => decodeResponseBody(data.responseBody, { contentType }),
    [data.responseBody, contentType],
  );
  const truncated = isTruncated(data.responseBody);
  const defaultSub: ResponseSubTab =
    view.kind === 'sse' ? 'reconstructed'
    : view.kind === 'error' ? 'error'
    : view.kind === 'plain-text' ? 'raw'
    : 'content';
  const [sub, setSub] = useState<ResponseSubTab>(defaultSub);

  const subs: ResponseSubTab[] =
    view.kind === 'sse' ? ['reconstructed', 'events', 'raw']
    : view.kind === 'error' ? ['error', 'raw']
    : view.kind === 'plain-text' ? ['raw']
    : ['content', 'raw'];

  return (
    <div>
      {truncated && (
        <div class="card-eyebrow" style={{ color: 'var(--gold)', marginBottom: 8 }}>truncated — full body not captured</div>
      )}
      {view.kind === 'sse' && !view.complete && (
        <div class="card-eyebrow" style={{ color: 'var(--crit)', marginBottom: 8 }}>incomplete stream</div>
      )}
      <div role="tablist" style={{ display: 'flex', gap: 2, marginBottom: 12 }}>
        {subs.map((s) => (
          <button
            type="button"
            key={s}
            onClick={() => setSub(s)}
            class="mono"
            style={{
              background: 'none',
              border: 0,
              padding: '6px 10px',
              color: sub === s ? 'var(--gold)' : 'var(--ink-dim)',
              borderBottom: sub === s ? '2px solid var(--gold)' : '2px solid transparent',
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            {s}
          </button>
        ))}
      </div>
      {sub === 'reconstructed' && view.kind === 'sse' && (
        <div>
          {view.reconstructed.map((r) => (
            <div key={r.index} style={{ marginBottom: 12 }}>
              <div class="card-eyebrow" style={{ color: 'var(--gold)', marginBottom: 4 }}>block {r.index} · {r.blockType}</div>
              <pre class="mono" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, margin: 0 }}>
                {r.text || (r.toolInputParseError ? '<tool input unparseable>' : '')}
              </pre>
            </div>
          ))}
        </div>
      )}
      {sub === 'events' && view.kind === 'sse' && (
        <pre class="mono" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11, maxHeight: '40vh', overflow: 'auto' }}>
          {view.events.map((e) => `${e.type}${e.data ? `: ${e.data}` : ''}`).join('\n')}
        </pre>
      )}
      {sub === 'content' && view.kind === 'nonstream' && (
        <div>
          {view.contentBlocks.map((b, i) => <ContentBlockView key={i} block={b} />)}
          {view.finishReason && <div class="mono" style={{ fontSize: 11, color: 'var(--ink-dim)', marginTop: 8 }}>finish: {view.finishReason}</div>}
        </div>
      )}
      {sub === 'error' && view.kind === 'error' && (
        <pre class="mono" style={{ color: 'var(--crit)', whiteSpace: 'pre-wrap', borderLeft: '2px solid var(--crit)', paddingLeft: 10 }}>
          {view.errorType ? `[${view.errorType}] ` : ''}{view.message}{view.requestId ? `\nrequest_id: ${view.requestId}` : ''}
        </pre>
      )}
      {sub === 'raw' && <RawView data={data.responseBody} />}
    </div>
  );
}
```

Replace the response tab body (lines 314-325):

```tsx
      {data && tab === 'response' && (
        <div id="tabpanel-response" role="tabpanel" aria-labelledby="tab-response">
          <div class="card-eyebrow" style={{ marginBottom: 8 }}>RESPONSE</div>
          <ResponsePanel data={data} />
          <div class="card-eyebrow" style={{ margin: '16px 0 8px' }}>RESPONSE HEADERS</div>
          <HeadersTable headers={data.responseHeaders} />
        </div>
      )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/pages/RequestDetail.test.tsx`
Expected: PASS (all).

- [ ] **Step 5: Run full test suite + typecheck**

Run: `cd client && npx vitest run && npx tsc --noEmit`
Expected: All tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/RequestDetail.tsx client/src/pages/RequestDetail.test.tsx
git commit -m "feat(ui): decode response body — SSE reconstructed/events, non-stream, error"
```

---

## Task 10: End-to-end manual verification against real DB

**Files:** none (verification only)

- [ ] **Step 1: Start dev server**

Run: `cd client && npm run dev` (background) + the proxy server per project skill `add-dashboard-page`/`run` convention.

- [ ] **Step 2: Open Usage page, click rows covering each case**

Verify in the modal:
- **Non-stream success** (row id=927 shape, OpenAI completion): Request tab shows message timeline; Response → Content shows assistant text + reasoning.
- **Stream success** (id=973 shape, SSE): Response → Reconstructed shows concatenated text; Events shows per-event list; Raw shows original SSE.
- **Error** (id=826 shape, "fetch failed"): Response → Raw shows "fetch failed"; Error tab (existing) still works.
- **Headers tab**: sensitive headers masked; content-type shown plain.
- **Truncation badge**: appears for 100KB bodies.

- [ ] **Step 3: Run full test + typecheck + lint**

Run: `cd client && npx vitest run && npx tsc --noEmit && npm run lint`
Expected: All green.

- [ ] **Step 4: Final commit if any cleanup**

```bash
git add -A
git commit -m "test(decode): verified against real request_logs rows"
```

> If no cleanup needed, skip, verification only.

---

## Self-Review (run after writing, before handoff)

**Spec coverage:**
- decodeBody.ts types + detectFormat → Tasks 1-2 ✓
- decodeRequestBody (messages/system/tools/collapse) → Task 3 ✓ (auto-collapse in CollapsibleText, Task 6)
- decodeResponseBody non-stream + error + plain → Task 4 ✓
- decodeResponseBody SSE events + reconstruction + tool_use input_json_delta → Task 5 ✓
- Truncation badge + incomplete stream badge → Tasks 8-9 ✓
- Request tab timeline → Task 8 ✓
- Response sub-tabs (Reconstructed/Events/Raw, Content, Error) → Task 9 ✓
- Headers tab masking → Task 7 ✓
- Raw fallback on parse/decode failure → Tasks 8-9 ✓
- TDD tests + real-DB fixtures → Tasks 4-5 ✓
- Render tests per tab → Tasks 8-9 ✓
- Manual verification → Task 10 ✓

**Placeholder scan:** none, every step has real code/commands.

**Type consistency:** `ResponseView.kind` values (`nonstream`, `sse`, `error`, `plain-text`) match `detectFormat` outputs used in `decodeResponseBody` switch and ResponsePanel sub-tab logic. `ContentBlock` shape consistent across decode + render. `MessageCard` consistent. ✓

**Note:** Task 4 leaves SSE tests failing until Task 5, execute back-to-back, do not stop between.
