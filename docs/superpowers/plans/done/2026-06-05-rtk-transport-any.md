# Tighten RTK + Transport `any` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 13 remaining `any` across the RTK filter pipeline, the transport/proxyFetch layer, and their related test files. None of these are in the proxy hot path (the format converters) — they are the request-trimming + SOCKS/undici transport layer.

**Architecture:** Three sub-areas, each independent and testable on its own:
- **RTK filter pipeline** (`src/rtk/index.ts` + `src/rtk/applyFilter.ts`): 4 `any` — one parameter, one `items[]` array, two `catch (e: any)` clauses
- **Transport / proxyFetch** (`src/transport/proxyFetch.ts`): 1 `any` in a `catch` clause
- **Test files** (`src/transport/proxyFetch.test.ts` + `tests/bench/hotpath.bench.test.ts`): 8 `any` from vitest mock-result casts

Each is a small, mechanical tightening. The shared message types from the v0.15 plan (`AnthropicBody` / `OpenAIBody`) cover the RTK `body` parameter; catch clauses become `catch (e: unknown)` with an `instanceof Error` narrowing; test mocks use `Parameters<typeof fetch>` / `Database.Statement` patterns already established in earlier cleanup phases.

**Tech Stack:** TypeScript strict, vitest, biome, undici dispatcher for transport.

**Current verified state** (lint run 2026-06-05):
- 13 `noExplicitAny` warnings across 4 files:
  - `src/rtk/index.ts:6,10,61` (3)
  - `src/rtk/applyFilter.ts:9` (1)
  - `src/transport/proxyFetch.ts:85` (1)
  - `src/transport/proxyFetch.test.ts:18,31,33,46,48` (5)
  - `tests/bench/hotpath.bench.test.ts:34,37,38` (3)
- No production runtime behavior change expected; this is type-only.

---

## Phase A — RTK filter pipeline

### Task A.1: Type `compressMessages` body + items parameters

**Files:**
- Modify: `src/rtk/index.ts:6,10`

- [ ] **Step 1: Read the current state**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
sed -n '1,75p' src/rtk/index.ts
```

- [ ] **Step 2: Update the signature and the `items` local**

In `src/rtk/index.ts`, add an import near the top:
```ts
import type { AnthropicBody, OpenAIBody } from '../providers/format/messageTypes.js';
```

Change the function signature on line 6:
```ts
// before
export function compressMessages(body: any, enabled: boolean): CompressStats | null {
// after
export function compressMessages(body: AnthropicBody | OpenAIBody | null | undefined, enabled: boolean): CompressStats | null {
```

Change line 10:
```ts
// before
const items: any[] | null = Array.isArray(body.messages)
// after
const items: { role?: string; content?: string | unknown[] }[] | null = Array.isArray(body.messages)
```

The local `items` array is iterated to call `safeApply` per-message. The shape the filter pipeline actually reads is `{ role, content: string }` — narrow at the assignment with an explicit shape, or use the shared `AnthropicMessage` / `OpenAIMessage` from `messageTypes.ts`. Pick the smallest type that makes the body of the function typecheck clean.

- [ ] **Step 3: Run tests + typecheck + lint**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
npx vitest run src/rtk
npm run typecheck
npx biome check src/rtk/index.ts
```

Expected: vitest pass (whatever the current count is for the rtk suite), typecheck clean, biome `noExplicitAny` count drops from 3 to 1 (just the `catch (e: any)` on line 61 remains).

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
git add src/rtk/index.ts
git commit -m "refactor(rtk): type compressMessages body + items with shared shapes"
```

---

### Task A.2: Tighten `catch (e: any)` in `compressMessages`

**Files:**
- Modify: `src/rtk/index.ts:61`

- [ ] **Step 1: Read the line**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
sed -n '59,64p' src/rtk/index.ts
```

- [ ] **Step 2: Replace**

```ts
// before
} catch (e: any) {
  console.warn('[RTK] compressMessages error:', e.message);
  return null;
}
// after
} catch (e: unknown) {
  console.warn('[RTK] compressMessages error:', e instanceof Error ? e.message : String(e));
  return null;
}
```

- [ ] **Step 3: Verify + commit**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
npx vitest run src/rtk
npm run typecheck
npx biome check src/rtk/index.ts
git add src/rtk/index.ts
git commit -m "refactor(rtk): narrow catch clause to unknown + Error"
```

Expected: vitest pass, typecheck clean, biome `noExplicitAny` count for `src/rtk/index.ts` drops to 0.

---

### Task A.3: Tighten `catch (err: any)` in `applyFilter`

**Files:**
- Modify: `src/rtk/applyFilter.ts:9`

- [ ] **Step 1: Read the file**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
cat src/rtk/applyFilter.ts
```

- [ ] **Step 2: Replace**

```ts
// before
} catch (err: any) {
  const name = fn.filterName || 'anonymous';
  console.warn(
    `[rtk] warning: filter '${name}' panicked — passing through: ${err?.message || err}`
  );
  return text;
}
// after
} catch (err: unknown) {
  const name = fn.filterName || 'anonymous';
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(
    `[rtk] warning: filter '${name}' panicked — passing through: ${msg}`
  );
  return text;
}
```

- [ ] **Step 3: Verify + commit**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
npx vitest run src/rtk
npm run typecheck
npx biome check src/rtk/applyFilter.ts
git add src/rtk/applyFilter.ts
git commit -m "refactor(rtk): narrow catch clause in safeApply to unknown"
```

Expected: vitest pass, typecheck clean, biome `noExplicitAny` for `applyFilter.ts` drops to 0.

---

## Phase B — Transport / proxyFetch

### Task B.1: Tighten `catch (e: any)` in `proxyFetch`

**Files:**
- Modify: `src/transport/proxyFetch.ts:85`

- [ ] **Step 1: Read the line**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
sed -n '80,92p' src/transport/proxyFetch.ts
```

- [ ] **Step 2: Replace**

```ts
// before
} catch (e: any) {
  console.warn(`[transport] proxy failed, falling back to direct: ${e.message}`);
  return globalThis.fetch(targetUrl, options);
}
// after
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.warn(`[transport] proxy failed, falling back to direct: ${msg}`);
  return globalThis.fetch(targetUrl, options);
}
```

- [ ] **Step 3: Verify + commit**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
npx vitest run src/transport
npm run typecheck
npx biome check src/transport/proxyFetch.ts
git add src/transport/proxyFetch.ts
git commit -m "refactor(transport): narrow catch clause in proxyFetch fallback"
```

Expected: vitest pass, typecheck clean, biome `noExplicitAny` for `proxyFetch.ts` drops to 0.

---

## Phase C — Test files

### Task C.1: proxyFetch.test.ts (5 `any`)

**Files:**
- Modify: `src/transport/proxyFetch.test.ts:18,31,33,46,48`

- [ ] **Step 1: Read the file**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
cat src/transport/proxyFetch.test.ts
```

- [ ] **Step 2: Replace each `as any[]` with the typed alternative**

The five `any` are all `spy.mock.calls as any[]` casts. The `mock.calls` array is typed as `Parameters<typeof spy>[]`. Replace:

```ts
// before
const [calledUrl, calledOpts] = (spy.mock.calls as any[])[0];
// after
const [calledUrl, calledOpts] = spy.mock.calls[0]!;
```

Same pattern for lines 31, 46 (full array access). For lines 33, 48 (single call indexing the second arg as `any`):

```ts
// before
expect((call[1] as any).dispatcher).toBeDefined();
// after
expect((call[1] as { dispatcher?: unknown }).dispatcher).toBeDefined();
```

Or with a named type:
```ts
type FetchOpts = RequestInit & { dispatcher?: unknown };
expect((call[1] as FetchOpts).dispatcher).toBeDefined();
```

- [ ] **Step 3: Verify + commit**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
npx vitest run src/transport/proxyFetch.test.ts
npm run typecheck
npx biome check src/transport/proxyFetch.test.ts
git add src/transport/proxyFetch.test.ts
git commit -m "test(transport): drop any in proxyFetch spy assertions"
```

Expected: vitest pass, typecheck clean, biome `noExplicitAny` for this file drops to 0.

---

### Task C.2: hotpath.bench.test.ts (3 `any`)

**Files:**
- Modify: `tests/bench/hotpath.bench.test.ts:34,37,38`

- [ ] **Step 1: Read the relevant block**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
sed -n '28,50p' tests/bench/hotpath.bench.test.ts
```

- [ ] **Step 2: Replace the `any` with the existing pattern from `locks-throttle.test.ts`**

This file uses the same `vi.spyOn(Database.prototype, 'prepare')` mock pattern as `src/accounts/locks-throttle.test.ts` (already typed in the v0.15 plan via commit `8868096`).

```ts
// before
vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (this: any, sql: string) {
  const stmt = realPrepare.call(this, sql);
  if (/account_model_locks/i.test(sql)) {
    const orig = (stmt as any)[m].bind(stmt);
    (stmt as any)[m] = (...args: unknown[]) => {
      hits++;
      return orig(...args);
    };
  }
  return stmt;
});
// after
vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (
  this: Database.Database,
  sql: string
) {
  const stmt = realPrepare.call(this, sql) as Database.Statement & {
    [k: string]: (...args: unknown[]) => unknown;
  };
  if (/account_model_locks/i.test(sql)) {
    const orig = stmt[m].bind(stmt);
    stmt[m] = (...args: unknown[]) => {
      hits++;
      return orig(...args);
    };
  }
  return stmt;
});
```

`Database` is already imported (top of the file). The `m` variable (whichever method is being spied on) is typed as the same key in the new intersected shape.

- [ ] **Step 3: Verify + commit**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
npx vitest run tests/bench/hotpath.bench.test.ts
npm run typecheck
npx biome check tests/bench/hotpath.bench.test.ts
git add tests/bench/hotpath.bench.test.ts
git commit -m "test(bench): drop any in hotpath spy pattern"
```

Expected: vitest pass (bench tests are non-CI by default but still typecheck), typecheck clean, biome `noExplicitAny` for this file drops to 0.

---

## Phase D — Final verify

- [ ] **Step 1: Full sweep**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
npm run typecheck
npx vitest run
(npm run lint >/dev/null 2>&1 && echo "lint exit=0")
```

Expected: typecheck clean, all 353/353 vitest pass, lint exit 0.

- [ ] **Step 2: Confirm `noExplicitAny` count is now 0 across the whole repo**

```bash
cd "C:\Users\iqbal\OneDrive\Documents\Project\kelola-router"
npm run lint 2>&1 | grep -c "noExplicitAny"
```

Expected: 0.

- [ ] **Step 3: NO docker rebuild needed.** This is a type-only refactor; the running container will continue to serve from the v0.15.0 image unchanged. If the user wants a rebuild, do `docker compose build && docker compose up -d` — but that is out of scope for this plan.

---

## Self-Review

**Spec coverage:**
- ✅ Task A.1: `compressMessages` body + items (2 any)
- ✅ Task A.2: `compressMessages` catch (1 any)
- ✅ Task A.3: `applyFilter` catch (1 any)
- ✅ Task B.1: `proxyFetch` catch (1 any)
- ✅ Task C.1: `proxyFetch.test.ts` 5 any
- ✅ Task C.2: `hotpath.bench.test.ts` 3 any

**Type consistency:**
- `AnthropicBody | OpenAIBody` is the union introduced in the v0.15 plan. `compressMessages` consumes the union.
- `Database.Statement` is the type from `better-sqlite3` (already used in `locks-throttle.test.ts` from the v0.15 plan, commit `8868096`). The hotpath bench uses the same pattern.
- `catch (e: unknown) + e instanceof Error ? e.message : String(e)` is the standard pattern used elsewhere in the codebase (e.g., `migrations/index.ts` from the v0.15 plan).

**Placeholder scan:** no "TBD", "add appropriate", or empty code blocks. Every step has a concrete command + expected output.

**Out of scope (deliberately retained):**
- The `[k: string]: unknown` index signatures on response/usage types — needed for forward-compat
- The internal `as` casts in the proxy hot path (format/transform.ts) — handled in the parallel plan `2026-06-05-transform-internals.md`
- Docker rebuild + container restart — user explicitly approved "run docker di akhir semua phase" in the v0.15 plan, and this plan is type-only with no runtime behavior change. Out-of-band.
