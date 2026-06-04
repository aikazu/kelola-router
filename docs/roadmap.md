# 🗺️ Roadmap

> Newest first. The latest shipped version sits at the top under its version heading.

## Next up

Speculative — these are ideas, not commitments. Edit freely.

- **Response caching** — per-prompt-hash TTL cache for repeat queries
- **Request replay UI** — re-send a logged request with edits from `/admin/usage`
- **Account health dashboard** — latency p50/p95, error rate, last-success per model per account
- **Prometheus `/metrics` endpoint** — scrape-friendly counters and histograms
- **Webhooks for error events** — POST to a configured URL on fatal upstream errors

## v0.15 — 2026-06-04

**Quota phantom-block root cause + schema consolidation.** Cleanup after a dashboard bug where the quota page rendered a duplicate 0% block.
- **Puller skip nameless items.** `model_remains[]` items without `model_name` (upstream occasionally emits these) are dropped at parse time. The frontend cannot group them, so storing them as NULL-model rows would surface as a phantom `general` pair. Three layers of defense: source (puller skips), read (query filters `model_name IS NOT NULL`), data (legacy NULL rows cleaned out).
- **Single migration.** Migrations 002-008 folded into one `001-initial.ts` containing the full final schema. Legacy upgrade stubs (admin-key, drop-users, drop-thinking) and the dead `repos/users.ts` tombstone removed. Fresh-deploy only — existing DBs upgrade in place (the consolidated schema is a superset). `user_version = 1`.
- **Type tightening.** Shared `OpenAIBody` / `AnthropicBody` / `ContentBlock` types in `src/providers/format/messageTypes.ts` reused by `transform.ts`, `cache-injection.ts`, `caveman/index.ts`, `alias.ts`. All 5 functions in `format/transform.ts` now have typed signatures; the `bodyOpenAIToAnthropic` / `bodyAnthropicToOpenAI` / `responseOpenAIToAnthropic` / `responseAnthropicToOpenAI` / `bodyAddsOpenAIStreamUsage` no longer accept or return `any`. Internal `as any` casts inside the function bodies remain (low-risk narrowing deferred to a future plan).
- **Dead field removed.** `schemaVersion: 1` in the seeded `build` setting was an artifact of the old per-step migration system; the real schema version lives in the `user_version` PRAGMA. Reader audit found zero consumers; field removed.
- **Lint debt paid down.** `noExplicitAny` warnings dropped from 19 → 14 (across `format/transform.ts` internals + a few pre-existing `rtk/` and `transport/` instances deferred to a follow-up). `noConfusingVoidType` resolved in `src/api/admin/middleware.ts` by aligning with the `Promise<Response | undefined>` convention already used in `src/auth.ts`.

## v0.14 — 2026-06-04

**Usage all-time range + per-row key copy.**
- **All-time window.** Overview + Usage range selector gains an "all" option; `days=0` means no time clause in `aggregateUsage` (null deltas). Default range dropped to 1 day.
- **Copy full client key.** `GET /api/admin/client-keys/:id/key` returns the full plaintext bearer for a per-row Copy button; the list itself stays masked.

**Quota flow fix + redesign.** The quota page showed "no data" because the puller parsed the wrong upstream shape — and the few fields it did store were semantically swapped.
- **Real shape parsed.** Live MiniMax `token_plan/remains` and `coding_plan/remains` both return nested `{ model_remains: [ { model_name, current_interval_*, current_weekly_*, remains_time, current_*_remaining_percent } ] }`. The old parser read a flat top-level object → every field `undefined` → null snapshots. Rewritten as a single shared parser over both endpoints (token_plan → coding_plan fallback).
- **Semantic swap fixed.** `current_interval_usage_count` is the amount **used**. Code had stored it as `remaining_count`, and stored `total − usage` (the actual remaining) as `used_count`. Now `used_count = usage_count`, `remaining_count = max(0, total − usage)`.
- **Percent + reset stored.** Migration 008 (consolidated into the single `001-initial` schema in v0.15) added `model_name`, `remaining_percent`, `remains_time` to `quota_snapshots`. `general` plan is not count-metered (total 0/0), so `remaining_percent` is the only meaningful signal there.
- **API per-model.** `/api/admin/quota` groups latest snapshots by `(model_name, window_type)` instead of collapsing all models into one row; payload gains `modelName`, `remainingPercent`, `remainsTime`.
- **Page redesign.** Per-model percent bars (general, video) with 5h + weekly windows, gold gradient fill, status dot, `used / total` count detail when metered, and a "resets in 2h 9m" countdown from `remains_time` (new `forwardDuration` helper). Obsidian Gold throughout.

## v0.13 — 2026-06-04

**Hot-path latency.** Cut the work the proxy does on top of raw MiniMax latency, with tracking kept 100% intact. Warm per-request SQLite statement executions dropped from 8 → 5 (measured by `tests/bench/hotpath.bench.test.ts`); router overhead against an instant fake upstream roughly halved.
- **Batched settings read** — `getAllSettings(db)` warms the per-db settings cache in one query instead of ~6 separate `getSetting` lookups.
- **Skip no-op account writes** — the success-path account reset only runs when the account is actually dirty (`backoff_level`/`status`/`rate_limited_until`/`last_error`), not on every request.
- **Throttled lock cleanup** — `clearExpiredModelLocks` runs its `DELETE` at most once per 30s (timestamp advanced only after a successful delete); lock correctness is unaffected since `isModelLockActive` checks expiry inline.
- **Client-key lookup cache** — bearer → `ClientKey` cached per-db with a 5s TTL, invalidated on create/enable/disable/delete.
- **Deferred request-log insert** — the log write moves off the response critical path via `setImmediate`; `flushDeferredLogs()` drains pending inserts (used by tests and graceful shutdown). The row is still written in full.
- **Fast-path passthrough** — when no transform mutates the body (caveman/caching/rtk off, no cross-format conversion, no alias rewrite, no thinking injection), the original raw request text is forwarded upstream instead of re-serializing the parsed body. A `bodyDirty` flag gates this; any mutation falls back to re-stringify.

**Fixes surfaced along the way.**
- `stream_options.include_usage` was never actually injected (the helper returned a new object whose return value was discarded at the call site) — now captured and merged, so OpenAI streaming usage/cost tracking works. This makes the v0.8 "auto-injection" claim true.
- `adminApi` captured a stale db handle at import time and overrode the per-request handle — now reads `c.get('db')` from context.
- `resetDb()` now closes the SQLite handle before nulling it (releases Windows file locks; fixes temp-dir cleanup `EPERM` in the test suite).
- Replaced a stale `MiniMax-M3-thinking` proxy test (that behavior was dropped in v0.11 — everything is adaptive) with an adaptive-thinking-injection test.

See `docs/superpowers/plans/done/2026-06-03-hot-path-latency.md` and `docs/superpowers/specs/done/2026-06-03-hot-path-latency-design.md`.

## v0.12 — 2026-06-03

**Model aliases.** User-defined model-name → upstream-model mapping.
- CRUD via `/admin/aliases` dashboard page + `/api/admin/aliases` JSON API
- In-memory cache with TTL + cache-bust on write
- `requested_model` column on `request_logs` (preserves the alias the client sent)
- `?target=<model>` deep link from the Models page
- `aliasCount` per model surfaced in `/api/admin/models`

**Biome linter.** Single tool, lint+format, replacing the need for ESLint + Prettier.
- `biome.json` at root for `src/`, `tests/`, `scripts/`
- `client/biome.json` for the Preact SPA (`"root": false` nested config)
- `npm run lint` / `npm run lint:fix` in both `package.json` files
- Strict rules downgraded to `warn` for v0.12 baseline; real fixes in v0.13+

**CLAUDE.md polish.** New `### Server modules` map (`caveman/`, `rtk/`, `streaming/`, `transport/`, `scheduler/`, `auth/`, `util/`); `db/repos/` inventory; `dev` command corrected to `concurrently`; Obsidian Gold theme paragraph trimmed.

**README refresh.** `v0.11` → `v0.12` badge; aliases feature added to the feature list; this roadmap linked from the bottom.

## v0.11 — 2026-06-02

**Adaptive thinking.** M3 + docs-listed models default to adaptive thinking. `thinkingEnabled` dropped from `/api/admin/models`; `-thinking` aliases preserved for backwards-compat. See `docs/superpowers/plans/2026-06-02-builtin-models-adaptive-thinking.md`.

**Dashboard SPA rebuild.** Preact + Vite SPA. Obsidian Gold theme (obsidian canvas + single gold accent). Command palette (`⌘K`), keyboard nav (`g` then key), hash-routed pages. `client/dist/` baked into the Docker image. See `docs/superpowers/plans/2026-06-02-dashboard-spa-rebuild*.md`.

**Docker entrypoint fix.** Work on Windows hosts (CRLF + exec bit on `docker-entrypoint.sh`).

## v0.10 — 2026-06-02

**Flow gaps.** Five-phase plan covering CSRF/session/security hardening, proxy pipeline cleanup, backend reliability, UI login + a11y, UI navigation + forms. See `docs/superpowers/plans/2026-06-02-flow-gaps*.md`.

## v0.9 — 2026-05-31

**Foundation.** OpenAI + Anthropic compatibility, multi-account pool with sticky + round-robin selection, prompt caching (cache_control dual breakpoints), RTK + Caveman compression, built-in dashboard, SQLite-WAL, Hono on Node 20+. Six-phase plan: `docs/superpowers/plans/2026-06-01-minimax-router*.md`.
