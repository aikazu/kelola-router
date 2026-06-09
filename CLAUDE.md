# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`kelola-router` — local-first API router. Single-user self-host model. OpenAI + Anthropic compatible proxy, multi-account pool with fallback, prompt caching, model aliases, RTK + Caveman compression, built-in dashboard. SQLite (WAL) for state. Hono on Node 20+.

**Upstream providers** (routed by the resolved model's `provider` column):
- **MiniMax** (default) — [minimax.io](https://minimax.io), API-key bearer, HTTP-JSON.
- **Kiro** (AWS CodeWhisperer / Amazon Q) — OAuth refresh-token auth, AWS event-stream binary protocol, translated to/from OpenAI + Anthropic. See "Kiro provider" below.

## Commands

```bash
npm run dev          # concurrently: server (tsx watch :20137) + client (vite :5173)
npm run dev:server   # backend only (tsx watch src/server.ts, port 20137)
npm run dev:client   # frontend only (cd client && vite, port 5173)
npm run build        # vite build client + tsc -> dist/
npm start            # node dist/server.js
npm test             # vitest run (server; all tests)
npm run test:client  # vitest run (client SPA)
npx vitest run path/to/foo.test.ts   # single file
npx vitest run -t "name"             # single test by name pattern
npm run test:watch   # vitest watch mode
npm run typecheck    # tsc --noEmit (strict, no any)
npm run lint         # biome check .
npm run lint:fix     # biome check --write .
```

Runner: `npm` only (engine: `node>=20`). Use `npm`/`npm ci` for install; `package-lock.json` is the lockfile.

CLI scripts (power-user; dashboard covers these):
```bash
npm run add-client-key -- --label myapp
npm run add-account   -- --label "PAYG main" --credit-type payg --api-key mm_xxx
npm run seed-models                # idempotent: upsert 18 builtin models
npm run reset                      # rm db + WAL/SHM sidecars
npm run seed-kiro-models           # idempotent: upsert builtin Kiro (Claude/AWS) models
npm run add-kiro-account -- --label kiro1 --refresh-token eyJ...   # + optional --client-id/--client-secret/--region/--profile-arn
```

Docker:
```bash
docker build -t kelola-router:latest .
docker compose up -d                # serves from baked client/dist on :20137
```

Prod reverse proxy: `Caddyfile` at repo root (HTTPS + gzip/zstd in front of :20137).

## Architecture

### Request pipeline (proxy)

`src/server.ts` — Hono app. 24+ routes. Middleware: `requireApiKey` (Bearer) for `/v1/*`, `requireAdmin` for `/admin/*`, `verifySameOrigin` CSRF guard on `/admin/*` POSTs.

Per-request path inside `handleProxy(c, format, upstreamPath)`:
1. `parseBody` + model resolution (alias + thinking + M3 max-completion-tokens)
2. `selectAccount` (state machine: sticky + round-robin, skips backoff/locked/disabled)
3. Per-model lock check (returns 429 if locked for this model)
4. `augment` — caveman system-prompt + cache_control dual breakpoints
5. RTK compression if enabled (logs bytes saved)
6. `bodyOpenAIToAnthropic` or `bodyAnthropicToOpenAI` per `settings.minimax.upstreamFormat`
7. `upstreamFetch` → SSE pipe via `streaming/pipeWithUsage` or buffered response
8. Format-convert response back to client format
9. `insertRequestLog` (cost, tokens, latency, account_id, client_key_id, `requested_model` = the alias the client sent if any)
10. `applyAccountError` — base_resp.status_code mapping, backoff, model lock

### Two-tier separation

- **`client_keys`** — bearer credentials for clients (Claude Code, hermes-agent). One per app. Per-key usage.
- **`accounts`** — upstream MiniMax API keys. Pool of N for fallback + quota. Each has credit_type (`payg` or `token-plan`).

Never mix these. Client never sees upstream keys; upstream never sees client bearers.

### Auth model (v0.9 → v0.13 unchanged)

Dashboard has 3 modes cascading in `requireAdmin`:
1. Session cookie (`kelola_session`) — only if password is set
2. `x-admin-key` header matching `ROUTER_ADMIN_KEY` env (for scripts)
3. Open mode — if no password is set, anyone with the URL gets in

`POST /login` is rate-limited (`src/auth/rateLimit.ts` — 5/15min/IP, in-memory bucket). Set password via dashboard `/admin/settings` (scrypt-hashed, stored in `settings.admin_password`). Sessions in `sessions` table (7-day TTL).

### OpenAI ↔ Anthropic format conversion

Client format detected from `Authorization: Bearer` shape or route. Body converted in `src/providers/format/transform.ts` (tools, tool_choice, tool_use ↔ tool_calls, system, finish_reason ↔ stop_reason). `stream_options.include_usage=true` auto-injected for OpenAI streaming so cost tracking works without client cooperation.

### MiniMax-specific quirks

- `base_resp.status_code` lives inside the JSON body, not the HTTP status. `src/providers/parseError.ts` extracts it. `src/accounts/errorRules.ts` maps: 1002→backoff, 1008→balance-permanent, 1013→5s, 1027→backoff, 1039→token-limit, 2013→param.
- `MINIMAX_REGION=intl|cn` switches base URL (`src/providers/baseUrl.ts`).
- `reasoning_split` (settings.minimax): when on, M3 returns structured `reasoning_content` instead of `<think>` tags in content.

### Kiro provider (`src/providers/kiro/`)

Kiro = AWS CodeWhisperer / Amazon Q. Not MiniMax-shaped — a separate provider path branched in `handleProxy` (`src/server.ts`) when the resolved model's `provider === 'kiro'` → `handleKiroProxy`.

- **Auth.** A Kiro `accounts` row stores its OAuth **refresh token** in `api_key`, the cached bearer in `access_token`, expiry in `token_expires_at`, and SSO/OIDC fields in `provider_data` JSON. `auth.ensureAccessToken` returns a valid bearer, refreshing + persisting when within a 5-min buffer. `tokenRefresh.refreshKiroToken` picks AWS SSO OIDC (`oidc.{region}.amazonaws.com/token`, when `clientId`+`clientSecret` present) vs Kiro desktop social (`prod.us-east-1.auth.desktop.kiro.dev/refreshToken`).
- **Request.** `transform.buildKiroPayload` converts an OpenAI body to CodeWhisperer `conversationState` (system/tool folded to user turns, tools → `toolSpecification`, images, `-thinking` injects `<thinking_mode>enabled</thinking_mode>`, `-agentic` injects the chunked-write prompt; suffixes stripped before upstream).
- **Response.** Upstream replies in the AWS event-stream **binary** framing. `eventstream.decodeFrames` parses frames; `assembler` re-emits OpenAI SSE chunks / buffered `chat.completion`; `anthropicSse` re-emits native Anthropic Messages SSE (`message_start` → `content_block_*` for text/thinking/tool_use → `message_delta` → `message_stop`). `index.executeKiro` ties it together; `handleKiroProxy` converts per client format and pipes via `pipeWithUsage`.
- **Account import.** `accountImport.buildKiroAccountFields` builds the row from a pasted credential JSON (Kiro IDE / AWS SSO cache) or explicit fields; methods: `token` / `builder-id` / `idc` / `social`. Exposed at `POST /api/admin/accounts/kiro` and the dashboard Accounts form.
- **Models.** Seeded via `scripts/seed-kiro-models.ts` with `provider='kiro'`, `family='kiro'`; synthetic `-thinking` / `-agentic` / `-thinking-agentic` variants keep their suffix in `upstream_model` (the executor strips it).
- **Not yet live-verified.** Wire format + refresh modelled on a known-good reference; confirm against a real Kiro account before relying on it.

### Dashboard

`client/` — standalone Preact SPA (Vite + preact-router + @tanstack/react-query), served as static assets from `client/dist/` (built in the Docker build stage, copied to runtime). NOT server-rendered; the Hono app exposes a JSON API under `/api/admin/*` that the SPA consumes via `client/src/lib/api.ts`.

- Entry: `client/index.html` → `client/src/main.tsx` → `App.tsx` → `layout/AppShell.tsx` (hash-routed: `#/admin/<page>`).
- Pages: `client/src/pages/` (Overview, Usage, ClientKeys, Accounts, Aliases, Models, Quota, Settings, Login, RequestDetail, Console, NotFound, Placeholder). Console is a live terminal of the request flow via SSE (`/api/admin/console/stream`). Models page shows `aliasCount` per model; Aliases page deep-links via `?target=<model>`. Overview + Usage share a range selector (1/7/30/90 days + all) defaulting to 1 day; `days=0` query param means all-time (no time clause in `aggregateUsage`, null deltas). ClientKeys has a per-row Copy button hitting `GET /api/admin/client-keys/:id/key` (full plaintext key; list stays masked). Quota page renders one block per model (general, video) with 5h + weekly percent bars driven by `remaining_percent`, count detail (`used/total`) only when metered, and a "resets in …" countdown from `remains_time` (`forwardDuration` in `client/src/lib/relativeTime.ts`); `/api/admin/quota` groups latest snapshots per `(model_name, window_type)`.
- Components: `client/src/components/` (Card, Stat, Badge, Button, Modal, Toast, CommandPalette, etc.).
- Styling: `client/src/styles/` — `base.css` (tokens + fonts), `components.css` (component layer), `animations.css`.

**Theme — Obsidian Gold.** Canvas `#0a0a0a` + single gold accent `#c9a352`. Type stack: Fraunces (display, italic gold `<em>` accent on headlines), Inter (body), JetBrains Mono (labels). Signals: `--signal #6cc3a6` OK only, `--alert #d27a6e` errors. Gold stays sparse — one accent per moment. Legacy `--ink-*`/`--emerald-*`/`--gold-N` vars aliased in `base.css` for stray inline styles.

Dev loop: `cd client && npm run dev` (port 5173, proxies `/api` `/login` `/logout` `/v1` to the running router on :20137). Hot-reload against live backend data — no Docker rebuild needed while iterating. **The deployed dashboard on :20137 is served from the Docker container's baked `client/dist`; changes to `client/src` only appear there after `docker compose build && docker compose up -d`.**

### Server modules

- `src/proxy/` — request capture helpers used by `handleProxy`.
- `src/caveman/` — system-prompt compression (prompts + index). Wired in proxy step 4.
- `src/rtk/` — runtime filter compression (autodetect → registry → filters). Wired in proxy step 5.
- `src/streaming/` — SSE pipe + usage extraction (`pipeWithUsage`, `extractUsage`).
- `src/console/` — live flow bus (`bus.ts` ring buffer), stdout sink (`sink.ts`, env `CONSOLE_FLOW`), ANSI renderer (`format.ts`), event builders (`flow.ts`). Emits FlowEvents at proxy phases (start/account/transport/done/error); SSE at `GET /api/admin/console/stream`; dashboard Console page renders grouped blocks.
- `src/transport/` — undici dispatcher cache + SOCKS proxy loader for upstream fetch.
- `src/scheduler/` — `quotaPull.ts` background quota refresh.
- `src/auth/` — session, password (scrypt), rate limit.
- `src/util/` — env, log.

### Storage

`src/db/index.ts` — `openDb()` opens (or creates) `~/.local/share/kelola-router/router.db` (or `ROUTER_DB_PATH` override; Docker mounts `/data/router.db`), sets `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`. Migrations: `src/db/migrations/` — single `001-initial.ts` holding the full consolidated schema (accounts, account_model_locks, client_keys, request_logs incl. bodies/headers/`requested_model`, quota_snapshots incl. `model_name`/`remaining_percent`/`remains_time`, models w/ unique `upstream_model` index, model_aliases, sessions, settings) + `index.ts` runner. Tracked via `user_version` PRAGMA (current = 4). Migrations run in order, skipping any `id <= user_version`. `002-kiro.ts` is additive (`ALTER TABLE ADD COLUMN`): `provider`/`access_token`/`token_expires_at`/`provider_data` on `accounts`, `provider` on `models` — existing MiniMax DBs upgrade in place. `003-transports.ts` is additive: new `transports` table (proxy/relay endpoints) + `relay_id`/`proxy_id`/`proxy_pool`/`proxy_rotate_every` on `accounts` for per-account transport assignment. `004-reqid.ts` is additive: nullable `req_id` on `request_logs` correlating a row to a console flow block.

Repos: `src/db/repos/` — `settings.ts` (1s cache, exposes `clearCache()`), `accounts.ts`, `client_keys.ts`, `models.ts` (+ alias CRUD), `aliases.ts`, `requestLogs.ts`, `quotaSnapshots.ts`, `transports.ts` (proxy/relay CRUD).

### Per-account transports (proxy pool + relay)

`src/transport/resolve.ts` — `resolveTransportForAccount(db, account)` returns the `TransportConfig` for a single request. Priority: `relay_id` (relay, mutually exclusive with proxy) > `proxy_pool` (round-robin, advancing every `proxy_rotate_every` requests, skipping disabled members) > `proxy_id` (single proxy) > global `settings.transport` (legacy fallback) > direct (null). Pool rotation state is in-memory (`Map<accountId, {cursor,count}>`), resets on restart by design — no per-request DB write. Wired into all 3 upstream-fetch sites in `server.ts` (was global `getSetting('transport')`). Admin API: `src/api/admin/transports.ts` (CRUD + `POST /:id/test` connectivity check). Accounts PATCH accepts `relayId`/`proxyId`/`proxyPool`/`proxyRotateEvery`. Dashboard: `client/src/pages/Transports.tsx` (Proxies nav) + transport selector in the Accounts edit modal.

Settings cache: `getSetting` caches for 1s. **Call `clearCache()` from `src/db/repos/settings.ts` in tests** when changing settings mid-test.

### Conventions

- **Strict TDD**: red test → green impl → commit. No "add tests later". Tests mirror source layout under `tests/` for integration, `src/**/*.test.ts` for unit.
- **No `any`**, `const` over `let`, early returns over nested if/else.
- **Conventional commits** (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`).
- **`better-sqlite3` returns `undefined` for missing rows**, not `null`. Repo functions coerce to `null` via `?? null` to honor their `T | null` signatures — tests rely on this.
- **Commit after every meaningful change** (~300 LOC max per commit).
- **Never push without asking** the user.

### Test patterns

- Use `process.env.ROUTER_DB_PATH = join(mkdtempSync(...), "t.db")` in `beforeEach` to isolate each test.
- Call `resetDb()` from `src/server.ts` to reset Hono app DB handle.
- Mock upstream with `vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(...))` — must use `mockImplementation` (not `mockResolvedValueOnce`) if test calls fetch multiple times since Response bodies are single-read.
- CSRF middleware blocks cross-origin POSTs: integration tests for `/admin/*` POSTs must set `Origin` matching `Host` or omit `Origin` entirely.
