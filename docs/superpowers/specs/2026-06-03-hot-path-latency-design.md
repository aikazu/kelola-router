# Hot-Path Latency Optimization — Design

**Date:** 2026-06-03
**Status:** Approved (design)
**Goal:** Reduce per-request latency the router adds on top of raw MiniMax latency, so the proxy feels close to "direct, no router" — while keeping request tracking 100% intact.

## Problem

The user reports the router feels noticeably slower than calling MiniMax directly, but tracking (cost, tokens, latency, account, bodies) is essential and must stay. So latency is the cost we pay for tracking; the job is to shrink that cost without losing any tracking.

### Measured hot-path cost (per request, single-account steady state)

Inside `handleProxy` (`src/server.ts`) plus middleware, a single proxied request currently does roughly:

- `getSetting` ×6 — `caveman`, `caching`, `rtk`, `minimax` (twice: handleProxy + `resolveModel`), `transport`. Each is a separate SQLite query on cache miss; each `db.prepare()` re-parses SQL.
- `listEnabledAccounts` ×1 — `SELECT *` then `.map()` to AccountState then `.find()` again.
- `resolveAlias` (cached 30s, fine) + `getModel` ×1.
- `clearExpiredModelLocks` ×1 — a `DELETE` **every** request.
- `getModelLock` ×1.
- `requireApiKey` → `getClientKeyByKey` ×1 — fresh prepare every request.
- `updateAccount` ×1 — resets backoff/status on **every success**, a WRITE even when the account is already clean.
- `insertRequestLog` ×1 — large write (request/response bodies, headers) executed **synchronously before returning the response** on the non-stream path.

~13 SQLite ops/request, several of them writes, none using cached prepared statements, plus full `JSON.parse` + `JSON.stringify` of the body even when no transform is needed.

## Non-goals / Anti-regression guarantees

- **No change to observable behavior.** Tracking stays 100% complete; responses stay byte-for-byte identical; status codes, error mapping, account state machine, backoff, model locks unchanged.
- **No API, route, request/response format, or DB schema change.**
- **Strict TDD.** Each optimization: red test proving old behavior holds → optimization → full suite green. Commit per step (~≤300 LOC).
- **Baseline benchmark** before and after, as evidence of "faster, no regression".

## Approach: targeted hot-path optimization (chosen)

Rejected alternatives: (B) measure-first only — user asked to follow recommendation; (C) full hot-path rewrite with async tracking queue — highest regression risk, user explicitly wants no regression.

### Step 0 — Baseline benchmark harness

A small test/script that drives `handleProxy` against a faked upstream (`vi.spyOn(globalThis,'fetch')`) and measures:
- number of SQLite statements executed per request (instrument via a counting wrapper or `better-sqlite3` prepare/run hooks),
- wall-clock router overhead excluding upstream (fake upstream returns instantly).

Record numbers before changes; re-run at the end. Lives under `tests/` or `bench/`. Not a correctness gate — an evidence artifact.

### Step 1 — Prepared-statement cache — DROPPED

Original idea: a `prep(db, sql)` cache to avoid re-parsing SQL. Investigation showed `better-sqlite3` already maintains an internal LRU cache of prepared statements keyed by SQL string (default size 100), so repeated `db.prepare(sameSql)` is already cheap. Adding our own cache duplicates existing behavior for no measurable gain. **Dropped — not implemented.**

### Step 2 — Batch settings read

Add `getAllSettings(db)` — one `SELECT key, value FROM settings` that populates the per-db settings cache for all keys at once (same 1s TTL). `handleProxy` calls it once up front; subsequent `getSetting` calls hit the warm cache. `getSetting` keeps its current signature and fallback. Reduces 6 queries → 1 on cold cache; behavior identical.

### Step 3 — Skip no-op success write

Today every successful request calls `updateAccount(db, id, { reset... })`. Change: only write when the account is actually dirty —
`acc.backoff_level !== 0 || acc.status !== 'active' || acc.rate_limited_until !== null`.
A clean account performs zero writes. State machine outcome identical (a clean account reset to clean is a no-op).

### Step 4 — Throttle expired-lock cleanup

`clearExpiredModelLocks` runs a `DELETE` every request. Guard it with a module-level last-run timestamp so it runs at most once per 30s. Correctness preserved: `isModelLockActive` checks `locked_until` expiry inline, so a not-yet-deleted expired lock is still treated as inactive. Cleanup is pure housekeeping.

### Step 5 — Client-key lookup cache

`requireApiKey` hits `getClientKeyByKey` every request. Add a short-TTL (≈5s) per-db cache `Map<bearer, ClientKey>`. Invalidate on client-key disable/delete (call a `clearClientKeyCache()` from those repo mutations). Removes 1 query/request in steady state. Disabled/deleted keys stop working within the TTL window at worst — acceptable for single-user self-host; mutations clear the cache immediately anyway.

### Step 6 — Defer request-log insert

Move `insertRequestLog` off the response-return critical path via `queueMicrotask`/`setImmediate`, so the client receives bytes before the log row is written. The log is still written in full (test asserts the row appears). Provide a small flush/await hook so tests stay deterministic (e.g. expose the pending insert promise, or run inserts synchronously under a test flag). Applies to both stream (already late) and non-stream (currently blocking) paths.

### Step 7 — Fast-path passthrough (skip re-stringify)

When **all** of these hold:
- caveman off, caching `autoBreakpoints` off, rtk off,
- `format === upstreamFormat` (no cross-format conversion),
- `resolveModel`'s `bodyTransform` makes no change (no adaptive-thinking inject, no M3 default max, no reasoning_split),

then forward the **original raw request text** to upstream instead of `JSON.stringify(body)`. Routing still parses the body once for model/stream/lock decisions, but the large body is not re-serialized. Removes a full stringify of large payloads. When any transform is active, behavior is exactly as today.

### Step 8 — Re-run benchmark

Re-run Step 0 harness; record query-count and overhead deltas in the plan/PR notes as evidence.

## Component boundaries

- `src/db/repos/settings.ts` — add `getAllSettings`; reuse existing cache structure.
- `src/db/repos/client_keys.ts` — add lookup cache + `clearClientKeyCache`.
- `src/accounts/locks.ts` — add throttle guard to `clearExpiredModelLocks` (or a wrapper).
- `src/server.ts` — wire batch settings, no-op-write guard, deferred log, fast-path branch.
- `bench/` or `tests/bench/` — baseline harness.

Each unit independently testable; interfaces unchanged for callers.

## Testing

- Unit: `prep()` returns cached stmt for same SQL, fresh for new SQL, isolates per db; `getAllSettings` warms cache; client-key cache returns and invalidates; lock-cleanup throttle respects window; no-op-write guard skips clean accounts and still writes dirty ones.
- Integration (existing suite must stay green): proxy stream + non-stream still log correctly, still convert formats, still map errors/backoff/locks, fast-path produces identical upstream body.
- Benchmark: query-count strictly lower after; overhead lower; zero failing tests.

## Risks

- Deferred logging ordering in tests — mitigated by a deterministic flush hook.
- Client-key cache staleness — bounded by TTL + explicit invalidation on mutation.
- Fast-path must be provably equivalent — gated behind exact "all transforms off" predicate; covered by an equivalence test (same input → same upstream bytes with and without fast-path).
