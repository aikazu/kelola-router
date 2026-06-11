# Tighten `format/transform.ts` Internal `any` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 7 remaining `any` in `src/providers/format/transform.ts` (all inside the body of the two response-conversion functions + their two usage helpers) with concrete types drawn from the existing `messageTypes.ts` module.

**Architecture:** The response converters build Anthropic/OpenAI JSON responses from provider-shaped inputs. The `any` slots are typed collections (`blocks: any[]`, `toolCalls: any[]`), a parsed-JSON input (`let input: any = {}`), and two helper return types (`openAIToAnthropicUsage(u: any): any`, `anthropicToOpenAIUsage(u: any): any`). Each maps cleanly to a small local type that references the shared `ContentBlock` / `OpenAIMessage` / response types added in the v0.15 plan. This is a body-internal change; function signatures stay the same.

**Tech Stack:** TypeScript strict, vitest, biome.

**Current verified state** (lint run 2026-06-05):
- 7 `noExplicitAny` warnings in `src/providers/format/transform.ts`, all at lines 166, 177, 201 (×2: parameter + return), 223, 259 (×2: parameter + return)
- All other `transform.ts` any were already removed in the v0.15 plan (commits `682cd71`, `1631950`, `5096df1`)
- These 7 are the body-internal any that the v0.15 plan §Phase 1.3 explicitly left for follow-up: "The function bodies use `as any` casts internally — those would be fine. Tighten in a follow-up only if a future task requires it."

---

### Task 1: Tighten `blocks: any[]` in `responseOpenAIToAnthropic`

**Files:**
- Modify: `src/providers/format/transform.ts:166`

- [ ] **Step 1: Read the current state**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
sed -n '162,198p' src/providers/format/transform.ts
```

- [ ] **Step 2: Replace the `blocks: any[]` annotation**

At line 166, change:
```ts
const blocks: any[] = [];
```
to:
```ts
const blocks: ContentBlock[] = [];
```

`ContentBlock` is already imported in `transform.ts` (from the v0.15 plan; check the import at the top of the file). If it isn't, add it to the existing `import type` from `'./messageTypes.js'`.

- [ ] **Step 3: Run tests + typecheck + lint**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
npx vitest run src/providers/format
npm run typecheck
npx biome check src/providers/format/transform.ts
```

Expected:
- vitest: 35/35 pass
- typecheck: clean
- biome: `noExplicitAny` count for `transform.ts` drops from 7 to 6

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
git add src/providers/format/transform.ts
git commit -m "refactor(format): type blocks[] in responseOpenAIToAnthropic"
```

---

### Task 2: Tighten `let input: any = {}` (JSON.parse output)

**Files:**
- Modify: `src/providers/format/transform.ts:177`

- [ ] **Step 1: Read the current state**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
sed -n '174,195p' src/providers/format/transform.ts
```

- [ ] **Step 2: Replace the `any` annotation**

At line 177, change:
```ts
let input: any = {};
```
to:
```ts
let input: unknown = {};
```

The downstream `input` is passed to a content block as a property. The downstream usage of `input` reads the value as opaque JSON; if a downstream type is stricter (e.g., it expects a `Record<string, unknown>`), narrow at the assignment site with `as Record<string, unknown>`.

- [ ] **Step 3: Run tests + typecheck + lint**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
npx vitest run src/providers/format
npm run typecheck
npx biome check src/providers/format/transform.ts
```

Expected: vitest 35/35, typecheck clean, biome `noExplicitAny` count drops to 5.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
git add src/providers/format/transform.ts
git commit -m "refactor(format): type parsed tool_use input as unknown"
```

---

### Task 3: Tighten `openAIToAnthropicUsage` signature

**Files:**
- Modify: `src/providers/format/transform.ts:201-210` (function definition)
- Modify: `src/providers/format/transform.ts` (caller at the function `responseOpenAIToAnthropic`)

- [ ] **Step 1: Read the current state**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
sed -n '201,215p' src/providers/format/transform.ts
grep -n "openAIToAnthropicUsage" src/providers/format/transform.ts
```

- [ ] **Step 2: Add the usage input type to `messageTypes.ts`**

Append to `src/providers/format/messageTypes.ts` (after the existing `OpenAIResponse` interface):

```ts
export interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  [k: string]: unknown;
}

export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  [k: string]: unknown;
}
```

- [ ] **Step 3: Update the helper signatures**

In `transform.ts`, update the import to include the new types:
```ts
import type {
  AnthropicBody,
  AnthropicResponse,
  AnthropicUsage,
  OpenAIBody,
  OpenAIResponse,
  OpenAIUsage,
} from './messageTypes.js';
```

Change the helper:
```ts
function openAIToAnthropicUsage(u: OpenAIUsage): AnthropicUsage {
```
The body of the function reads `u.prompt_tokens`, `u.completion_tokens`, `u.cache_creation_input_tokens`, `u.cache_read_input_tokens`. All of these are on `OpenAIUsage`. If typecheck still complains about the return value not matching `AnthropicUsage`, narrow the literal at the `return` site with `as AnthropicUsage` or use the explicit shape.

- [ ] **Step 4: Run tests + typecheck + lint**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
npx vitest run src/providers/format
npm run typecheck
npx biome check src/providers/format/transform.ts src/providers/format/messageTypes.ts
```

Expected: vitest 35/35, typecheck clean, biome `noExplicitAny` count drops to 3 (3 lines down: 201:36, 201:42, and the same line on 259).

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
git add src/providers/format/transform.ts src/providers/format/messageTypes.ts
git commit -m "refactor(format): type openAIToAnthropicUsage with usage shapes"
```

---

### Task 4: Tighten `anthropicToOpenAIUsage` signature

**Files:**
- Modify: `src/providers/format/transform.ts:259-268`

- [ ] **Step 1: Read the current state**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
sed -n '259,272p' src/providers/format/transform.ts
```

- [ ] **Step 2: Update the signature**

Change:
```ts
function anthropicToOpenAIUsage(u: any): any {
```
to:
```ts
function anthropicToOpenAIUsage(u: AnthropicUsage): OpenAIUsage {
```

The function body reads `u.input_tokens`, `u.output_tokens`, `u.cache_creation_input_tokens`, `u.cache_read_input_tokens` and maps them to the OpenAI shape. All source fields are on `AnthropicUsage`. The literal return value is a plain object — narrow with `as OpenAIUsage` if needed for the return.

- [ ] **Step 3: Run tests + typecheck + lint**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
npx vitest run src/providers/format
npm run typecheck
npx biome check src/providers/format/transform.ts
```

Expected: vitest 35/35, typecheck clean, biome `noExplicitAny` count for `transform.ts` drops to 1 (only line 223: `const toolCalls: any[] = [];` remains).

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
git add src/providers/format/transform.ts
git commit -m "refactor(format): type anthropicToOpenAIUsage with usage shapes"
```

---

### Task 5: Tighten `toolCalls: any[]` in `responseAnthropicToOpenAI`

**Files:**
- Modify: `src/providers/format/transform.ts:223`

- [ ] **Step 1: Read the current state**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
sed -n '220,260p' src/providers/format/transform.ts
```

- [ ] **Step 2: Add a `ToolUseBlock` type to `messageTypes.ts`**

Append to `src/providers/format/messageTypes.ts`:

```ts
export interface ToolUseBlock extends ContentBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input?: unknown;
}
```

- [ ] **Step 3: Replace the annotation**

At line 223, change:
```ts
const toolCalls: any[] = [];
```
to:
```ts
const toolCalls: { id: string; type: 'function'; function: { name: string; arguments: string } }[] = [];
```

This is the `OpenAIToolCall` shape already exported from `messageTypes.ts` (added in the v0.15 plan). The cleanest form is:
```ts
import type { OpenAIToolCall } from './messageTypes.js';
// ...
const toolCalls: OpenAIToolCall[] = [];
```

`OpenAIToolCall` is already exported by `messageTypes.ts` (added in the v0.15 plan; verify the import exists in `transform.ts`).

- [ ] **Step 4: Run tests + typecheck + lint**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
npx vitest run src/providers/format
npm run typecheck
npx biome check src/providers/format/transform.ts
```

Expected: vitest 35/35, typecheck clean, biome `noExplicitAny` count for `transform.ts` drops to 0.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
git add src/providers/format/transform.ts src/providers/format/messageTypes.ts
git commit -m "refactor(format): type toolCalls[] in responseAnthropicToOpenAI"
```

---

### Task 6: Final verify

- [ ] **Step 1: Full sweep**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
npm run typecheck
npx vitest run
(npm run lint >/dev/null 2>&1 && echo "lint exit=0")
```

Expected: typecheck clean, all 353/353 vitest pass, lint exit 0.

- [ ] **Step 2: Confirm `transform.ts` is fully clean**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
npx biome check src/providers/format/transform.ts
```

Expected: 0 `noExplicitAny` warnings in `transform.ts`.

- [ ] **Step 3: NO docker rebuild needed** — this is a server-side TypeScript change, the Docker image doesn't need a rebuild for type-only refactors. The running container will continue to serve with the old compiled JS; the type tightening is purely a developer-experience win that lands in the next deploy. (If the user wants a deploy, run `docker compose build && docker compose up -d` — but that is out of scope for this plan.)

---

## Self-Review

**Spec coverage:**
- ✅ Task 1: `blocks: any[]` (line 166) — replaced with `ContentBlock[]`
- ✅ Task 2: `let input: any` (line 177) — replaced with `unknown`
- ✅ Task 3: `openAIToAnthropicUsage` parameter + return (line 201) — typed with `OpenAIUsage` / `AnthropicUsage`
- ✅ Task 4: `anthropicToOpenAIUsage` parameter + return (line 259) — typed with `AnthropicUsage` / `OpenAIUsage`
- ✅ Task 5: `toolCalls: any[]` (line 223) — replaced with `OpenAIToolCall[]`
- ✅ Task 6: full sweep

**Type consistency:**
- `OpenAIUsage` and `AnthropicUsage` are defined in `messageTypes.ts` (Task 3) and consumed by `transform.ts` (Tasks 3 + 4). Same names used in both places.
- `OpenAIToolCall` already exists in `messageTypes.ts` from the v0.15 plan; reused here. No new interface introduced for tool calls.

**Placeholder scan:** no "TBD", "add appropriate", or empty code blocks. Every step has a concrete command + expected output.

**Out of scope (deliberately retained):**
- The `index signature: [k: string]: unknown` on the response/usage types — needed for forward-compat with provider fields the proxy forwards but doesn't model
- The internal `as` casts inside response function bodies (e.g., `out.created as number | undefined`) — these are already typed casts from the v0.15 plan and biome doesn't flag them
- Docker rebuild + container restart — the user explicitly approved "run docker di akhir semua phase" in the v0.15 plan, and this plan is body-internal with no runtime behavior change. A docker rebuild can be done out-of-band.
