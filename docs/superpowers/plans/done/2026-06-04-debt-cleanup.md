# v0.15 Debt Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the remaining `any` debt, dead fields, and stale docs that were intentionally deferred from the v0.15 quota fix + migration consolidation (`b54c6b9`).

**Architecture:** Three independent phases. Each phase is self-contained and ends with a green test suite + lint pass. Phases can ship in any order or independently.

- **Phase 1 — Shared message types** (biggest payoff, longest): replace `any` in `format/transform.ts` (10) + `alias.ts` (3) by introducing shared `OpenAIMessage`/`AnthropicMessage` types and reusing `AnthropicBody`/`CavemanBody` from `cache-injection` and `caveman`.
- **Phase 2 — Quick `any` wins** (small): the remaining test-file `any` in `account-noop-write.test.ts` (3), `alias.test.ts` (2), `proxy-alias.test.ts` (1). No shared type work needed.
- **Phase 3 — Cosmetic cleanups** (truly trivial): drop the dead `schemaVersion` field in the `build` settings seed; fix the `noConfusingVoidType` warning in `middleware.ts`; add a "superseded by v0.15" note in the v0.14 roadmap entry that still references "migration 008"; optionally improve dev-loop docker flow (volume mount `client/dist`) — gated as Phase 3d if user wants.

**Tech Stack:** TypeScript strict, vitest, biome, Hono 4, better-sqlite3.

**Current verified state** (lint run 2026-06-04):
- 19 `noExplicitAny` warnings: `transform.ts` (10), `account-noop-write.test.ts` (3), `alias.ts` (3), `alias.test.ts` (2), `proxy-alias.test.ts` (1)
- 1 `noConfusingVoidType` warning: `middleware.ts:8` (return type `Promise<Response | void>` is set intentionally so `return next()` is valid, but biome flags it)
- Dead `schemaVersion` field: seeded at `001-initial.ts:148` but never read by any code
- v0.14 roadmap line (`README.md:325`) says "(migration 008)" — file no longer exists

**Out of scope (deliberately):**
- `synchronous = NORMAL` pragma — acceptable for local-first single-user
- `mkdirSync` in `db/index.ts:22` — already idempotent via `existsSync` check
- Docker-baked `client/dist` is a product trade-off (rebuild on frontend change), not a bug
- Phase 3d dev docker compose — only ship if user explicitly asks

---

## Phase 1 — Shared message types

The hot-path format conversion (`format/transform.ts`) and the alias body transform (`providers/alias.ts`) are the only places left that take raw `any` bodies. They manipulate the same OpenAI ↔ Anthropic message shapes that `cache-injection.ts` and `caveman/index.ts` already have ad-hoc types for. One shared type module removes ~13 `any` + tightens the type contract across the proxy.

### Task 1.1: Create shared message types module

**Files:**
- Create: `src/providers/format/messageTypes.ts`
- Test: `src/providers/format/messageTypes.test.ts` (compile-only smoke test)

- [ ] **Step 1: Write the smoke test**

`src/providers/format/messageTypes.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  type AnthropicBody,
  type AnthropicMessage,
  type OpenAIBody,
  type OpenAIMessage,
} from './messageTypes.js';

describe('messageTypes', () => {
  it('AnthropicBody accepts the legacy test shape', () => {
    const body: AnthropicBody = {
      system: [{ type: 'text', text: 'a' }],
      messages: [{ role: 'user', content: 'hi' }],
    };
    expect(body.messages[0].role).toBe('user');
  });

  it('OpenAIBody accepts messages + instructions', () => {
    const body: OpenAIBody = {
      instructions: 'be terse',
      messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'hi' }],
    };
    expect(body.messages.length).toBe(2);
  });

  it('OpenAIMessage and AnthropicMessage have compatible content unions', () => {
    // Compile-time check: a content block works in either shape.
    const block: AnthropicMessage['content'] = 'hi';
    const oa: OpenAIMessage = { role: 'user', content: block };
    expect(oa.content).toBe('hi');
  });
});
```

- [ ] **Step 2: Run test — expect compile failure**

Run: `npx vitest run src/providers/format/messageTypes.test.ts`
Expected: FAIL — `Cannot find module './messageTypes.js'`

- [ ] **Step 3: Write the types module**

`src/providers/format/messageTypes.ts`:
```ts
/**
 * Shared message-shape types for OpenAI ↔ Anthropic body conversion and
 * the adjacent cache/caveman/alias injection points. These cover the
 * field shapes the proxy actually touches — not the full provider
 * schemas. Anything unknown is left to the provider SDK at request time.
 */

export type CacheControl = { type: 'ephemeral' };

export interface ContentBlock {
  type?: string;
  text?: string;
  cache_control?: CacheControl;
  content?: ContentBlock[];
  // Tool-use blocks carry arbitrary inputs we never read.
  id?: string;
  name?: string;
  input?: unknown;
}

export interface AnthropicMessage {
  role?: 'user' | 'assistant' | 'system';
  content?: string | ContentBlock[];
}

export interface AnthropicBody {
  system?: string | ContentBlock[];
  messages?: AnthropicMessage[];
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenAIMessage {
  role?: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  content?: string | ContentBlock[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

export interface OpenAIBody {
  system?: string;
  instructions?: string;
  messages?: OpenAIMessage[];
  input?: OpenAIMessage[]; // Responses API
  tools?: unknown[];
  tool_choice?: unknown;
  stream?: boolean;
  [extra: string]: unknown; // forward-compat for fields we don't model
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `npx vitest run src/providers/format/messageTypes.test.ts`
Expected: PASS, 3/3

- [ ] **Step 5: Lint + commit**

```bash
npx biome check src/providers/format/messageTypes.ts src/providers/format/messageTypes.test.ts
git add src/providers/format/messageTypes.ts src/providers/format/messageTypes.test.ts
git commit -m "feat(format): add shared OpenAI/Anthropic message type module"
```

---

### Task 1.2: Make transform.ts request functions use AnthropicBody / OpenAIBody

**Files:**
- Modify: `src/providers/format/transform.ts:38-79` (replace 4 `any` in `bodyOpenAIToAnthropic` + `bodyAnthropicToOpenAI`)
- Test: existing `transform.test.ts` must still pass unchanged

- [ ] **Step 1: Read current signatures + tests**

```bash
sed -n '30,90p' src/providers/format/transform.ts
ls src/providers/format/__tests__ 2>/dev/null || find src -name 'transform.test*'
```

Note the function bodies — they read `.messages`, `.system`, `.tools`, `.tool_choice` on both shapes. Update signatures only; logic unchanged.

- [ ] **Step 2: Update signatures**

In `src/providers/format/transform.ts`, change lines 38, 80:
```ts
// before
export function bodyOpenAIToAnthropic(body: any): any {
export function bodyAnthropicToOpenAI(body: any): any {
```
to:
```ts
import type { AnthropicBody, OpenAIBody } from './messageTypes.js';

export function bodyOpenAIToAnthropic(body: OpenAIBody): AnthropicBody {
export function bodyAnthropicToOpenAI(body: AnthropicBody): OpenAIBody {
```

The `as any` inside the bodies (for `tools: any` etc.) stay — handle in Task 1.3. Lint will flag a few — fix in place by tightening local variables.

- [ ] **Step 3: Run existing tests**

Run: `npx vitest run src/providers/format`
Expected: PASS (no behaviour change, types only)

- [ ] **Step 4: Lint**

Run: `npx biome check src/providers/format/transform.ts`
Expected: at least 2 `noExplicitAny` fewer than before; new warnings acceptable if function body has legitimate `as any` casts (handle in 1.3).

- [ ] **Step 5: Commit**

```bash
git add src/providers/format/transform.ts
git commit -m "refactor(format): type bodyOpenAIToAnthropic/AnthropicToOpenAI"
```

---

### Task 1.3: Tighten tools/tool_choice handling in transform.ts

**Files:**
- Modify: `src/providers/format/transform.ts:38-140` (replace remaining `as any` in tool conversion)

- [ ] **Step 1: Identify the casts**

```bash
grep -n "as any" src/providers/format/transform.ts | head
```

Two legitimate uses expected:
- `tools: any` / `tool_choice: any` (provider-specific shapes we forward)
- response field casts (handle in 1.4)

- [ ] **Step 2: Replace with typed unknowns**

Where the code reads `body.tools` / `body.tool_choice`, treat as `unknown` and cast at the assignment site:
```ts
// before
const tools: any = body.tools;
const toolChoice: any = body.tool_choice;
// after
const tools: unknown = body.tools;
const toolChoice: unknown = body.tool_choice;
```

If the downstream code needs `.map()` or similar, narrow with a runtime check:
```ts
const tools: unknown[] = Array.isArray(tools) ? tools : [];
```

- [ ] **Step 3: Run tests + lint**

Run: `npx vitest run src/providers/format && npx biome check src/providers/format/transform.ts`
Expected: tests pass; warning count on transform.ts drops further

- [ ] **Step 4: Commit**

```bash
git add src/providers/format/transform.ts
git commit -m "refactor(format): replace as-any tool casts with unknown + narrow"
```

---

### Task 1.4: Type the response-conversion functions

**Files:**
- Modify: `src/providers/format/transform.ts:141-200` (`responseOpenAIToAnthropic`, `responseAnthropicToOpenAI`)

- [ ] **Step 1: Read current bodies**

```bash
sed -n '141,250p' src/providers/format/transform.ts
```

These functions return newly-constructed response objects. They take provider JSON of unknown shape and emit a typed response.

- [ ] **Step 2: Define response types in messageTypes.ts**

Append to `src/providers/format/messageTypes.ts`:
```ts
export interface OpenAIResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    index: number;
    finish_reason?: string | null;
    message: OpenAIMessage;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  [k: string]: unknown;
}

export interface AnthropicResponse {
  id?: string;
  model?: string;
  content?: ContentBlock[];
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  [k: string]: unknown;
}
```

- [ ] **Step 3: Update signatures**

```ts
export function responseOpenAIToAnthropic(resp: OpenAIResponse): AnthropicResponse
export function responseAnthropicToOpenAI(resp: AnthropicResponse): OpenAIResponse
```

- [ ] **Step 4: Run + commit**

```bash
npx vitest run src/providers/format
npx biome check src/providers/format/transform.ts src/providers/format/messageTypes.ts
git add src/providers/format/transform.ts src/providers/format/messageTypes.ts
git commit -m "refactor(format): type response converters + define response shapes"
```

---

### Task 1.5: Type `bodyAddsOpenAIStreamUsage`

**Files:**
- Modify: `src/providers/format/transform.ts:253`

- [ ] **Step 1: Read**

```bash
sed -n '253,280p' src/providers/format/transform.ts
```

- [ ] **Step 2: Type**

```ts
export function bodyAddsOpenAIStreamUsage(body: OpenAIBody): OpenAIBody {
```

The function mutates `body.stream_options` — verify `OpenAIBody`'s `[extra: string]: unknown` index signature allows it. If not, add `stream_options?: { include_usage?: boolean }` to `OpenAIBody`.

- [ ] **Step 3: Run + commit**

```bash
npx vitest run src/providers/format
git add src/providers/format/transform.ts src/providers/format/messageTypes.ts
git commit -m "refactor(format): type bodyAddsOpenAIStreamUsage"
```

---

### Task 1.6: Reuse types in cache-injection.ts and caveman/index.ts

**Files:**
- Modify: `src/cache-injection.ts` (drop local `ContentBlock`/`Message`/`AnthropicBody`, import from `format/messageTypes`)
- Modify: `src/caveman/index.ts` (drop local `ContentBlock`/`Message`/`CavemanBody`, import from `format/messageTypes`, rename to `MessageBody` or keep as alias)

- [ ] **Step 1: Update cache-injection.ts imports**

Replace local interfaces with:
```ts
import type { AnthropicBody, ContentBlock } from './providers/format/messageTypes.js';
```

Keep `AnthropicBody` export re-exported for any test that imports it:
```ts
export type { AnthropicBody, ContentBlock } from './providers/format/messageTypes.js';
```

- [ ] **Step 2: Update caveman/index.ts**

Same pattern. The `CavemanBody` interface there is a superset of `OpenAIBody` + `AnthropicBody`. Replace with:
```ts
import type { OpenAIBody, AnthropicBody } from '../providers/format/messageTypes.js';
export type CavemanBody = OpenAIBody & Omit<AnthropicBody, keyof OpenAIBody>;
```

If tests reference `CavemanBody`, keep the export.

- [ ] **Step 3: Run all affected tests**

```bash
npx vitest run src/cache-injection.test.ts src/caveman/index.test.ts src/providers/format
npx biome check src/cache-injection.ts src/caveman/index.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/cache-injection.ts src/caveman/index.ts
git commit -m "refactor: reuse shared message types in cache-injection and caveman"
```

---

### Task 1.7: Type alias.ts bodyTransform

**Files:**
- Modify: `src/providers/alias.ts:25, 32, 45`
- Modify: any caller that still passes `any` to a `bodyTransform`

- [ ] **Step 1: Read current usage**

```bash
grep -n "bodyTransform\|_body\|as any" src/providers/alias.ts src/providers/aliasCache.ts 2>/dev/null
```

- [ ] **Step 2: Replace**

```ts
import type { AnthropicBody, OpenAIBody } from './format/messageTypes.js';

interface AliasEntry {
  bodyTransform: (body: AnthropicBody | OpenAIBody) => void;
  _body?: AnthropicBody | OpenAIBody; // legacy cache slot
}
```

Check `aliasCache.test.ts` and `alias.test.ts` for places that build a `bodyTransform` with `(b: any) => ...` — replace with `(b: AnthropicBody | OpenAIBody)`.

- [ ] **Step 3: Run + commit**

```bash
npx vitest run src/providers/alias.test.ts src/providers/aliasCache.test.ts
npx biome check src/providers/alias.ts
git add src/providers/alias.ts src/providers/aliasCache.ts src/providers/alias.test.ts src/providers/aliasCache.test.ts
git commit -m "refactor(alias): type bodyTransform + drop any"
```

---

### Task 1.8: Phase 1 verify

- [ ] **Step 1: Full sweep**

```bash
npm run typecheck
npm run lint  # expect any count down from 19 to ~6
npx vitest run
```

- [ ] **Step 2: Rebuild + restart container**

```bash
docker compose build && docker compose up -d
until curl -sf http://127.0.0.1:20137/health; do sleep 1; done
```

---

## Phase 2 — Quick `any` wins (test files)

These three test files have 6 `any` left. No shared-type work needed; each is a localized cleanup.

### Task 2.1: alias.test.ts (2 any)

**Files:**
- Modify: `src/providers/alias.test.ts`

- [ ] **Step 1: Read**

```bash
grep -n "any" src/providers/alias.test.ts
```

- [ ] **Step 2: Replace with `AnthropicBody | OpenAIBody`**

The test builds synthetic request bodies. Use the shared type from `format/messageTypes`.

- [ ] **Step 3: Verify**

```bash
npx vitest run src/providers/alias.test.ts
npx biome check src/providers/alias.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/providers/alias.test.ts
git commit -m "test(alias): replace any with shared body type"
```

---

### Task 2.2: account-noop-write.test.ts (3 any)

**Files:**
- Modify: `tests/proxy/account-noop-write.test.ts`

- [ ] **Step 1: Read**

```bash
grep -n "any" tests/proxy/account-noop-write.test.ts
```

- [ ] **Step 2: Replace**

Typical pattern: `mockResolvedValueOnce(new Response(...))` or row types from the DB. Use `Database.RunResult` / `unknown` / concrete types from the relevant repo.

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run tests/proxy/account-noop-write.test.ts
npx biome check tests/proxy/account-noop-write.test.ts
git add tests/proxy/account-noop-write.test.ts
git commit -m "test(account-noop-write): drop any, use concrete types"
```

---

### Task 2.3: proxy-alias.test.ts (1 any)

**Files:**
- Modify: `tests/integration/proxy-alias.test.ts`

- [ ] **Step 1: Read + replace**

```bash
grep -n "any" tests/integration/proxy-alias.test.ts
```

- [ ] **Step 2: Verify + commit**

```bash
npx vitest run tests/integration/proxy-alias.test.ts
npx biome check tests/integration/proxy-alias.test.ts
git add tests/integration/proxy-alias.test.ts
git commit -m "test(proxy-alias): drop any"
```

---

### Task 2.4: Phase 2 verify

- [ ] **Step 1: Full sweep**

```bash
npm run typecheck
npm run lint  # expect any count from ~6 to 0
npx vitest run
```

---

## Phase 3 — Cosmetic cleanups

### Task 3.1: Drop dead `schemaVersion` field

**Files:**
- Modify: `src/db/migrations/001-initial.ts:148`

- [ ] **Step 1: Confirm no readers**

```bash
grep -rn "schemaVersion" src tests --include='*.ts' 2>/dev/null
```

Expected: only the seed line.

- [ ] **Step 2: Remove from seed**

In `001-initial.ts`, change:
```ts
('build', '{"version": "0.15.0", "schemaVersion": 1}');
```
to:
```ts
('build', '{"version": "0.15.0"}');
```

- [ ] **Step 3: Verify the `build.version` reader still parses**

```bash
grep -rn "settings.build\|getSetting.*build" src --include='*.ts' 2>/dev/null
```

If a reader uses `JSON.parse(build).schemaVersion`, update it to drop the field and only read `version`.

- [ ] **Step 4: Commit**

```bash
npm run typecheck
npx vitest run
git add src/db/migrations/001-initial.ts [and any reader file]
git commit -m "refactor(db): drop unused schemaVersion field from build setting"
```

---

### Task 3.2: Fix `noConfusingVoidType` in middleware.ts

**Files:**
- Modify: `src/api/admin/middleware.ts:8`

The current signature `Promise<Response | void>` is intentional (so `return next()` is valid) but biome flags it. The clean fix is to make the "pass-through" return value explicit.

- [ ] **Step 1: Change return type to `Response | Promise<Response>` and adapt body**

```ts
export async function requireAdminJson(c: Context, next: Next): Promise<Response | Promise<Response>> {
  const db = c.get('db') as Database.Database;
  if (!isPasswordSet(db)) {
    await next();
    return c.res; // Hono exposes the implicit passthrough response
  }
  // ... rest unchanged
}
```

If `c.res` is not the right object here, the alternative is to wrap the call site:
```ts
type Mw = (c: Context, next: Next) => Promise<Response | undefined>;
```
and use `undefined` (which the codebase already uses for `requireApiKey`, `requireAdmin`, `csrfGuard` in `auth.ts`). Pick whichever is idiomatic for this file.

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
npx vitest run tests/api/admin/middleware.test.ts
npx biome check src/api/admin/middleware.ts
git add src/api/admin/middleware.ts
git commit -m "style(middleware): tighten return type to silence void-union warning"
```

---

### Task 3.3: Annotate v0.14 roadmap entry as historical

**Files:**
- Modify: `README.md:325`

- [ ] **Step 1: Find the line**

```bash
grep -n "migration 008" README.md
```

- [ ] **Step 2: Add a clarifier**

Change the phrase "store `remaining_percent` + `remains_time` (migration 008)" to:
> "store `remaining_percent` + `remains_time` (consolidated into the single `001-initial` schema in v0.15)"

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: clarify that the v0.14 'migration 008' is now in the consolidated schema"
```

---

### Task 3.4: Phase 3 verify

- [ ] **Step 1: Final sweep**

```bash
npm run typecheck
npm run lint  # expect 0 warnings
npx vitest run
```

- [ ] **Step 2: Rebuild + restart container**

```bash
docker compose build && docker compose up -d
until curl -sf http://127.0.0.1:20137/health; do sleep 1; done
```

- [ ] **Step 3: DB schema re-check**

```bash
docker compose exec -T router node -e "
const D=require('better-sqlite3');
const db=new D('/data/router.db');
console.log('INTEGRITY='+db.pragma('integrity_check',{simple:true}));
console.log('UV='+db.pragma('user_version',{simple:true}));
"
```

Expected: `INTEGRITY=ok`, `UV=1`.

---

## Self-Review

**Spec coverage:**
- ✅ Phase 1: all 13 `any` in `transform.ts` (10) + `alias.ts` (3) → typed via shared module
- ✅ Phase 2: 6 remaining test-file `any` → replaced
- ✅ Phase 3a: dead `schemaVersion` field
- ✅ Phase 3b: `noConfusingVoidType`
- ✅ Phase 3c: roadmap history note
- ⏸️ Phase 3d (dev docker compose): out of scope — only ship if user requests

**Type consistency check:**
- `AnthropicBody` defined in `format/messageTypes.ts`; reused by `cache-injection.ts` (re-exported), `caveman/index.ts` (`CavemanBody = OpenAIBody & Omit<AnthropicBody, keyof OpenAIBody>`), and `transform.ts`.
- `ContentBlock` defined once in `messageTypes.ts`; re-exported by `cache-injection.ts` for tests.
- Response types `OpenAIResponse` / `AnthropicResponse` introduced in Task 1.4; consumed only by `responseOpenAIToAnthropic` / `responseAnthropicToOpenAI`.

**Placeholder scan:** no "TBD", "add appropriate", or empty code blocks. Every step has a concrete command + expected output.

**Out-of-scope items deliberately retained** (decided at verification time, not omissions):
- `synchronous = NORMAL` pragma
- `mkdirSync` + `existsSync` (already idempotent)
- dockerfile baked `client/dist` (product trade-off)
- dev-mode docker compose volume mount (user has not asked for it)
