# Provider Correctness Fixes Implementation Plan

> **For agentic workers:** Execute this plan step-by-step using the `superpowers:subagent-driven-development` skill. Each task is a self-contained TDD cycle: write the failing test, see it fail, implement the minimal fix, see it pass, commit. Do not batch multiple GAPs into one commit.

**Goal:** Fix three cost/money correctness bugs and one Z.AI content-loss bug across Pioneer, CodeBuddy, and Z.AI proxy handlers. Each bug causes either $0 cost logging (wrong model key passed to `calculateCost`) or complete content loss + zero tokens (wrong SSE parser for Anthropic upstream).

**Architecture:** Hono HTTP proxy → provider handler (`src/proxy/*.ts`) → upstream executor (`src/providers/*/index.ts`) → `calculateCost` (keyed by DB model name) + `pipeWithUsage` / `aggregateOpenAISSE` for streaming. The pricing DB is keyed by exact model name (e.g. `pioneer/claude-opus-4-8`), so passing an alias prefix (`pio/...`, `cb/...`) always returns `null` → cost = 0.

**Tech Stack:** TypeScript strict, Hono, Node 20+, better-sqlite3, vitest, no external mocking library beyond `vi.spyOn`.

---

## File Structure

| Action | File |
|--------|------|
| **modify** | `src/proxy/pioneer.ts` |
| **modify** | `src/proxy/codebuddy.ts` |
| **modify** | `src/proxy/zai.ts` |
| **create** | `src/proxy/pioneer.cost.test.ts` |
| **create** | `src/proxy/codebuddy.cost.test.ts` |
| **create** | `src/proxy/zai.anthropic.test.ts` |

---

## Verified Bugs (Code-Confirmed)

### GAP A: Pioneer: `calculateCost` receives alias `pio/...` not upstream model

- **`src/proxy/pioneer.ts:61`**, `const model = stringValue(body.model) || 'pio/claude-opus-4-8'`
, this captures the alias (`pio/...`) from the request body.
- **`src/proxy/pioneer.ts:160`**, `logCtxBase` sets `model: model` (alias, not upstream).
- **`src/proxy/pioneer.ts:232`**, `calculateCost(db, model, ...)`, passes alias → `getModel(db, 'pio/...')` returns null → cost = 0 always.
- **`src/proxy/pioneer.ts:72`**, `upstreamModel` is already resolved correctly (strips `pioneer/` prefix for the API call), but the DB pricing key is `pioneer/<bare>`, so the correct key for `calculateCost` is the **full resolved upstreamModel before stripping**, i.e. `resolved.upstreamModel` before the `.startsWith('pioneer/')` slice.

**Root cause:** The `resolveModel` call (line 69) returns `resolved.upstreamModel` which is keyed as `pioneer/claude-opus-4-8` in the DB. Line 72 then strips the prefix to get the bare id for the upstream API. But `calculateCost` needs the **DB key** (`pioneer/claude-opus-4-8`), not the stripped bare id or the alias.

**Fix:** Introduce a `pricingModel` variable capturing `resolved.upstreamModel` (pre-strip) and use it in `calculateCost` and `logCtxBase`.

### GAP B: CodeBuddy: `calculateCost` receives alias `cb/...` not upstream model

- **`src/proxy/codebuddy.ts:61`**, `const model = stringValue(body.model) || 'cb/claude-opus-4.6'`
- **`src/proxy/codebuddy.ts:233`**, `calculateCost(db, model, ...)`, `model` is the `cb/...` alias; pricing DB has no entry for `cb/...` → cost = 0.
- **`src/proxy/codebuddy.ts:71`**, `upstreamModel = resolved.upstreamModel` is already correct (e.g. `codebuddy/claude-opus-4.6`).
- **`src/proxy/codebuddy.ts:160`**, `logCtxBase` already uses `model: upstreamModel` (correct).

**Fix:** Change `calculateCost(db, model, ...)` → `calculateCost(db, upstreamModel, ...)` at line 233. One-line fix.

### GAP C+D: Z.AI: anthropic-format stream uses OpenAI SSE parser; log placeholder literal

- **`src/proxy/zai.ts:246-249`**, when `format === 'anthropic'` and `body.stream === true`:
```ts
return openaiSSEToAnthropicSSE(resp, upstreamModel ?? model, (u) =>
recordUsage(u.prompt_tokens, u.completion_tokens, u.cache_read, true, '[anthropic-sse]')
);
```
`executeZai` routes anthropic requests to `ZAI_ANTHROPIC_BASE_URL` which returns **Anthropic Messages SSE** (`message_start / content_block_delta / message_delta / message_stop`). But `openaiSSEToAnthropicSSE` reads `choices[0].delta`, absent in Anthropic SSE, so content = empty, usage = 0. The `'[anthropic-sse]'` literal is also logged as response_body instead of real stream text.

- **`src/proxy/zai.ts:262-271`**, non-stream anthropic path calls `aggregateOpenAISSE` which also reads `choices[0].delta` → empty content + 0 tokens.

**Fix (stream):** Replace `openaiSSEToAnthropicSSE(...)` with `pipeWithUsage(resp, 'anthropic', ...)`, `pipeWithUsage` already accepts `format: 'anthropic'` and calls `extractUsageFromSSEStream(tail, text, 'anthropic', ...)` which reads `input_tokens`/`output_tokens` from `message_delta`. The `raw` arg to `recordUsage` becomes the real tail snapshot instead of the literal.

**Fix (non-stream):** Replace `aggregateOpenAISSE(resp)` (OpenAI parser) with a direct Anthropic JSON parse. Z.AI's Anthropic non-stream endpoint returns a standard Anthropic Messages JSON response, parse `resp.json()` directly and extract `usage.input_tokens` / `usage.output_tokens`. Then return `c.json(body)` for anthropic clients and `c.json(responseOpenAIToAnthropic(aggregated))`, wait, client is already anthropic so return as-is, OR convert with `responseAnthropicToOpenAI` if client is openai. But in the non-stream branch of zai.ts lines 262-271, `format` can be either, the branch guard is only `body.stream === true` above. The anthropic non-stream case enters the same `aggregateOpenAISSE` path as openai non-stream. Fix: add a guard for `format === 'anthropic'` before calling `aggregateOpenAISSE`.

---

## Task 1: GAP A: Fix Pioneer cost model key

### Step 1.1: Write failing test

Create `src/proxy/pioneer.cost.test.ts`:

```ts
// src/proxy/pioneer.cost.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('handlePioneerProxy — cost accounting', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'pio-')), 't.db');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records non-zero cost when pricing is keyed by upstream model (pioneer/<model>)', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { upsertModel } = await import('../db/repos/models.js');
    const { insertRequestLogDeferred } = await import('../db/repos/requestLogs.js');
    const { handlePioneerProxy } = await import('./pioneer.js');
    const db = openDb();

    createAccount(db, {
      id: 'acc_pio1',
      label: 'pio',
      credit_type: 'token-plan',
      api_key: 'pk_test',
      base_url: 'https://api.pioneer.app',
      provider: 'pioneer',
      enabled: true,
    });

    // Pricing keyed by the DB upstream model name (pioneer/<bare>).
    upsertModel(db, {
      name: 'pioneer/claude-opus-4-8',
      provider: 'pioneer',
      upstream_model: 'pioneer/claude-opus-4-8',
      enabled: true,
      pricing_input: 15,   // $15/M input tokens
      pricing_output: 75,  // $75/M output tokens
    });

    // Upstream returns a minimal OpenAI SSE stream with 10 prompt + 5 completion tokens.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }) + '\n\n' +
        'data: ' + JSON.stringify({
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }) + '\n\n' +
        'data: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    );

    const logged: Array<{ model: string; costUsd: number }> = [];
    vi.spyOn(await import('../db/repos/requestLogs.js'), 'insertRequestLogDeferred')
      .mockImplementation((_db, row) => {
        logged.push({ model: row.model as string, costUsd: row.costUsd as number });
      });

    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) =>
        k === 'clientKey' ? { id: 'ck1' } : k === 'startTime' ? Date.now() : undefined,
      set: () => {},
      json: (obj: unknown, status?: number) =>
        new Response(JSON.stringify(obj), { status: status ?? 200 }),
      body: (b: BodyInit, status?: number, h?: Record<string, string>) =>
        new Response(b, { status, headers: h }),
    } as unknown as Parameters<typeof handlePioneerProxy>[0];

    const resp = await handlePioneerProxy(
      c,
      'openai',
      '/v1/chat/completions',
      {
        model: 'pio/claude-opus-4-8',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      },
      db,
      { value: 0 },
      new Map()
    );
    // Consume the stream so the onUsage callback fires.
    await resp.text();

    expect(logged.length).toBeGreaterThan(0);
    const row = logged[logged.length - 1];
    // model column must be the upstream model key, not the alias
    expect(row.model).toBe('pioneer/claude-opus-4-8');
    // cost must be non-zero: (10/1_000_000)*15 + (5/1_000_000)*75 = 0.000525
    expect(row.costUsd).toBeGreaterThan(0);
  });
});
```

### Step 1.2: Run, confirm RED

```bash
npx vitest run src/proxy/pioneer.cost.test.ts -t "cost"
```

Expected failure: `expect(row.model).toBe('pioneer/claude-opus-4-8')` fails (actual: `'pio/claude-opus-4-8'`) AND `expect(row.costUsd).toBeGreaterThan(0)` fails (actual: `0`).

### Step 1.3: Implement fix in `src/proxy/pioneer.ts`

**Change 1:** Add `pricingModel` variable capturing the full DB key before stripping (lines 66-75). Replace the current block:

```ts
// BEFORE (lines 66-75)
  let requestedModel: string | null = null;
  let upstreamModel: string | undefined;
  try {
    const resolved = resolveModel(db, model, body);
    requestedModel = resolved.requestedModel;
    const raw = resolved.upstreamModel;
    upstreamModel = raw.startsWith('pioneer/') ? raw.slice('pioneer/'.length) : raw;
  } catch {
    /* leave placeholders null — preparePioneerBody will fall back to prefix-strip */
  }
```

```ts
// AFTER
  let requestedModel: string | null = null;
  let upstreamModel: string | undefined;
  // pricingModel = DB key for calculateCost (e.g. "pioneer/claude-opus-4-8").
  // upstreamModel = bare id sent to Pioneer API (e.g. "claude-opus-4-8").
  let pricingModel: string = model;
  try {
    const resolved = resolveModel(db, model, body);
    requestedModel = resolved.requestedModel;
    pricingModel = resolved.upstreamModel; // DB key, used for cost lookup
    const raw = resolved.upstreamModel;
    upstreamModel = raw.startsWith('pioneer/') ? raw.slice('pioneer/'.length) : raw;
  } catch {
    /* leave placeholders null — preparePioneerBody will fall back to prefix-strip */
  }
```

**Change 2:** In `logCtxBase` (line 160), change `model: model` → `model: pricingModel`:

```ts
// BEFORE (line 160)
        model,
```

```ts
// AFTER
        model: pricingModel,
```

**Change 3:** In `recordUsage` (line 232), change `calculateCost(db, model, ...)` → `calculateCost(db, pricingModel, ...)`:

```ts
// BEFORE (line 232)
      const cost = calculateCost(db, model, {
```

```ts
// AFTER
      const cost = calculateCost(db, pricingModel, {
```

### Step 1.4: Run, confirm GREEN

```bash
npx vitest run src/proxy/pioneer.cost.test.ts -t "cost"
```

Expected: all assertions pass.

### Step 1.5: Commit

```
fix(pioneer): use resolved upstream model key for calculateCost and request log model column

Passing the alias (pio/<model>) to calculateCost always returned 0 because
pricing is keyed by pioneer/<model> in the DB. Introduce pricingModel
capturing resolved.upstreamModel (pre-strip) to fix both the cost lookup
and the request-log model column.
```

---

## Task 2: GAP B: Fix CodeBuddy cost model key

### Step 2.1: Write failing test

Create `src/proxy/codebuddy.cost.test.ts`:

```ts
// src/proxy/codebuddy.cost.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('handleCodeBuddyProxy — cost accounting', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'cb-cost-')), 't.db');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records non-zero cost when pricing is keyed by upstream model (codebuddy/<model>)', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { upsertModel } = await import('../db/repos/models.js');
    const { handleCodeBuddyProxy } = await import('./codebuddy.js');
    const db = openDb();

    createAccount(db, {
      id: 'acc_cb_cost1',
      label: 'cb',
      credit_type: 'token-plan',
      api_key: 'ck_test',
      base_url: 'https://www.codebuddy.ai',
      provider: 'codebuddy',
      enabled: true,
    });

    // Pricing keyed by the DB upstream model name.
    upsertModel(db, {
      name: 'codebuddy/claude-opus-4.6',
      provider: 'codebuddy',
      upstream_model: 'codebuddy/claude-opus-4.6',
      enabled: true,
      pricing_input: 15,
      pricing_output: 75,
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }) + '\n\n' +
        'data: ' + JSON.stringify({
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }) + '\n\n' +
        'data: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    );

    const logged: Array<{ model: string; costUsd: number }> = [];
    vi.spyOn(await import('../db/repos/requestLogs.js'), 'insertRequestLogDeferred')
      .mockImplementation((_db, row) => {
        logged.push({ model: row.model as string, costUsd: row.costUsd as number });
      });

    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) =>
        k === 'clientKey' ? { id: 'ck1' } : k === 'startTime' ? Date.now() : undefined,
      set: () => {},
      json: (obj: unknown, status?: number) =>
        new Response(JSON.stringify(obj), { status: status ?? 200 }),
      body: (b: BodyInit, status?: number, h?: Record<string, string>) =>
        new Response(b, { status, headers: h }),
    } as unknown as Parameters<typeof handleCodeBuddyProxy>[0];

    const resp = await handleCodeBuddyProxy(
      c,
      'openai',
      '/v1/chat/completions',
      {
        model: 'cb/claude-opus-4.6',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      },
      db,
      { value: 0 },
      new Map()
    );
    await resp.text();

    expect(logged.length).toBeGreaterThan(0);
    const row = logged[logged.length - 1];
    expect(row.model).toBe('codebuddy/claude-opus-4.6');
    expect(row.costUsd).toBeGreaterThan(0);
  });
});
```

### Step 2.2: Run, confirm RED

```bash
npx vitest run src/proxy/codebuddy.cost.test.ts -t "cost"
```

Expected failure: `expect(row.costUsd).toBeGreaterThan(0)` fails (actual: `0`). The `model` column test may pass already (codebuddy.ts:160 uses `upstreamModel`), but cost is still 0.

### Step 2.3: Implement fix in `src/proxy/codebuddy.ts`

Single line change at line 233:

```ts
// BEFORE (line 233)
      const cost = calculateCost(db, model, {
```

```ts
// AFTER
      const cost = calculateCost(db, upstreamModel, {
```

### Step 2.4: Run, confirm GREEN

```bash
npx vitest run src/proxy/codebuddy.cost.test.ts -t "cost"
```

Expected: all assertions pass.

### Step 2.5: Commit

```
fix(codebuddy): pass resolved upstreamModel to calculateCost instead of alias

calculateCost(db, model, ...) used the raw cb/<model> alias which has no
pricing entry in the DB → cost was always 0. upstreamModel holds the DB key
(codebuddy/<model>) which matches the pricing row.
```

---

## Task 3: GAP C+D: Fix Z.AI anthropic-format SSE parser and log placeholder

### Step 3.1: Write failing test

Create `src/proxy/zai.anthropic.test.ts`:

```ts
// src/proxy/zai.anthropic.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Z.AI anthropic-format clients route to the Anthropic Messages endpoint,
 * which returns Anthropic Messages SSE (message_start / content_block_delta /
 * message_delta / message_stop). The handler must consume that stream with the
 * 'anthropic' parser, NOT the OpenAI parser.
 */
describe('handleZaiProxy — anthropic format', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'zai-')), 't.db');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Minimal Anthropic Messages SSE stream with real content + usage. */
  function makeAnthropicSSE(text: string, inputTokens: number, outputTokens: number): string {
    return [
      `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'glm-5.2', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: inputTokens, output_tokens: 0 } } })}\n\n`,
      `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`,
      `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { input_tokens: inputTokens, output_tokens: outputTokens } })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
    ].join('');
  }

  it('streams non-empty content and non-zero usage when upstream returns Anthropic SSE', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { handleZaiProxy } = await import('./zai.js');
    const db = openDb();

    createAccount(db, {
      id: 'acc_zai1',
      label: 'zai',
      credit_type: 'token-plan',
      api_key: 'zk_test',
      base_url: null,
      provider: 'zai',
      enabled: true,
    });

    const sse = makeAnthropicSSE('PONG', 10, 5);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    );

    const logged: Array<{ promptTokens: number; completionTokens: number; responseBody: string }> = [];
    vi.spyOn(await import('../db/repos/requestLogs.js'), 'insertRequestLogDeferred')
      .mockImplementation((_db, row) => {
        logged.push({
          promptTokens: row.promptTokens as number,
          completionTokens: row.completionTokens as number,
          responseBody: row.responseBody as string,
        });
      });

    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) =>
        k === 'clientKey' ? { id: 'ck1' } : k === 'startTime' ? Date.now() : undefined,
      set: () => {},
      json: (obj: unknown, status?: number) =>
        new Response(JSON.stringify(obj), { status: status ?? 200 }),
      body: (b: BodyInit, status?: number, h?: Record<string, string>) =>
        new Response(b, { status, headers: h }),
    } as unknown as Parameters<typeof handleZaiProxy>[0];

    const resp = await handleZaiProxy(
      c,
      'anthropic',
      '/v1/messages',
      {
        model: 'zai/glm-5.2',
        stream: true,
        max_tokens: 100,
        messages: [{ role: 'user', content: 'ping' }],
      },
      db,
      { value: 0 },
      new Map()
    );

    const body = await resp.text();

    // Content must pass through.
    expect(body).toContain('PONG');

    // Usage callback must have fired with real token counts.
    expect(logged.length).toBeGreaterThan(0);
    const row = logged[logged.length - 1];
    expect(row.promptTokens).toBe(10);
    expect(row.completionTokens).toBe(5);

    // GAP D: responseBody must not be the literal placeholder.
    expect(row.responseBody).not.toBe('[anthropic-sse]');
  });

  it('parses non-stream anthropic response for content and usage', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { handleZaiProxy } = await import('./zai.js');
    const db = openDb();

    createAccount(db, {
      id: 'acc_zai2',
      label: 'zai',
      credit_type: 'token-plan',
      api_key: 'zk_test',
      base_url: null,
      provider: 'zai',
      enabled: true,
    });

    // Z.AI anthropic non-stream endpoint returns an Anthropic Messages JSON.
    const anthropicResponse = {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'glm-5.2',
      content: [{ type: 'text', text: 'PONG' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 8, output_tokens: 4 },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(anthropicResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const logged: Array<{ promptTokens: number; completionTokens: number }> = [];
    vi.spyOn(await import('../db/repos/requestLogs.js'), 'insertRequestLogDeferred')
      .mockImplementation((_db, row) => {
        logged.push({
          promptTokens: row.promptTokens as number,
          completionTokens: row.completionTokens as number,
        });
      });

    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) =>
        k === 'clientKey' ? { id: 'ck1' } : k === 'startTime' ? Date.now() : undefined,
      set: () => {},
      json: (obj: unknown, status?: number) =>
        new Response(JSON.stringify(obj), { status: status ?? 200 }),
      body: (b: BodyInit, status?: number, h?: Record<string, string>) =>
        new Response(b, { status, headers: h }),
    } as unknown as Parameters<typeof handleZaiProxy>[0];

    const resp = await handleZaiProxy(
      c,
      'anthropic',
      '/v1/messages',
      {
        model: 'zai/glm-5.2',
        stream: false,
        max_tokens: 100,
        messages: [{ role: 'user', content: 'ping' }],
      },
      db,
      { value: 0 },
      new Map()
    );

    const body = JSON.parse(await resp.text()) as {
      content?: Array<{ text: string }>;
    };

    // Content must be present.
    expect(body.content?.[0]?.text).toBe('PONG');

    // Usage must be extracted from Anthropic field names.
    expect(logged.length).toBeGreaterThan(0);
    const row = logged[logged.length - 1];
    expect(row.promptTokens).toBe(8);
    expect(row.completionTokens).toBe(4);
  });
});
```

### Step 3.2: Run, confirm RED

```bash
npx vitest run src/proxy/zai.anthropic.test.ts
```

Expected failures:
- Test 1: `expect(body).toContain('PONG')` fails (body is empty SSE because OpenAI parser finds no `choices[0].delta`). `expect(row.promptTokens).toBe(10)` fails (actual: 0). `expect(row.responseBody).not.toBe('[anthropic-sse]')` fails (actual: `'[anthropic-sse]'`).
- Test 2: `expect(body.content?.[0]?.text).toBe('PONG')` fails (content array is empty because `aggregateOpenAISSE` found no `choices[0].delta.content`). `expect(row.promptTokens).toBe(8)` fails (actual: 0).

### Step 3.3: Implement fix in `src/proxy/zai.ts`

**Change 1, streaming anthropic path (lines 245-249):**

```ts
// BEFORE (lines 245-249)
    if (body.stream === true) {
      if (format === 'anthropic') {
        return openaiSSEToAnthropicSSE(resp, upstreamModel ?? model, (u) =>
          recordUsage(u.prompt_tokens, u.completion_tokens, u.cache_read, true, '[anthropic-sse]')
        );
      }
```

```ts
// AFTER
    if (body.stream === true) {
      if (format === 'anthropic') {
        // Upstream returned Anthropic Messages SSE — use the anthropic parser.
        // pipeWithUsage(format='anthropic') extracts input_tokens/output_tokens
        // from message_delta events and passes real tail text to onUsage.
        return pipeWithUsage(resp, 'anthropic', (usage, raw) =>
          recordUsage(
            usage?.prompt_tokens ?? 0,
            usage?.completion_tokens ?? 0,
            usage?.cache_read_tokens ?? 0,
            true,
            raw
          )
        );
      }
```

**Change 2, non-streaming anthropic path (lines 262-271):**

```ts
// BEFORE (lines 261-272)
    const aggregated = await aggregateOpenAISSE(resp);
    const u = aggregated.usage;
    recordUsage(
      u?.prompt_tokens ?? 0,
      u?.completion_tokens ?? 0,
      u?.prompt_tokens_details?.cached_tokens ?? 0,
      false,
      JSON.stringify(aggregated).slice(0, 2000)
    );
    if (format === 'anthropic') return c.json(responseOpenAIToAnthropic(aggregated));
    return c.json(aggregated);
```

```ts
// AFTER
    // Non-stream: Z.AI returns Anthropic Messages JSON for anthropic clients,
    // and OpenAI Chat Completions JSON for openai clients.
    if (format === 'anthropic') {
      // Anthropic Messages JSON: usage fields are input_tokens / output_tokens.
      const anthropicResp = await resp.json() as {
        usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
        [key: string]: unknown;
      };
      const au = anthropicResp.usage ?? {};
      recordUsage(
        au.input_tokens ?? 0,
        au.output_tokens ?? 0,
        au.cache_read_input_tokens ?? 0,
        false,
        JSON.stringify(anthropicResp).slice(0, 2000)
      );
      return c.json(anthropicResp);
    }
    // OpenAI format: upstream also returned OpenAI JSON.
    const aggregated = await aggregateOpenAISSE(resp);
    const u = aggregated.usage;
    recordUsage(
      u?.prompt_tokens ?? 0,
      u?.completion_tokens ?? 0,
      u?.prompt_tokens_details?.cached_tokens ?? 0,
      false,
      JSON.stringify(aggregated).slice(0, 2000)
    );
    return c.json(aggregated);
```

**Note on imports:** The `openaiSSEToAnthropicSSE` import is still used by the anthropic **streaming** branch, wait, after the fix it is no longer used in zai.ts. Check: the `openaiSSEToAnthropicSSE` import at line 21 of `zai.ts` comes from `'../providers/codebuddy/streamConvert.js'`. After the fix, zai.ts no longer calls it. Remove the import (or leave it, TypeScript strict won't error on unused imports by default, but biome lint may flag it). **Remove it** to keep the file clean:

```ts
// BEFORE (lines 19-23 of zai.ts)
import {
  aggregateOpenAISSE,
  openaiSSEToAnthropicSSE,
} from '../providers/codebuddy/streamConvert.js';
```

```ts
// AFTER (keep aggregateOpenAISSE for the openai non-stream path, drop openaiSSEToAnthropicSSE)
import { aggregateOpenAISSE } from '../providers/codebuddy/streamConvert.js';
```

### Step 3.4: Run, confirm GREEN

```bash
npx vitest run src/proxy/zai.anthropic.test.ts
```

Expected: both tests pass.

### Step 3.5: Run full test suite to catch regressions

```bash
npx vitest run
```

All tests must pass before committing.

### Step 3.6: Commit

```
fix(zai): use anthropic SSE parser for anthropic-format requests, fix log placeholder

For format='anthropic' the upstream returns Anthropic Messages SSE/JSON,
not OpenAI format. Replace openaiSSEToAnthropicSSE (reads choices[0].delta)
with pipeWithUsage(format='anthropic') for streaming and a direct Anthropic
JSON parse for non-streaming. Both returned empty content and 0 tokens before.
Also removes the '[anthropic-sse]' literal from the response_body log column.
```

---

## Self-Review

| Gap | Fixed | Test covers failure mode | Commit |
|-----|-------|--------------------------|--------|
| A, Pioneer cost $0 (alias to calculateCost) | Yes, `pricingModel = resolved.upstreamModel` before strip | Yes, pricing row keyed by `pioneer/claude-opus-4-8`, asserts `costUsd > 0` | Task 1.5 |
| A, Pioneer `model` column shows alias | Yes, `logCtxBase` uses `pricingModel` | Yes, asserts `row.model === 'pioneer/claude-opus-4-8'` | Task 1.5 |
| B, CodeBuddy cost $0 (alias to calculateCost) | Yes, `calculateCost(db, upstreamModel, ...)` | Yes, pricing row keyed by `codebuddy/claude-opus-4.6`, asserts `costUsd > 0` | Task 2.5 |
| C, Z.AI anthropic stream empty content + 0 tokens | Yes, `pipeWithUsage(resp, 'anthropic', ...)` | Yes, asserts `body.contains('PONG')`, `promptTokens=10`, `completionTokens=5` | Task 3.6 |
| C, Z.AI anthropic non-stream empty content + 0 tokens | Yes, direct Anthropic JSON parse for `format==='anthropic'` | Yes, asserts `content[0].text='PONG'`, `promptTokens=8`, `completionTokens=4` | Task 3.6 |
| D, Z.AI `'[anthropic-sse]'` placeholder in log | Yes, `pipeWithUsage` passes real `raw` tail snapshot | Yes, asserts `responseBody !== '[anthropic-sse]'` | Task 3.6 |

**Placeholder scan:** No TBD, no "add appropriate X", no stub implementations in any code block above.

**Type consistency:**
- `calculateCost(db: Database.Database, modelName: string, usage: Usage): number`, all call sites pass `string` (verified in `src/providers/pricing.ts:49`).
- `pipeWithUsage(upstream: Response, format: 'openai' | 'anthropic', onUsage: UsageCallback, signal?: AbortSignal)`, `'anthropic'` is a valid literal for the `format` parameter (verified in `src/streaming/pipeWithUsage.ts:16-20`). `UsageCallback = (usage: SSEUsage | null, rawText: string) => void`, `usage?.cache_read_tokens` is the correct field on `SSEUsage` (verified in `src/streaming/extractUsage.ts:5-9`).
- `aggregateOpenAISSE` remains imported and used for the `format === 'openai'` non-stream path, no dead import.
- `openaiSSEToAnthropicSSE` import removed from `zai.ts` after fix, no longer referenced.
