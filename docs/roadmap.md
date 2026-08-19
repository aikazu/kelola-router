# 🗺️ Roadmap

> Newest first. The latest shipped version sits at the top under its version heading.

## v0.22.1: 2026-06-21

**Migration consolidation into a single fresh-deploy schema.**
- **Single consolidated migration.** Migrations `002-010` folded into `001-initial.ts`; a fresh install reaches the final schema in one step (`user_version` ends at 1). The migration's SQL is split across `schema.sql.ts` / `indexes.sql.ts` / `seed.sql.ts` (concatenated by `001-initial.ts`) to keep each file readable. No incremental `ALTER` migrations, no data dedup; fresh deploy only. Existing DBs at `user_version = 10` keep working (runner skips; consolidated schema is a superset).
- **`CONSOLE_FLOW` env leak fix.** `src/util/env.test.ts` cleared `CONSOLE_FLOW` after the `'0' → false` case so it stops leaking into later files; unblocked a pre-existing flaky `src/console/sink.test.ts` assertion under the full single-fork suite.

## v0.21.0: 2026-06-19

**Models dashboard rewrite, the Models admin API, and console-flow parity.**
- **Models dashboard rewrite (`/admin/models`).** Card table now surfaces the client call string. New **ID** column renders `callName(provider, name)` (`mx/MiniMax-M3`, `pio/claude-opus-4-8`, `kr/…`, `cb/…`, `nt/…`) via a client-side `client/src/lib/provider-prefix.ts` (`PREFIX_BY_PROVIDER`, provider→prefix, the inverse of the server's `PREFIX_TO_PROVIDER`). Columns reworked to **ID / Name / Context In / Context Out / In $/M / Out $/M / Aliases / Combo / Status / Test / Actions**. Row actions: **Toggle**, **Copy** (clipboard with `execCommand` fallback), **Test** (existing), **Edit**, **Delete**. **Per-card Fetch from upstream** now calls `POST /api/admin/models/fetch/:provider` and is hidden on providers without an upstream list endpoint (Kiro, CodeBuddy, Notion). New `EditModelModal` PATCHes editable fields. The shared `Model` client type carries the new `contextOutput` + `comboCount` fields.
- **Models admin API.** New JSON routes on `modelRoutes` (`src/api/admin/models.ts`): `POST /api/admin/models/fetch/:provider` (minimax + pioneer only; 404 for others; 400 when no active account; 502 on upstream failure), `GET /api/admin/models/:name/refs` (alias + combo references), `DELETE /api/admin/models/:name` (409 `has_refs` when referenced by an alias or combo, else delete), `PATCH /api/admin/models/:name` (rejects unknown fields, wrong types, empty patches; name + upstream_model immutable). `GET /api/admin/models` list response now includes `contextOutput` and `comboCount` per row. Repo helpers `updateModel(db, name, patch)` + `deleteModel(db, name)` added.
- **`context_output` column (migration 010).** Additive `ALTER TABLE models ADD COLUMN context_output INTEGER`; `user_version = 10`. Pioneer seeder seeds `context_output` from the upstream catalogue's `max_tokens`; `max_input_tokens` continues to populate `context_window`.
- **Pioneer dedup migration (009).** `user_version = 9`. Collapses the 64 leaked `anthropic/pioneer/<x>` duplicate rows onto their canonical `pioneer/<x>` survivor (139 → 75 exact, 0 survivors with a leaked prefix; idempotent).
- **Console flow parity across all 5 providers.** `handleNotionProxy` was silent (hand-rolled `reqId`, no `c.set`, no `buildStart`/`buildAccount`/`buildDone`/`buildError`, no log row on any error path); now at parity with Pioneer. **CodeBuddy**: `buildStart` carries the resolved upstream model (was hardcoded `'codebuddy'`); log row uses `resolved.upstreamModel` + `resolved.requestedModel`. **MiniMax + Kiro**: error-path `!resp.ok` / `!result.ok` branches now write a `request_logs` row alongside `buildError`. **MiniMax**: `genReqId` + `c.set('reqId')` hoisted to the top of `handleProxy`; `buildStart` moved to after model resolution.
- **Combo console thread.** `handleCodeBuddyProxy` / `handlePioneerProxy` / `handleKiroProxy` accept an optional `parentReqId?: string` last param; `handleComboProxy` passes its own `reqId` at all three delegation legs so a combo request is one console thread.

## v0.20.0: 2026-06-18

**Notion upstream provider.**
- **Reverse-engineered Notion desktop AI chat.** `app.notion.com/api/v3/runInferenceTranscript` plus the surrounding auth + model-catalog endpoints. Captured traffic from desktop v23.13.20260617.1538 via mitmproxy (HAR + flow files in `docs/notion/`, gitignored).
- **3-step temp-password login.** `getLoginOptions` → `sendTemporaryPassword` (sends 6-char temp password to email) → `loginWithEmail` → 8 cookies captured from `Set-Cookie`. Stored in `accounts.provider_data` JSON (same pattern as Kiro's `provider_data`).
- **Cookie-based session.** 11 cookies required per AI request. Cloudflare `__cf_bm` / `_cfuvid` ignored (infra, set by browser).
- **Wire format translation.** Single-JSON request body (`{traceId, spaceId, transcript[], patches}`). NDJSON response of JSON-Patch operations. `extract.ts` applies patches, emits text + tool-call deltas as OpenAI SSE.
- **Tool calls.** `agent-tool-result` records surfaced as OpenAI `tool_calls` deltas. 7 modular tools observed: `fs-module`, `notion-module`, `web-module`, `mcpServer-module`, `search-module`, `helpdocs-module`, `system-module`.
- **20 builtin models** seeded from manifest: GPT-5.2/5.4/5.5 (+ Mini/Nano), Opus 4.6/4.7/4.8, Sonnet 4.6, Haiku 4.5, Fable 5, Gemini 2.5/3.5/3 Flash + 3.1 Pro, Grok 4.3 + Build 0.1, Kimi K2.6, DeepSeek V4 Pro, GLM 5.2.
- **Provider enum extended to `notion`**, `nt` prefix registered, `selection.notion` setting added, dispatch branch in `handleProxy`. **No schema migration**; uses existing `accounts.provider_data` JSON.
- **CLI**: `npm run notion-add-account` (3-step), `npm run seed-notion-models`.
- **v1 limitations**: no failover, no Anthropic-format pass-through, no image-upload endpoint (Notion-hosted `attachment:` URLs only).
- **Wire format docs**: `docs/notion/wire-format.md`, `docs/notion/capture-notes.md`.
- **Tests**: 19 unit + 5 integration.

## v0.19: 2026-06-17

**Security hardening, the Pioneer upstream, and seed-on-account-add.**
- **SQLCipher encryption-at-rest.** Optional encrypted SQLite via the new `ROUTER_DB_KEY` env (`better-sqlite3-multiple-ciphers`); `openDb()` + `reset.ts` honor it. Key lives only in process env.
- **Re-auth gate on client-key reveal.** `GET /api/admin/client-keys/:id/key` now requires a fresh re-auth (`POST /api/admin/reauth/verify` + short-lived cookie) and writes every reveal to `audit_log` with IP + ISO timestamp (migration `007-audit-log`, `user_version = 7`). Dashboard reveal flow pairs with a re-auth modal.
- **Security posture surface.** Startup warnings for open mode / unencrypted DB; `GET /api/admin/security/status` (`{ mode, dbEncrypted, dbKeySet }`); `SecurityBanner` in the dashboard `AppShell`.
- **Typed settings reader.** `getSettingT<K>()` backed by Valibot schemas for every known settings key; admin/proxy/server call sites migrated off `as unknown as`.
- **SseAssemblerBase template-method refactor.** Shared Anthropic-SSE state machine extracted to `src/providers/common/SseAssemblerBase.ts`; `KiroAnthropicAssembler` + `OpenAIToAnthropicSSEAssembler` extend it.
- **Client page splits.** `Transports.tsx`, `Accounts.tsx`, `Models.tsx` broken into focused sub-components.
- **Unified add-account CLI.** `scripts/add-account.ts` is the single entry point across all providers (`--provider minimax|kiro|codebuddy|pioneer`), valibot-validated; per-provider scripts removed.
- **Pioneer upstream provider (`pio/`).** Fourth upstream (`src/proxy/pioneer.ts` + `src/providers/pioneer/`). Standard OpenAI Chat Completions + `X-API-Key`, reusing CodeBuddy's OpenAI-SSE bridge for both client formats. Provider enum + `pio` prefix + `selection.pioneer` + dispatch branch added. Models namespaced under `pioneer/` in both `name` and `upstream_model` (global-UNIQUE collision fix); `resolveModel` maps `pio/<id>` to the namespaced row. Full dashboard card; provider-aware admin `POST /accounts`.
- **Seed-on-account-add.** Dropped first-startup pre-seed; each provider's catalogue seeds when an account is added (MiniMax/Pioneer live-fetch `GET /v1/models`, Kiro/CodeBuddy builtin lists via `src/db/seed-builtin-models.ts`). Fresh DB starts empty; `autoSeed.ts` removed and the MiniMax INSERT dropped from `001-initial`.
- 855 backend + 77 client tests green.

## v0.18: 2026-06-14

**CodeBuddy as a third upstream provider.** The router now supports MiniMax, Kiro, and CodeBuddy as parallel upstreams, selected by `body.model` prefix.
- **CodeBuddy provider (`cb/`).** `src/proxy/codebuddy.ts` handles requests routed via the `cb/` prefix. Bridges a CodeBuddy OpenAI-format upstream to the client's chosen wire format: OpenAI SSE → Anthropic SSE assembler, SSE wrapper + non-stream aggregator, forced `stream_options.include_usage`, guaranteed system message insertion, and mid-stream SSE error propagation. `pullQuota` is provider-aware and no-ops for CodeBuddy (no quota API). Live-verified seed model list (`npm run seed-codebuddy-models`). Bare model names stored; `cb/` prefix resolved at routing time.
- **Provider prefix routing (`mx/` / `kr/` / `cb/` / `pio/` / `nt/`).** `src/providers/model-prefix.ts` parses the `body.model` string: a known prefix asserts the provider, the model name is looked up literally (no alias expansion), and the stored `models.provider` must agree, else 400. Unprefixed names resolve only via combos or aliases; a bare raw model name is rejected with 400. An unknown prefix (`xx/...`) → 400 (`unknown model prefix`). Combo members must carry a prefix.
- **Combo fallback chains.** New `combos` table (`migration 005`): `id`, `name`, `models` (JSON array), timestamps. CRUD repository (`src/db/repos/combos.ts`) + admin API + dashboard Combos page (CRUD modal, sidebar nav). The proxy (`src/proxy/combo.ts`) walks the ordered member list with cross-provider fallback, re-selecting an account per iteration to skip freshly backoffed accounts. Retries on `401/402/403` (auth/payment) and `502/503/504` (transient upstream). Combo names are validated against existing aliases on creation to prevent shadowing.
- **Per-provider account selection.** `selection.<provider>` settings key per provider (e.g. `selection.minimax`, `selection.kiro`). Each carries its own `mode` (`lowest-backoff` | `round-robin` | `sticky`) and `step` for round-robin cursor. Dashboard splits Accounts and Models into per-provider cards with inline selection controls and a health-test button. Manual model-add + model health-check endpoints added.
- **Transport upgrades.** GeoIP country probe via `ipapi.co` on transport add (`src/transport/geoip.ts`, migration `006-transport-country`; advisory, non-blocking). LRU + SOCKS dispatcher cache invalidated on transport CRUD. Proxy failure mode (`direct` | `block`) toggle surfaced in the Console. Bulk transport import modal; "Used by" column on the Transports page.
- **Console & dashboard enhancements.** Per-request detail expand (by-req-id endpoint). Client-side filter bar (model / account / status). Relative timestamps + collapsible blocks (opt-in toggle). RTK bytes-saved shown on the `done` line; real `rtk_bytes_saved` persisted in `request_logs`. Transport-fail rendering. Bulk model toggle, client-key label PATCH, alias shadow indicators, Account column on Overview/Usage, inline client-key label editing, Kiro Usage button, model-lock visibility, force-pull quota button.
- **Scheduler: request log retention.** `tickQuotaOnce` in `src/scheduler/quota-pull.ts` calls `cleanupOldLogs(db, RETENTION_DAYS)` (default 30 days, overridable via `REQUEST_LOG_RETENTION_DAYS` env). The prune runs on the same periodic tick as quota pull, session cleanup, and snapshot cleanup; no new timer needed.
- **Hot-path hardening.** Prepared-statement cache, batched log inserts, additive indexes, tuned PRAGMAs. Auth: throttled `last_seen` writes + opportunistic rate-limit sweep. Kiro: hoisted `TextDecoder`, growable SSE buffer, zero-copy slicing. Streaming: incremental usage extraction. Console: O(1) ring buffer + coalesced stdout sink. Client: scoped re-renders, tiered query defaults, font preload. `proxy` now uses `undici.fetch` for dispatcher support on Node 22.
- **Verification.** 671/671 server tests + 25/25 client tests. `npm run typecheck` clean (root + client). `npm run build` clean.

## v0.17: 2026-06-09

**Live Console.** A single in-process bus streams per-request proxy flow events to two sinks: the dashboard's new `Console` page over SSE, and server stdout as colored lines. Both proxy paths (`handleProxy` MiniMax, `handleKiroProxy`) emit `start` → `account` → `transport` → `done`/`error` with a shared `reqId`, which also lands on `request_logs.req_id` so a flow block links to its Request Detail row.
- **`src/console/` module.** `types.ts` (FlowEvent discriminated union: `FlowReason` / `TransportKind`), `bus.ts` (`ConsoleBus` class + 200-event ring buffer + throwing-subscriber isolation + `consoleBus` singleton), `format.ts` (pure ANSI renderer with `stripAnsi` / `fmtTokens` / `fmtLatency`; exported for tests), `flow.ts` (`genReqId` 4-byte hex + 5 `build*` helpers, message string trimmed to 200 chars), `sink.ts` (`attachStdoutSink`; gated by `CONSOLE_FLOW=0`, no-op in that case). All four phases covered by 18 unit tests.
- **SSE endpoint.** `GET /api/admin/console/stream` (Hono `streamSSE`, `requireAdmin`); streams `consoleBus.recent()` to the new client (backfill), then live events via `bus.subscribe`, with a 15s heartbeat and `stream.onAbort` cleanup so disconnected clients stop receiving.
- **Emit wiring in `src/server.ts`.** A short hex `reqId` is generated in each handler, set on the Hono context, and threaded through every emit + every `insertRequestLog*` call. `TransportConfig` `kind`/`label` mapped to `'relay'` / `'proxy'` + the respective URL. Error path emits a `buildError` with the status + first 200 chars of the body; the catch arm uses `c.get('reqId') ?? '----'` so the final error line still correlates.
- **Migration `004-reqid`.** Additive `ALTER TABLE request_logs ADD COLUMN req_id TEXT`; `user_version = 4`. Existing rows stay NULL.
- **Dashboard Console page.** `client/src/pages/Console.tsx` (Preact); `EventSource` over `/api/admin/console/stream`, in-memory event list (capped 600 ≈ 200 blocks), pure `ConsoleBlocks` group-by-reqId component exported separately for testability, Pause / Clear buttons (uses `TopBar` actions slot), live-vs-reconnecting dot, "Waiting for requests…" empty state, and auto-scroll-stick that breaks off the bottom on manual scroll. Obsidian Gold styling: gold `reqid`, green ✓ for `done`, red ✗ for `error` / `status >= 400`. Wired into `AppShell` (lazy + `KNOWN_ROUTES` + `g n` hotkey + help modal), `Sidebar` (with new `console` terminal icon in `Icon.tsx`), and `CommandPalette`. 2 client tests on `ConsoleBlocks` (summary + error block).
- **Verification.** 484 server tests (was 465 → +19) + 21 client tests (was 19 → +2). `npm run typecheck` clean. `cd client && npm run build` clean. Lint baseline unchanged (20 errors / 44 warnings; all pre-existing).

## v0.16: 2026-06-08

**Kiro (AWS CodeWhisperer) as a second upstream provider.** The router is no longer MiniMax-only: requests routed by the resolved model's `provider`. MiniMax stays the default and its path is unchanged.
- **Multi-provider schema.** Migration `002-kiro` (additive) adds `provider` + `access_token` + `token_expires_at` + `provider_data` to `accounts`, and `provider` to `models`. Existing rows default to `provider = 'minimax'`. Kiro accounts store their OAuth **refresh token** in `api_key` (non-null + unique), cache the short-lived bearer in `access_token`, and keep SSO/OIDC fields in `provider_data` JSON.
- **Kiro provider modules** (`src/providers/kiro/`): `constants` (endpoints, `-thinking`/`-agentic` model resolution, thinking-mode prompt injection), `transform` (OpenAI → CodeWhisperer `conversationState`: tools, tool results, images, system folding), `eventstream` (AWS event-stream binary frame decoder), `assembler` (events → OpenAI SSE chunks + buffered JSON), `anthropic-sse` (events → native Anthropic Messages SSE), `token-refresh` (AWS SSO OIDC vs Kiro social), `auth` (`ensureAccessToken`; DB-cached, auto-refresh with 5-min buffer), `index` (executor).
- **Native Anthropic streaming.** `/v1/messages` (Claude Code, hermes-agent) streams real Anthropic SSE: `message_start` → `content_block_*` (text / thinking / tool_use) → `message_delta` → `message_stop`. `/v1/chat/completions` streams OpenAI SSE. Both pipe through `pipe-with-usage` for telemetry.
- **Full account import.** Add Kiro accounts via dashboard or API (`POST /api/admin/accounts/kiro`) with: paste credential JSON (Kiro IDE / AWS SSO cache), AWS Builder ID, AWS IAM Identity Center (IDC), or raw refresh token. `buildKiroAccountFields` parses the blob and infers the auth method. CLI: `npm run add-account -- --provider kiro`, `npm run seed-kiro-models`.
- **Tests.** 18 new unit tests (constants, transform, event-stream, OpenAI + Anthropic assemblers, account import) + a 4-case end-to-end integration test (`tests/integration/proxy-kiro.test.ts`) that drives the full proxy path against a mocked binary upstream (OpenAI JSON, OpenAI SSE, Anthropic SSE, 503 fallback).
- **Switchable per-account persona (IDE ⇄ CLI).** Each Kiro account can mimic one of two upstream client identities, selected from the dashboard (Upstream → Edit → Persona) or `PATCH /api/admin/accounts/:id {persona}`. Default stays `ide` so existing accounts are untouched.
  - **`ide` (legacy, default).** The Kiro IDE path via `codewhisperer.{region}.amazonaws.com` with the aws-sdk-js + `KiroIDE` fingerprint. Unchanged behaviour.
  - **`cli` (experimental).** Mirrors the real `kiro-cli` 2.6.0 wire format **verified byte-for-byte against captured traffic**: `runtime.{region}.kiro.dev` host, `aws-sdk-rust` / `AmazonQ-For-CLI` User-Agent, `application/x-amz-json-1.0`, `origin: KIRO_CLI`, `chatTriggerType: MANUAL`, `agentContinuationId` + `agentTaskType: vibe`, per-message `envState`, no `inferenceConfig`. Model ids are converted to the dotted form the runtime host requires (`claude-sonnet-4-6` → `claude-sonnet-4.6`).
  - **Automatic `profileArn` discovery.** The CLI runtime host rejects requests without a `profileArn`. On first CLI-persona use the router calls `AmazonCodeWhispererService.ListAvailableProfiles` on `management.{region}.kiro.dev` (wire format captured from kiro-cli), then caches the resolved ARN into `provider_data` so discovery runs once.
- **Live-verified.** The Kiro upstream (both personas) is now confirmed against the live AWS / Kiro endpoints with a real account: chat, streaming, thinking, and all catalog models return 200.

## v0.15: 2026-06-04

**Quota phantom-block root cause + schema consolidation.** Cleanup after a dashboard bug where the quota page rendered a duplicate 0% block.
- **Puller skip nameless items.** `model_remains[]` items without `model_name` (upstream occasionally emits these) are dropped at parse time. The frontend cannot group them, so storing them as NULL-model rows would surface as a phantom `general` pair. Three layers of defense: source (puller skips), read (query filters `model_name IS NOT NULL`), data (legacy NULL rows cleaned out).
- **Single migration.** Migrations 002-008 folded into one `001-initial.ts` containing the full final schema. Legacy upgrade stubs (admin-key, drop-users, drop-thinking) and the dead `repos/users.ts` tombstone removed. Fresh-deploy only; existing DBs upgrade in place (the consolidated schema is a superset). `user_version = 1`.
- **Type tightening.** Shared `OpenAIBody` / `AnthropicBody` / `ContentBlock` types in `src/providers/format/message-types.ts` reused by `transform.ts`, `proxy/augment.ts`, `caveman/index.ts`, `alias.ts`. All 5 functions in `format/transform.ts` now have typed signatures; the `bodyOpenAIToAnthropic` / `bodyAnthropicToOpenAI` / `responseOpenAIToAnthropic` / `responseAnthropicToOpenAI` / `bodyAddsOpenAIStreamUsage` no longer accept or return `any`. Internal `as any` casts inside the function bodies remain (low-risk narrowing deferred to a future plan).
- **Dead field removed.** `schemaVersion: 1` in the seeded `build` setting was an artifact of the old per-step migration system; the real schema version lives in the `user_version` PRAGMA. Reader audit found zero consumers; field removed.
- **Lint debt paid down.** `noExplicitAny` warnings dropped from 19 → 14 (across `format/transform.ts` internals + a few pre-existing `rtk/` and `transport/` instances deferred to a follow-up). `noConfusingVoidType` resolved in `src/api/admin/middleware.ts` by aligning with the `Promise<Response | undefined>` convention already used in `src/auth/index.ts`.

## v0.14: 2026-06-04

**Usage all-time range + per-row key copy.**
- **All-time window.** Overview + Usage range selector gains an "all" option; `days=0` means no time clause in `aggregateUsage` (null deltas). Default range dropped to 1 day.
- **Copy full client key.** `GET /api/admin/client-keys/:id/key` returns the full plaintext bearer for a per-row Copy button; the list itself stays masked.

**Quota flow fix + redesign.** The quota page showed "no data" because the puller parsed the wrong upstream shape, and the few fields it did store were semantically swapped.
- **Real shape parsed.** Live MiniMax `token_plan/remains` and `coding_plan/remains` both return nested `{ model_remains: [ { model_name, current_interval_*, current_weekly_*, remains_time, current_*_remaining_percent } ] }`. The old parser read a flat top-level object → every field `undefined` → null snapshots. Rewritten as a single shared parser over both endpoints (token_plan → coding_plan fallback).
- **Semantic swap fixed.** `current_interval_usage_count` is the amount **used**. Code had stored it as `remaining_count`, and stored `total − usage` (the actual remaining) as `used_count`. Now `used_count = usage_count`, `remaining_count = max(0, total − usage)`.
- **Percent + reset stored.** Migration 008 (consolidated into the single `001-initial` schema in v0.15) added `model_name`, `remaining_percent`, `remains_time` to `quota_snapshots`. `general` plan is not count-metered (total 0/0), so `remaining_percent` is the only meaningful signal there.
- **API per-model.** `/api/admin/quota` groups latest snapshots by `(model_name, window_type)` instead of collapsing all models into one row; payload gains `modelName`, `remainingPercent`, `remainsTime`.
- **Page redesign.** Per-model percent bars (general, video) with 5h + weekly windows, gold gradient fill, status dot, `used / total` count detail when metered, and a "resets in 2h 9m" countdown from `remains_time` (new `forwardDuration` helper). Obsidian Gold throughout.

## v0.13: 2026-06-04

**Hot-path latency.** Cut the work the proxy does on top of raw MiniMax latency, with tracking kept 100% intact. Warm per-request SQLite statement executions dropped from 8 → 5 (measured by `tests/bench/hotpath.bench.test.ts`); router overhead against an instant fake upstream roughly halved.
- **Batched settings read**: `getAllSettings(db)` warms the per-db settings cache in one query instead of ~6 separate `getSetting` lookups.
- **Skip no-op account writes**: the success-path account reset only runs when the account is actually dirty (`backoff_level`/`status`/`rate_limited_until`/`last_error`), not on every request.
- **Throttled lock cleanup**: `clearExpiredModelLocks` runs its `DELETE` at most once per 30s (timestamp advanced only after a successful delete); lock correctness is unaffected since `isModelLockActive` checks expiry inline.
- **Client-key lookup cache**: bearer → `ClientKey` cached per-db with a 5s TTL, invalidated on create/enable/disable/delete.
- **Deferred request-log insert**: the log write moves off the response critical path via `setImmediate`; `flushDeferredLogs()` drains pending inserts (used by tests and graceful shutdown). The row is still written in full.
- **Fast-path passthrough**: when no transform mutates the body (caveman/caching/rtk off, no cross-format conversion, no alias rewrite, no thinking injection), the original raw request text is forwarded upstream instead of re-serializing the parsed body. A `bodyDirty` flag gates this; any mutation falls back to re-stringify.

**Fixes surfaced along the way.**
- `stream_options.include_usage` was never actually injected (the helper returned a new object whose return value was discarded at the call site); now captured and merged, so OpenAI streaming usage/cost tracking works. This makes the v0.8 "auto-injection" claim true.
- `adminApi` captured a stale db handle at import time and overrode the per-request handle; now reads `c.get('db')` from context.
- `resetDb()` now closes the SQLite handle before nulling it (releases Windows file locks; fixes temp-dir cleanup `EPERM` in the test suite).
- Replaced a stale `MiniMax-M3-thinking` proxy test (that behavior was dropped in v0.11; everything is adaptive) with an adaptive-thinking-injection test.

See `docs/superpowers/plans/done/2026-06-03-hot-path-latency.md` and `docs/superpowers/specs/done/2026-06-03-hot-path-latency-design.md`.

## v0.12: 2026-06-03

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

## v0.11: 2026-06-02

**Adaptive thinking.** M3 + docs-listed models default to adaptive thinking. `thinkingEnabled` dropped from `/api/admin/models`; `-thinking` aliases preserved for backwards-compat. See `docs/superpowers/plans/2026-06-02-builtin-models-adaptive-thinking.md`.

**Dashboard SPA rebuild.** Preact + Vite SPA. Obsidian Gold theme (obsidian canvas + single gold accent). Command palette (`⌘K`), keyboard nav (`g` then key), hash-routed pages. `client/dist/` baked into the Docker image. See `docs/superpowers/plans/2026-06-02-dashboard-spa-rebuild*.md`.

**Docker entrypoint fix.** Work on Windows hosts (CRLF + exec bit on `docker-entrypoint.sh`).

## v0.10: 2026-06-02

**Flow gaps.** Five-phase plan covering CSRF/session/security hardening, proxy pipeline cleanup, backend reliability, UI login + a11y, UI navigation + forms. See `docs/superpowers/plans/2026-06-02-flow-gaps*.md`.

## v0.9: 2026-05-31

**Foundation.** OpenAI + Anthropic compatibility, multi-account pool with sticky + round-robin selection, prompt caching (cache_control dual breakpoints), RTK + Caveman compression, built-in dashboard, SQLite-WAL, Hono on Node 20+. Six-phase plan: `docs/superpowers/plans/2026-06-01-minimax-router*.md`.

## Next up

Speculative: these are ideas, not commitments. Edit freely.

- **Response caching**: per-prompt-hash TTL cache for repeat queries
- **Request replay UI**: re-send a logged request with edits from `/admin/usage`
- **Account health dashboard**: latency p50/p95, error rate, last-success per model per account
- **Prometheus `/metrics` endpoint**: scrape-friendly counters and histograms
- **Webhooks for error events**: POST to a configured URL on fatal upstream errors
