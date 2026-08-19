# Changelog

All notable changes to **kelola-router** are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **TabiToken upstream provider.** Seventh upstream: New-API-fork reseller gateway at `tabitoken.cc` — OpenAI Chat Completions (+ native Anthropic `/v1/messages` on the same base), Bearer key auth. Routed via `tabi/` prefix; builtin catalogue mirrors the live gateway (4 models: `claude-opus-5(-thinking)`, `claude-opus-4-8(-thinking)`, verified against `/v1/models` + `/api/pricing`); dashboard card, CLI runner (`npm run add-account -- --provider tabi`) and `npm run seed-tabi-models`.
- **Live-gateway validation (domain back after Cloudflare Registrar suspension).** Default base URL corrected from `tabitoken.com` (the `.com` front WAF-blocks non-browser user agents) to the API server `tabitoken.cc`. New-API error envelope mapped: `parseError` extracts `error.code`, `errorRules` maps `insufficient_user_quota` → balance-permanent disable (previously fell into a 5s retry loop), `invalid_api_key`/`authentication_error` → no cooldown, `context_length_exceeded` → token-limit. Dashboard pricing uses Anthropic official list prices ($5/$25, cache $0.50/$6.25 per 1M), per user preference.

### Changed

- **Dashboard UI/UX overhaul (same Obsidian Gold theme).** Sidebar nav grouped into View / Operate / System with a persisted expandable rail (`kr-nav-expanded` in localStorage); route loading replaced the bare "Loading…" text with a branded `PageSkeleton` + subtle `page-enter` transition; `TopBar` gains an optional page `subtitle`. Polish styles live in `client/src/styles/polish.css` (loaded after `components.css`).

### Verification

- Server **1004 tests** (164 files), client **121 tests** — run server suite with `--pool=forks` (better-sqlite3 teardown segfault under the default threads pool on Windows is pre-existing and unrelated).
- `npm run typecheck` clean (root + client). `npm run lint` clean. `npm run build` green.

## [0.22.1] — 2026-06-21

### Changed

- **Migration consolidation — single fresh-deploy schema.** Migrations `002-010` are folded into `001-initial.ts` as one consolidated fresh-deploy schema; a new database reaches the final schema in a single step and `user_version` ends at 1. No incremental `ALTER` migrations and no data dedup. The single migration's SQL is split across three modules — `schema.sql.ts` (CREATE TABLE), `indexes.sql.ts` (all CREATE INDEX), `seed.sql.ts` (default settings rows) — concatenated by `001-initial.ts`, so the ~170-LOC schema stays readable per file. Existing DBs at `user_version = 10` keep working unchanged (the runner skips everything; the consolidated schema is a superset). Rationale: this is a self-host single-user pre-1.0 project — the incremental ALTERs and the Pioneer dedup cleanups (`008`/`009`) only ever mattered for DBs that had drifted across older releases, which is irrelevant on a fresh install.

### Removed

- **Migration files `002-010`.** `002-kiro`, `003-transports`, `004-reqid`, `005-combos`, `006-transport-country`, `007-audit-log`, `008-pioneer-dedup`, `009-pioneer-anthropic-dedup`, `010-model-context-output` — their columns/tables now live in the consolidated `001-initial` schema. The `007-audit-log.test.ts` upgrade-path test was dropped (the table is now created by `001`); the `index.test.ts` migration-009 dedup test was replaced with consolidated-schema assertions. `tests/db/migration-004.test.ts` keeps its `req_id` column-presence check but drops the now-false `user_version >= 4` assertion.

### Fixed

- **`CONSOLE_FLOW` env leak in `env.test.ts` (pre-existing flaky `sink.test.ts`).** The `isConsoleFlowEnabled` "env = 0 → false" case set `process.env.CONSOLE_FLOW = '0'` without clearing it; the next `describe` block's `beforeEach` did not reset it, so the flag leaked into later test files. Under the full suite (single fork), this made `attachStdoutSink` early-return in `src/console/sink.test.ts` and the "coalesces multiple events" assertion failed with 0 writes. Now cleared immediately after the assertion.

### Verification

- 980 server tests pass (vitest, `--pool=forks --poolOptions.forks.singleFork=true`; the default `npm test` hits a better-sqlite3 native segfault under file-parallelism on this host — pre-existing, unrelated to this change). 83 client tests pass.
- `npm run typecheck` clean (root + client). `npm run lint` clean. `npm run build` green.
- Docs synced: `docs/reference/db-tables.md`, `ARCHITECTURE.md`, `README.md`, `docs/guides/add-a-migration.md`, `docs/adr/0005-sqlite-wal-migrations.md`, `.claude/skills/{add-migration,add-provider}/SKILL.md` — all reflect `user_version = 1` and the single consolidated migration.

## [0.22.0] — 2026-06-19

### Fixed

- **A4 — manual POST `/api/admin/models` now persists `family`.** The manual model-insert path was dropping the `family` column, so any admin-created row had `family = NULL`. That broke `ADAPTIVE_THINKING_MODELS` matching and per-family dashboard grouping. The POST handler now reads `family` from the request body, trims it, and persists it on the row alongside the existing fields. Whitespace-only or omitted family defaults to `null`, mirroring the existing `displayName` normalization. (`src/api/admin/models.ts`, new `src/api/admin/models.test.ts` with 3 cases.)
- **A5 — quota endpoint parallelises per-account fetch via `Promise.allSettled`.** `GET /api/admin/quota` previously awaited `ensureAccessToken` + `fetchKiroUsage` sequentially per Kiro account — with N accounts, a single broken refresh token 502s the whole endpoint and hides the healthy accounts. The Kiro branch now fans out across accounts in parallel and reports per-account `ok: boolean` + optional `error: string`. The MiniMax branch is unchanged (local SQLite query, already fast). Response shape changed from a top-level array to `{ accounts: QuotaAccountResult[] }` — `QuotaAccountResult` is a true discriminated union (`{ ok: true, windows: QuotaWindow[] }` | `{ ok: false, windows: [], error: string }`); per-account error state is rendered inline in the dashboard Quota page. New `src/api/admin/quota.test.ts`. The two existing quota assertions in `src/api/admin/index.test.ts` were updated to read `body.accounts`.
- **A6 — admin cache TTL drops 1000ms → 250ms + explicit invalidation hook.** The admin overview / usage / quota endpoints cached for 1s, hiding writes from the dashboard within that window. The TTL is now 250ms AND a new `bumpAdminCacheVersion()` hook invalidates the entire cache immediately. The hook fires from the `requestLogs.ts` deferred-queue flush — successful batched writes invalidate the cache; failed writes do not. The hook lives in `src/db/hooks.ts` (a 3-line re-export module) to break the circular import between `src/db/repos/requestLogs.ts` and `src/api/admin/cache.ts`. New `src/api/admin/cache.test.ts` with 3 cases (TTL boundary, bump invalidates, deferred flush triggers bump).
- **A7 — settings GET returns `null` for un-written keys; client merges UI defaults.** `GET /api/admin/settings` was inlining server-side defaults (`caveman → { level: 'off' }`, `caching → { autoBreakpoints: true }`, etc.), making it impossible to distinguish "user set the default value" from "key never written" — auditing required hitting the DB. The GET handler now returns `null` for un-set keys. `client/src/pages/Settings.tsx` merges the UI defaults client-side so user-facing behaviour is unchanged. The `SettingsData` type was tightened to match the server-side valibot picklists (`CavemanLevel = 'off' | 'terse' | 'ultra'`, `UpstreamFormat = 'auto' | 'openai' | 'anthropic'`). New `src/api/admin/settings.test.ts` with 2 cases. `README.md` Configuration section updated to reflect the new shape.
- **B1 — combo / alias name uniqueness enforced in both directions.** The bare-namespace invariant (per ADR 0008) was checked only when a combo was inserted or renamed (`checkAliasConflict` in `combos.ts`), but `upsertAlias` never checked the reverse direction — an alias could shadow a combo. Added exported `checkComboConflict` in `src/db/repos/combos.ts` (mirror of `checkAliasConflict`) and call it at the top of `upsertAlias` so both INSERT and UPDATE paths reject with a `combo_conflict:` error. New `src/db/repos/aliases.test.ts` with 4 cases covering INSERT-blocked, UPDATE-blocked, free-name, and multi-combo scenarios. All existing call sites of `upsertAlias` were audited (admin POST, provider alias cache, integration tests) — 46/46 pass, no regressions.
- **B2 — `upsertAlias` now updates `source` on existing rows.** The UPDATE branch only set `upstream_model` and `label`, so a row originally inserted with `source: 'seed'` stayed seed-tagged after a user edit (audit noise). The UPDATE now also sets `source = ?` with `args.source ?? existing.source` as the fallback — callers can opt into a new source by passing one, but the original tag is preserved on partial updates. New test case added to `aliases.test.ts`.

### Verification

- All 6 audit findings from `docs/superpowers/specs/2026-06-19-audit-fixes-design.md` addressed (A4, A5, A6, A7, B1, B2). A1/A2/A3 were already remediated in earlier commits.
- 14 new tests added across `models.test.ts` (3), `quota.test.ts` (1 + mock setup), `cache.test.ts` (3), `settings.test.ts` (2), `aliases.test.ts` (5). 161 server test files green; 1 pre-existing failure in `src/api/admin/models.fetch.test.ts` (returns 404 vs 200 for an unsupported provider) is out of scope and predates this release.
- 78 client tests pass.
- `npx tsc --noEmit` clean on both server and client.
- `npx biome check` clean on all changed files.
- Docker image rebuilt; `curl http://127.0.0.1:20137/healthz` returns HTTP 200.
- 8 atomic conventional commits (`fix(api):`, `fix(quota):`, `fix(cache):`, `fix(settings):`, `fix(aliases):`, plus quality-fix fallout), each independently verified by its own test subset.

## [0.21.0] — 2026-06-18

### Added

- **Z.AI upstream provider (`zai/`).** New sixth upstream alongside MiniMax / Kiro / CodeBuddy / Pioneer / Notion. Z.AI exposes two parallel APIs that the router picks based on the client body format: Anthropic Messages at `https://api.z.ai/api/anthropic` (Claude-Code-compatible per `docs.z.ai/devpack/tool/claude`), OpenAI Chat Completions at `https://api.z.ai/api/coding/paas/v4` (GLM Coding Plan). Single Bearer API key auth — no OAuth, no migration. Provider enum extended, `zai/` prefix registered, `selection.zai` setting added, dispatch branch in `handleProxy`, mirror client type unions, ZaiCard in Accounts + Z.AI section in Models + ZaiForm in AddAccountModal, allowlist entries in `accounts.ts` + `models.ts` + `settings.ts` + `modelHealth.ts`, `payg` default credit-type. CLI: `npm run add-account -- --provider zai` + `npm run seed-zai-models`. **Curated 12-row seed list** (`src/db/seedBuiltinModels.ts → seedZaiBuiltins`) with real per-token pricing sourced from `docs.z.ai/guides/overview/pricing` and context windows from the per-model guide pages — text GLM-4.7 / 4.7-flash / 4.7-flashx / 5 / 5-turbo / 5.1 / 5.2 (incl. `[1m]` 1M-context variant) and vision GLM-4.6V / 4.6V-flash / 4.6V-flashx / 5V-Turbo. Wire format + auth docs: `docs/zai/{wire-format,auth}.md`.
- **Models dashboard rewrite (`/admin/models`).** The card table now surfaces the client call string — a new **ID** column renders `callName(provider, name)` (`mx/MiniMax-M3`, `pio/claude-opus-4-8`, `kr/…`, `cb/…`, `nt/…`, `zai/…`) via a client-side mirror `client/src/lib/providerPrefix.ts` of the server's `PREFIX_TO_PROVIDER` map. Columns reworked to **ID / Name / Context In / Context Out / In $/M / Out $/M / Aliases / Combo / Status / Test / Actions**. Row actions: **Toggle**, **Copy** (clipboard with `execCommand` fallback), **Test** (existing), **Edit**, **Delete**. **Per-card Fetch from upstream** now calls `POST /api/admin/models/fetch/:provider` and is hidden on providers without an upstream list endpoint (Kiro, CodeBuddy, Notion). New `EditModelModal` PATCHes editable fields. The shared `Model` client type carries the new `contextOutput` + `comboCount` fields.
- **Models admin API.** New JSON routes on `modelRoutes` (`src/api/admin/models.ts`): `POST /api/admin/models/fetch/:provider` (minimax + pioneer only; 404 for others; 400 when no active account; 502 on upstream failure), `GET /api/admin/models/:name/refs` (alias + combo references), `DELETE /api/admin/models/:name` (409 `has_refs` when referenced by an alias or combo, else delete), `PATCH /api/admin/models/:name` (validates body — rejects unknown fields, wrong types, empty patches; name + upstream_model immutable). `GET /api/admin/models` list response now includes `contextOutput` and `comboCount` per row. Repo helpers `updateModel(db, name, patch)` + `deleteModel(db, name)` added. Convention: `ApiError` + `handleApiError` for the 404s; the 409-with-refs response stays inline because `handleApiError`'s `{ error, message }` shape has no room for the `refs` payload.
- **`context_output` column (migration 010).** Additive `ALTER TABLE models ADD COLUMN context_output INTEGER`; `user_version = 10`. The Pioneer seeder seeds `context_output` from the upstream catalogue's `max_tokens`; `max_input_tokens` continues to populate `context_window`. The `Model` repo type + `upsertModel` INSERT carry the new column.
- **Pioneer dedup migration (009).** `user_version = 9`. Collapses the 64 leaked `anthropic/pioneer/<x>` duplicate rows (name `pioneer/anthropic/pioneer/<x>`, upstream_model `anthropic/pioneer/<x>`) onto their canonical `pioneer/<x>` survivor. Survivor selection: canonical upstream first, ties by shortest name then lowest id. Validated against a real dirty DB — 139 → 75 exact, 0 survivors with a leaked prefix; idempotent.
- **Console flow `parentReqId`.** `handleCodeBuddyProxy` / `handlePioneerProxy` / `handleKiroProxy` accept an optional `parentReqId?: string` last param; `handleComboProxy` passes its own `reqId` at all three delegation legs so a combo request is one console thread (the delegated leg reuses the parent id; direct calls still generate their own).

### Fixed

- **Pioneer seeder dedup.** `fetchAndSeedPioneerModels` now strips a leading `anthropic/pioneer/` (and `pioneer/`) before deduping the bare id — the upstream `/v1/models` catalogue returns each model id in both a canonical form (`gpt-5.5`) and an Anthropic-API-compat alias (`anthropic/pioneer/gpt-5.5`); the old seeder only stripped `pioneer/`, leaking 64 phantom rows (139 instead of 75).
- **Notion console flow.** `handleNotionProxy` was silent in the live Console (hand-rolled `reqId`, no `c.set`, no `buildStart`/`buildAccount`/`buildDone`/`buildError`, no log row on any error path). Now at parity with Pioneer: `genReqId` + `c.set` at the top, `buildStart` with the resolved model, `buildAccount` after the account is validated, a shared `failAndLog` helper emits `buildError` + writes a `request_logs` row on every terminal error branch (no account, missing cookies, missing spaceId, network error, upstream !ok, **stream parse error** — the `ReadableStream` catch gap is closed), and `buildDone` on the success stream. One `resolveModel` call (was duplicated, the second un-wrapped).
- **CodeBuddy console flow.** `buildStart` now carries the resolved upstream model (was the hardcoded `'codebuddy'` placeholder); the log row uses `resolved.upstreamModel` + `resolved.requestedModel` (was the raw `body.model`). Raw `body.model` preserved for SSE echoes.
- **MiniMax + Kiro error-path log row.** The `!resp.ok` / `!result.ok` branches now write a `request_logs` row alongside `buildError` (parity with CodeBuddy/Pioneer/Notion); tokens + cost are 0 on the error. Cost is 0.
- **MiniMax reqId + buildStart timing.** `genReqId` + `c.set('reqId')` hoisted to the top of `handleProxy` (was after account selection + model resolution); the outer `catch` references the in-scope `reqId` directly (no `c.get('reqId') ?? '----'` fallback). `buildStart` emitted after model resolution (carries the resolved model), before `buildAccount`. `buildAccount` stays after account selection.
- **AddAccountModal kiro method test.** Pre-existing harness failure (since the Notion refactor at v0.20.0): `fireEvent.change` on the kiro method `<select>` did not trigger `onKiroMethodChange` under `@testing-library/preact` + `happy-dom` when the inactive NotionAuthForm branch shared the tree. Fixed by dispatching a native `change` event; the component contract (method change notifies parent + resets both sub-flows) is preserved.

### Verification

- 906 server tests (vitest, `--pool=forks`), 78 client tests, `tsc --noEmit` (root + client), biome check, and `vite build` all green. 24/24 Notion tests passing. No push without maintainer confirmation.

## [0.20.0] — 2026-06-18

### Added

- **Notion upstream provider (`nt/`).** New fifth upstream (`src/proxy/notion.ts` + `src/providers/notion/`). Notion AI chat uses an undocumented internal protocol (CRDT-style JSON request body + NDJSON patch-stream response, cookie-based session auth) reverse-engineered from Notion desktop v23.13.20260617.1538 via mitmproxy. Provider enum extended to `notion`, `nt` prefix registered, `selection.notion` setting added, dispatch branch in `handleProxy`. **3-step temp-password login** (email → 6-char temp password emailed → cookies stored in `accounts.provider_data` JSON); 11 cookies required per request (`token_v2`, `notion_user_id`, `notion_users`, `p_sync_session`, `notion_locale`, etc). OpenAI streaming conversion via `buildNotionPayload` (request) + `extractNotionStream` (response). 20 builtin models seeded from `src/providers/notion/manifest.json` (GPT-5.2/5.4/5.5 + Mini/Nano, Opus 4.6/4.7/4.8, Sonnet 4.6, Haiku 4.5, Fable 5, Gemini 2.5/3.5 Flash + 3 Flash + 3.1 Pro, Grok 4.3 + Build 0.1, Kimi K2.6, DeepSeek V4 Pro, GLM 5.2). CLI: `npm run notion-add-account` + `npm run seed-notion-models`. Dashboard: NotionCard in Accounts + NotionAuthForm (3-step OTP) + useNotionAuth hook + 3 admin endpoints (`/notion/request-otp`, `/notion/verify-otp`, `/notion/reauth-required`). Agent-tool-result records surfaced as OpenAI `tool_calls` deltas. **v1 limitations**: no failover (single account), no Anthropic-format pass-through, no image-upload endpoint (Notion-hosted `attachment:` URLs only). Wire format + RE notes: `docs/notion/wire-format.md` + `docs/notion/capture-notes.md`. 19 unit + 5 integration tests green; 24/24 Notion tests passing; lint + server + client typecheck clean.

## [0.19.0] — 2026-06-17

### Added

- **Security: SQLCipher encryption-at-rest (H1).** SQLite database is now encrypted at rest when the new `ROUTER_DB_KEY` environment variable is set. `openDb()` reads the key via the new `getDbKey()` helper, switches the `better-sqlite3-multiple-ciphers` driver on, and applies the cipher pragma. `reset.ts` honors the same key when re-initializing the DB, so scripted resets stay in sync with encrypted production. New dependency: `better-sqlite3-multiple-ciphers`. The key never lands in the DB or on disk — it lives only in process env. The `getDbKey()` reader is the single source of truth.
- **Security: re-auth gate for client key reveals (H2).** `GET /api/admin/client-keys/:id/key` now requires a fresh re-authentication before returning the plaintext bearer. A real password-verification round trip (when a dashboard password is configured) sets a short-lived re-auth cookie; the reveal endpoint validates it on every call. Every reveal is also written to the new `audit_log` table (the existing audit table) with the admin's IP and ISO timestamp, giving a complete trail of who saw which key and when. The dashboard reveal flow pairs with a re-auth modal that prompts for the password in password mode and works transparently in open dev mode.
- **Security: open-mode + unencrypted-DB warnings + status endpoint + banner (H3).** The server now logs a startup warning whenever it boots in open mode (no dashboard password) or with an unencrypted DB while `ROUTER_DB_KEY` is set, so operators see the exposure in stdout. A new endpoint `GET /api/admin/security/status` exposes the same posture to the SPA: `{ mode: 'open' | 'password', dbEncrypted: boolean, dbKeySet: boolean }`. The dashboard's `SecurityBanner` component (two variants — "open mode" and "DB not encrypted") queries the endpoint and renders an unobtrusive top-of-page banner in `AppShell` when the deployment is exposed. The banner links straight to the Settings page.
- **Type safety: typed settings reader (H4).** New `getSettingT<K>()` wrapper backed by Valibot schemas for every known settings key (`rtk`, `caveman`, `caching`, `minimax`, `transport`, `build`, `user_settings`). Callers now get the validated, narrowed type back instead of an `unknown` blob to cast. All call sites across `src/server.ts`, `src/util/env.ts`, `src/proxy/*`, and `src/api/admin/*` have been migrated, eliminating a wide swath of `as unknown as` / `as any` casts. The underlying `getSetting(db, key)` stays for ad-hoc reads; `getSettingT` is the preferred path.
- **Refactor: `SseAssemblerBase` template-method (Item 5).** New abstract base class in `src/providers/common/SseAssemblerBase.ts` extracts the shared Anthropic-SSE event emission state machine (`ensureStart`, `openBlock`, `closeBlock`, queue, `flush`). `KiroAnthropicAssembler` and `OpenAIToAnthropicSSEAssembler` now extend the base and implement five small hooks (`createStartEvent`, `createBlockEvent`, `createDeltaEvent`, `createFinishEvent`, `getErrorEvent`) per their input type. The `AnthropicEvent` interface moved into the base so both subclasses import it from one place. Removes ~120 lines of duplicate state-machine code; new contributors only need to read the hooks to onboard.
- **Refactor: oversized client pages split (Item 6).** Three dashboard pages exceeded the readability budget and have been split into focused sub-components. `Transports.tsx` → `TransportsTable` + `TransportsAddModal` + `TransportsImportModal`. `Accounts.tsx` → `AccountsList` + `AccountsAddModal` + per-provider `AccountCard`s. `Models.tsx` → `ProviderModelsSection` + per-provider model tables. Each extracted module ships with its own colocated test where the logic is non-trivial.
- **Test coverage: Kiro module test siblings (Item 7).** Added sibling test files for three Kiro modules that previously had no coverage: `src/providers/kiro/usage.test.ts` (7 cases — happy path, headers, body shape, abort signal, region, non-ok, null cases), `src/providers/kiro/profile.test.ts` (4 cases — region fallback, transport passthrough, signal passthrough, no-arn-on-any-profile), and `src/api/admin/accounts.kiroAutoImport.test.ts` (7 cases — found/missing-cache/empty/malformed/most-recent/throw-once). The 855 backend test count includes all of these.
- **Tooling: unified account-add script (Item 8).** `scripts/add-account.ts` is now the single entry point for adding upstream accounts across all providers. `--provider {minimax,kiro,codebuddy,pioneer}` selects the flow; the same script handles MiniMax payg/coding keys, Kiro (Kiro IDE / AWS SSO OIDC / social / Builder ID / IDC / raw refresh token), CodeBuddy, and Pioneer. The per-provider scripts (`add-kiro-account.ts`, `add-codebuddy-account.ts`) are removed; the npm script entry remains `npm run add-account -- --provider <name> ...`. The new CLI args schema is valibot-validated so unknown flags fail fast.
- **Pioneer upstream provider (`pio/`).** New fourth upstream (`src/proxy/pioneer.ts` + `src/providers/pioneer/`). Pioneer speaks standard OpenAI Chat Completions with `X-API-Key` auth, so the proxy reuses CodeBuddy's OpenAI-SSE bridge to serve both client formats (OpenAI + Anthropic, stream + non-stream). Provider enum extended to `pioneer`, `pio` prefix registered, `selection.pioneer` setting added, dispatch branch in `handleProxy`. Model-id collision fix: both `models.name` and `models.upstream_model` are globally UNIQUE and several Pioneer ids collide with Kiro/CodeBuddy; Pioneer rows are namespaced under `pioneer/` in both columns and `resolveModel` maps the clean `pio/<id>` client prefix to the namespaced row. Full Pioneer dashboard card; `add-account --provider pioneer`. Verified live end-to-end.

### Changed

- **Settings reads are typed by default.** New code should call `getSettingT<K>(db, key)`. The bare `getSetting(db, key)` remains available and is used by tests / dynamic keys, but its `unknown` return type is no longer the right tool for known settings.
- **Audit log is now the canonical trail for sensitive operations.** The client-key reveal flow writes to it; future sensitive actions (password change, key rotation, account delete) are expected to follow the same pattern.
- **Encrypted-DB startup is now self-protecting.** Setting `ROUTER_DB_KEY` against an existing plaintext DB refuses to start with a clear error pointing at the migration path, instead of silently booting an unencrypted DB that ignores the key.
- **Models seed on account-add (startup pre-seed dropped).** Replaced first-startup `autoSeed` of all builtins with per-provider seeding triggered when an account is added. A fresh DB now starts with zero models; adding an upstream key populates exactly that provider's catalogue — MiniMax/Pioneer via live `GET /v1/models`, Kiro/CodeBuddy via builtin lists (`src/db/seedBuiltinModels.ts`). Wired into admin `POST /accounts`, `POST /kiro`, `POST /kiro/poll`, and the CLI add-account dispatcher. `autoSeed.ts` removed and the MiniMax builtin INSERT dropped from `001-initial` (fresh-DB only). Pioneer's redundant seed script removed (live-fetch only).

### Fixed

- **Kiro usage: doubled `Bearer` prefix in `Authorization` header.** `fetchKiroUsage` was unconditionally prepending `Bearer ` to whatever token the caller passed; if a future caller hands in an already-prefixed token the header becomes `Bearer Bearer …` and AWS rejects it. Now strips a single leading `Bearer ` before composing the header, so the function is robust to both raw and prefixed inputs. Caught by a new test that asserts the exact header value.
- **`SseAssemblerBase` had a duplicate `drain()` in its async iterator.** The first drain ran the queue callback machinery; the second ran it again on the same already-empty array, wasting a microtask per `next()` call. The duplicate is gone; throughput on Anthropic-SSE streaming is unchanged in practice but the code path is now correct.
- **Pioneer + CodeBuddy were half-wired despite the proxy dispatch branch existing.** Several layers only knew about MiniMax + Kiro: account-selection settings rejected `selection.pioneer` / `selection.codebuddy` with HTTP 400 (so their selection controls were broken); manual model-add (`POST /api/admin/models`) rejected the two providers; the model health-test collapsed every non-Kiro provider to a MiniMax-shaped request (so testing a Pioneer/CodeBuddy model hit the wrong upstream); and the combo fallback walker had no Pioneer branch, silently routing Pioneer combo members through the MiniMax path. Client-side, the `Provider` union omitted both, the Models page rendered only MiniMax + Kiro cards, the add-model modal title mislabelled them, and the Accounts table badge labelled every non-Kiro account "minimax". All wired through end-to-end now.

### Verification

- 855 backend + 77 client tests pass (`npm test`; `cd client && npm test`).
- `npm run typecheck` clean (root + client).
- 35 atomic conventional commits in the audit-remediation-2026-q2 wave (H1 → H4 → Items 5 → 9), each verified by its own test subset.

## [0.18.0] — 2026-06-14

### Added

- **CodeBuddy provider.** Third upstream alongside MiniMax and Kiro, routed by the `cb/` model prefix. Bridges a CodeBuddy OpenAI-format upstream to the client's chosen format — OpenAI SSE → Anthropic SSE assembler, SSE wrapper + non-stream aggregator, forced `stream_options.include_usage`, guaranteed system message, mid-stream SSE error propagation. Python sidecar for browser automation. Live-verified seed model list (bare model names stored, `cb/` prefix at routing time). `pullQuota` is provider-aware and no-ops for CodeBuddy.
- **Provider prefix routing (`mm/` / `kr/` / `cb/`).** Requests select a provider by an explicit prefix on `body.model`. Prefixed names resolve literally (no alias expansion) and the model's `provider` column must agree, else 400. Unprefixed names resolve only as a combo or alias (strict) — bare raw model names are rejected. Unknown prefix → 400. New `src/providers/modelPrefix.ts` parser; enforcement in `resolveModel`. Combo members must carry a prefix.
- **Combo fallback chains.** New `combos` table + CRUD repository and admin API; dashboard Combos page (CRUD modal + sidebar nav). Proxy walks an ordered member list with cross-provider fallback (MiniMax + Kiro), retrying `401/402/403` and `502/503/504` upstream errors down the chain. Combo names are validated against existing aliases to prevent shadowing.
- **Per-provider account selection.** Selection mode + round-robin step are read per provider (`selection.<provider>`). Multi-mode strategy (lowest-backoff, round-robin, sticky) with configurable step; dashboard splits Accounts and Models into per-provider cards with inline selection controls and health test. Manual model-add and model health-check endpoints.
- **Transport upgrades.** GeoIP country probe on transport add; LRU + SOCKS dispatcher cache invalidated on CRUD; proxy failure mode (`direct` | `block`) toggle surfaced in the Console; bulk transport import modal + "Used by" column.
- **Console & dashboard.** Per-request detail expand (by-req-id endpoint), client-side filter bar (model/account/status), relative timestamps, collapsible blocks (opt-in toggle), RTK bytes-saved on the done line, transport-fail rendering. Real `rtk_bytes_saved` persisted in request logs. Bulk model toggle + client-key label PATCH, alias shadow indicators, Account column on Overview/Usage, inline client-key label editing, Kiro Usage button, model-lock visibility, force-pull quota button.
- **Scheduler.** Prune `request_logs` older than `REQUEST_LOG_RETENTION_DAYS`.

### Changed

- Aliases may now shadow built-in model names.
- Hot-path performance hardening across DB (prepared-statement cache, batched log inserts, additive indexes, tuned PRAGMAs), auth (throttled `last_seen` writes, opportunistic rate-limit sweep), Kiro (hoisted `TextDecoder`, growable SSE buffer, zero-copy slicing), streaming (incremental usage extraction), console (O(1) ring buffer, coalesced stdout sink), and client (scoped re-renders, tiered query defaults, font preload).
- `proxy` now uses `undici.fetch` for dispatcher support on Node 22.

### Fixed

- Clamp invalid round-robin step to `>= 1`; isolate usage cache keys; truncate `base_resp` error messages.
- Combo hardening: guard `JSON.parse` in `rowToCombo`, wrap `updateCombo` in a transaction, map not-found to 404, sync frontend `NAME_RE` with backend, targeted SQL in `checkAliasConflict`.
- CodeBuddy: route direct requests to `handleCodeBuddyProxy`, drop `opus-4.7` from seed, `cb/` prefix consistency.
- `requireAdminJson` accepts `x-admin-key` for script access; skip `listen()` under vitest to avoid `EADDRINUSE`; avoid caching global transport fallback; hide redundant alias when same as model name.

### Verification

- 667/667 server tests pass (`npm test`).
- 25/25 client tests pass (`cd client && npm test`).
- `npm run typecheck` clean (root + client).
- `npm run build` clean.
- Lint baseline: 3 errors / 2 infos (all pre-existing `useTemplate` nits in `codebuddy` tests; down from 20 errors at v0.17).

## [0.17.0] — 2026-06-09

### Added

- **Live Console.** In-process flow event bus (`src/console/`) that streams per-request proxy events to a dashboard page over SSE and to server stdout as colored lines.
  - New module `src/console/`: `types` (`FlowEvent` discriminated union — `start` / `account` / `transport` / `done` / `error`), `bus` (`ConsoleBus` class with a 200-event ring buffer, throwing-subscriber isolation, `consoleBus` singleton), `format` (pure ANSI renderer with `stripAnsi` / `fmtTokens` / `fmtLatency` helpers, exported for tests), `flow` (`genReqId` 4-byte hex + 5 `build*` helpers; error `message` truncated to 200 chars), `sink` (`attachStdoutSink` — gated by `CONSOLE_FLOW=0`, no-op when set).
  - SSE endpoint `GET /api/admin/console/stream` (Hono `streamSSE`, `requireAdmin`) — backfills `consoleBus.recent()` to a new client, then streams live events with a 15-second heartbeat and `stream.onAbort` cleanup on disconnect.
  - Emits wired into both proxy paths in `src/server.ts` (`handleProxy` MiniMax, `handleKiroProxy`) — a shared `reqId` is generated per request, set on the Hono context, and threaded through every emit and every `insertRequestLog*` call. `TransportConfig` `relay` / `proxy` mapped to the `transport` event `kind` (`'relay'` / `'proxy'`) with the URL as `label`. Error path emits `buildError(status, body.slice(0, 200))`; the catch arm uses `c.get('reqId') ?? '----'` so the terminal line still correlates.
  - Migration `004-reqid` (additive) — nullable `req_id` column on `request_logs`; `user_version` advances 3 → 4. Existing rows stay NULL.
  - Dashboard `Console` page (`/admin/console`, Preact) — `EventSource` over the new stream, in-memory event list capped at 600 (≈ 200 request blocks), pure `ConsoleBlocks` group-by-reqId component exported separately for testability. Pause / Clear buttons, live-vs-reconnecting dot, "Waiting for requests…" empty state, auto-scroll-stick that breaks off the bottom on manual scroll. Obsidian Gold styling: gold `reqid`, green ✓ for `done`, red ✗ for `error` or `status >= 400`. Wired into `AppShell` (lazy + `KNOWN_ROUTES` + `g n` hotkey + help modal entry), `Sidebar` (new `console` terminal icon in `Icon.tsx`), and `CommandPalette`.
- 19 new server tests (`bus` 4, `format` 7, `flow` 5, `sink` 2, `sse` 1, `migration-004` 1, `requestlog-reqid` 1, `emit-proxy` 1 integration, `emit-kiro` 1 smoke) and 2 new client tests for `ConsoleBlocks` (summary + error block).

### Changed

- `requestLogs.ts` insert signature gains an optional `req_id` field; existing call sites stay unchanged (field is nullable, no migration required for new rows).

### Verification

- 484/484 server tests pass (`npx vitest run`).
- 21/21 client tests pass (`cd client && npx vitest run`).
- `npm run typecheck` clean.
- `cd client && npm run build` clean.
- Lint baseline unchanged (20 errors / 44 warnings — all pre-existing).

## [0.16.0] — 2026-06-08

### Added

- **Kiro (AWS CodeWhisperer / Amazon Q) as a second upstream provider.** The router is no longer MiniMax-only; requests route by the resolved model's `provider`. MiniMax stays the default and its path is unchanged.
- Additive migration `002-kiro` — `provider` / `access_token` / `token_expires_at` / `provider_data` on `accounts`, `provider` on `models`. Existing rows default to `provider = 'minimax'`.
- New `src/providers/kiro/` modules: `constants` (endpoints, `-thinking` / `-agentic` model resolution, thinking-mode prompt injection), `transform` (OpenAI → CodeWhisperer `conversationState`: tools, tool results, images, system folding), `eventstream` (AWS event-stream binary frame decoder), `assembler` (events → OpenAI SSE chunks + buffered JSON), `anthropicSse` (events → native Anthropic Messages SSE), `tokenRefresh` (AWS SSO OIDC vs Kiro social), `auth` (`ensureAccessToken` — DB-cached, auto-refresh with 5-minute buffer), `index` (executor).
- Native Anthropic streaming for `/v1/messages` (Claude Code, hermes-agent) — `message_start` → `content_block_*` (text / thinking / tool_use) → `message_delta` → `message_stop`. `/v1/chat/completions` streams OpenAI SSE. Both pipe through `pipeWithUsage` for telemetry.
- Full account import: dashboard form or `POST /api/admin/accounts/kiro` — paste credential JSON (Kiro IDE / AWS SSO cache), AWS Builder ID, AWS IAM Identity Center (IDC), or raw refresh token. `buildKiroAccountFields` parses the blob and infers the auth method.
- **OAuth Device Code Flow** for AWS Builder ID / IAM Identity Center (one-click login from the dashboard) — `POST /kiro/device-code` + `POST /kiro/poll`.
- **Auto-import** from Kiro IDE (`~/.aws/sso/cache`) — `GET /kiro/auto-import`.
- `seed-kiro-models` + `add-kiro-account` CLI scripts.
- **Switchable per-account persona** (`ide` ⇄ `cli`) — toggled from the dashboard or `PATCH /api/admin/accounts/:id {persona}`.
  - `ide` (legacy, default) — Kiro IDE path via `codewhisperer.{region}.amazonaws.com` with the aws-sdk-js + `KiroIDE` fingerprint.
  - `cli` (experimental) — mirrors the real `kiro-cli` 2.6.0 wire format **verified byte-for-byte against captured traffic**: `runtime.{region}.kiro.dev` host, `aws-sdk-rust` / `AmazonQ-For-CLI` User-Agent, `application/x-amz-json-1.0`, `origin: KIRO_CLI`, `chatTriggerType: MANUAL`, `agentContinuationId` + `agentTaskType: vibe`, per-message `envState`, no `inferenceConfig`. Model ids are converted to the dotted form the runtime host requires (`claude-sonnet-4-6` → `claude-sonnet-4.6`).
  - **Automatic `profileArn` discovery.** The CLI runtime host rejects requests without a `profileArn`. On first CLI-persona use the router calls `AmazonCodeWhispererService.ListAvailableProfiles` on `management.{region}.kiro.dev` (wire format captured from kiro-cli), then caches the resolved ARN into `provider_data` so discovery runs once.

### Verification

- **Live-verified** against real AWS / Kiro endpoints with a real account — chat, streaming, thinking, and all catalog models return 200.
- 18 new unit tests (constants, transform, event-stream, OpenAI + Anthropic assemblers, account import) + a 4-case end-to-end integration test (`tests/integration/proxy-kiro.test.ts`) that drives the full proxy path against a mocked binary upstream (OpenAI JSON, OpenAI SSE, Anthropic SSE, 503 fallback).

## [0.15.0] — 2026-06-04

### Added

- All-time window for Overview + Usage range selector (`days=0` → no time clause, null deltas). Default range dropped to 1 day.
- Copy full client key — `GET /api/admin/client-keys/:id/key` returns the full plaintext bearer for a per-row Copy button; the list itself stays masked.

### Fixed

- **Quota phantom-block root cause.** The Quota page rendered a duplicate 0% block because the puller stored `model_remains[]` items without a `model_name` (the upstream emits these occasionally) and the frontend grouped them into a phantom `general` pair. Three layers of defense: source (puller skips nameless items), read (admin query filters `model_name IS NOT NULL`), data (legacy NULL-model rows cleaned out).
- **Quota flow fix + redesign.** The puller parsed the wrong upstream shape (flat top-level object) and the few fields it did store were semantically swapped. Live MiniMax `token_plan/remains` and `coding_plan/remains` both return nested `{ model_remains: [ … ] }`. Rewritten as a single shared parser over both endpoints (token_plan → coding_plan fallback). `used_count = usage_count`, `remaining_count = max(0, total − usage)`. Migration 008 (consolidated into the single `001-initial` schema in v0.15) added `model_name`, `remaining_percent`, `remains_time` to `quota_snapshots`. API groups latest snapshots per `(model_name, window_type)`; Quota page redesigned as per-model percent bars (general / video) with reset countdown, status dot, count detail when metered.

### Changed

- **Schema consolidation.** Migrations 002–008 folded into a single `001-initial.ts` containing the full final schema. Legacy upgrade stubs (admin-key, drop-users, drop-thinking) and the dead `repos/users.ts` tombstone removed. Fresh-deploy only — existing DBs upgrade in place (the consolidated schema is a superset). `user_version = 1`.
- **Type tightening.** Shared `OpenAIBody` / `AnthropicBody` / `ContentBlock` types in `src/providers/format/messageTypes.ts` reused by `transform.ts`, `cache-injection.ts`, `caveman/index.ts`, `alias.ts`. All 5 functions in `format/transform.ts` now have typed signatures; `bodyOpenAIToAnthropic` / `bodyAnthropicToOpenAI` / `responseOpenAIToAnthropic` / `responseAnthropicToOpenAI` / `bodyAddsOpenAIStreamUsage` no longer accept or return `any`. Internal `as any` casts inside function bodies remain (low-risk narrowing deferred to a follow-up).
- **Dead field removed.** `schemaVersion: 1` in the seeded `build` setting was an artifact of the old per-step migration system; the real schema version lives in the `user_version` PRAGMA. Reader audit found zero consumers; field removed.
- **Lint debt paid down.** `noExplicitAny` warnings dropped from 19 → 14 (across `format/transform.ts` internals + a few pre-existing `rtk/` and `transport/` instances deferred to a follow-up). `noConfusingVoidType` resolved in `src/api/admin/middleware.ts` by aligning with the `Promise<Response | undefined>` convention already used in `src/auth.ts`.

## [0.14.0] — 2026-06-04

### Added

- All-time window for Usage (`days=0`, null deltas) + 1-day default.
- Per-row Copy full client key (`GET /client-keys/:id/key`, list stays masked).

### Fixed

- Quota flow fix + redesign: parse real MiniMax nested `model_remains[]` shape, fix used/remaining semantic swap, store `remaining_percent` + `remains_time`, admin API groups latest snapshots per `(model_name, window_type)`, Quota page redesigned as per-model percent bars.

## [0.13.0] — 2026-06-04

### Added

- Hot-path latency reduction: batched settings read, skip no-op account writes, throttled lock cleanup, client-key lookup cache, deferred request-log insert, fast-path passthrough.
- `tests/bench/hotpath.bench.test.ts` — warm per-request SQLite statement executions dropped from 8 → 5.

### Fixed

- `stream_options.include_usage` was never actually injected (the helper returned a new object whose return value was discarded at the call site) — now captured and merged, so OpenAI streaming usage/cost tracking works. This makes the v0.8 "auto-injection" claim true.
- `adminApi` captured a stale db handle at import time and overrode the per-request handle — now reads `c.get('db')` from context.
- `resetDb()` now closes the SQLite handle before nulling it (releases Windows file locks; fixes temp-dir cleanup `EPERM` in the test suite).
- Replaced a stale `MiniMax-M3-thinking` proxy test (that behavior was dropped in v0.11 — everything is adaptive) with an adaptive-thinking-injection test.

## [0.12.0] — 2026-06-03

### Added

- **Model aliases.** User-defined model-name → upstream-model mapping.
  - CRUD via `/admin/aliases` dashboard page + `/api/admin/aliases` JSON API.
  - In-memory cache with TTL + cache-bust on write.
  - `requested_model` column on `request_logs` (preserves the alias the client sent).
  - `?target=<model>` deep link from the Models page.
  - `aliasCount` per model surfaced in `/api/admin/models`.
- **Biome linter.** Single tool, lint+format, replacing the need for ESLint + Prettier. `biome.json` at root for `src/`, `tests/`, `scripts/`; `client/biome.json` for the Preact SPA. `npm run lint` / `npm run lint:fix` in both `package.json` files. Strict rules downgraded to `warn` for v0.12 baseline; real fixes in v0.13+.

### Changed

- `CLAUDE.md` polish — new `### Server modules` map (`caveman/`, `rtk/`, `streaming/`, `transport/`, `scheduler/`, `auth/`, `util/`); `db/repos/` inventory; `dev` command corrected to `concurrently`; Obsidian Gold theme paragraph trimmed.
- README refresh — `v0.11` → `v0.12` badge; aliases feature added to the feature list; this roadmap linked from the bottom.

## [0.11.0] — 2026-06-02

### Changed

- **Adaptive thinking.** M3 + docs-listed models default to adaptive thinking. `thinkingEnabled` dropped from `/api/admin/models`; `-thinking` aliases preserved for backwards-compat.

### Added

- **Dashboard SPA rebuild.** Preact + Vite SPA. Obsidian Gold theme (obsidian canvas + single gold accent). Command palette (`⌘K`), keyboard nav (`g` then key), hash-routed pages. `client/dist/` baked into the Docker image.

### Fixed

- Docker entrypoint fix. Work on Windows hosts (CRLF + exec bit on `docker-entrypoint.sh`).

## [0.10.0] — 2026-06-02

### Added

- **Flow gaps.** Five-phase plan covering CSRF / session / security hardening, proxy pipeline cleanup, backend reliability, UI login + a11y, UI navigation + forms. See `docs/superpowers/plans/2026-06-02-flow-gaps*.md`.

## [0.9.0] — 2026-05-31

### Added

- **Foundation.** OpenAI + Anthropic compatibility, multi-account pool with sticky + round-robin selection, prompt caching (cache_control dual breakpoints), RTK + Caveman compression, built-in dashboard, SQLite-WAL, Hono on Node 20+. Six-phase plan: `docs/superpowers/plans/2026-06-01-minimax-router*.md`.

[0.21.0]: https://github.com/aikazu/kelola-router/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/aikazu/kelola-router/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/aikazu/kelola-router/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/aikazu/kelola-router/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/aikazu/kelola-router/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/aikazu/kelola-router/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/aikazu/kelola-router/compare/v0.14...v0.15.0
[0.14.0]: https://github.com/aikazu/kelola-router/compare/v0.13...v0.14.0
[0.13.0]: https://github.com/aikazu/kelola-router/compare/v0.12...v0.13.0
[0.12.0]: https://github.com/aikazu/kelola-router/compare/v0.12-model-aliases...v0.12
[0.11.0]: https://github.com/aikazu/kelola-router/compare/v0.6...v0.11.0
[0.10.0]: https://github.com/aikazu/kelola-router/compare/v0.6...v0.10.0
[0.9.0]: https://github.com/aikazu/kelola-router/compare/v0.5...v0.6
