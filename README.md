# 🛰️ Kelola Router

> Local-first API router — MiniMax + Kiro (AWS CodeWhisperer) upstreams, multi-account, intelligent fallback, prompt caching, RTK + Caveman compression, and a built-in dashboard.

[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Hono](https://img.shields.io/badge/hono-4.x-E36002?logo=hono&logoColor=white)](https://hono.dev)
[![SQLite](https://img.shields.io/badge/sqlite-WAL-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![v0.18](https://img.shields.io/badge/release-v0.18-success)](https://github.com/aikazu/kelola-router/releases/tag/v0.18)
[![Tests](https://img.shields.io/badge/tests-692-success?logo=vitest&logoColor=white)](#-development)
[![UI](https://img.shields.io/badge/dashboard-Obsidian%20Gold-C9A352)](#-dashboard)

```text
┌──────────┐     ┌──────────────────────────────┐     ┌────────────────────┐
│  client  │     │        Kelola Router         │ ──▶ │  MiniMax (intl/cn) │
│ (curl,   │ ──▶ │                              │     └────────────────────┘
│  SDK,    │     │  auth → augment → compress   │     ┌────────────────────┐
│  IDE,    │ ◀── │  → resolve → select → proxy  │ ──▶ │  Kiro (AWS Code-   │
│  Claude) │     │       (routed by model)      │     │  Whisperer / Q)    │
└──────────┘     └──────────────────────────────┘     └────────────────────┘
                           │
                           ▼
                   ┌───────────────┐
                   │  SQLite (WAL) │
                   │  + dashboard  │
                   └───────────────┘
```

## ✨ Features

- 🔌 **Drop-in OpenAI + Anthropic compatibility** — `/v1/chat/completions`, `/v1/messages`, `/v1/messages/count_tokens`, `/v1/models`
- 🟣 **Kiro upstream (AWS CodeWhisperer / Amazon Q)** — second provider alongside MiniMax, routed by model. **OAuth Device Code Flow** for AWS Builder ID / IAM Identity Center (one-click login from dashboard), auto-import from Kiro IDE (`~/.aws/sso/cache`), or manual token paste. AWS event-stream binary protocol translated to OpenAI **and native Anthropic SSE** (streaming for Claude Code + hermes-agent). Auto token refresh + caching
- 🛠️ **Tool use passthrough with cross-format conversion** — `tools` / `tool_use` / `tool_calls` flow correctly between client + upstream regardless of which SDK you use (Anthropic SDK ↔ OpenAI SDK ↔ MiniMax upstream)
- 🔀 **Cross-format routing** — set `upstreamFormat` in `settings.minimax` (or `ROUTER_UPSTREAM_FORMAT` env) to route OpenAI clients to Anthropic upstream or vice versa; body + non-stream response converted automatically
- 📺 **OpenAI `stream_options.include_usage` auto-injected** — accurate per-client cost tracking even if the client forgets to set it
- 💡 **`reasoning_split` default** — when set, MiniMax-M3 always returns structured `reasoning_content` + `reasoning_details` (no `<think>` tags in `content`)
- 🔐 **Two-tier auth** — separate `api_key` for proxy traffic, `admin_key` for management routes
- 🧠 **Multi-account state machine** — sticky + round-robin selection, exponential backoff, per-model locks, automatic cooldown on 429/5xx
- 🌍 **Region-aware** — `MINIMAX_REGION=intl|cn` switch
- 🗃️ **SQLite-WAL storage** — zero-config persistence with idempotent migrations
- 🔤 **Model aliases** — user-defined model-name → upstream-model mapping; CRUD via `/admin/aliases`, in-memory cache with TTL, `requested_model` logged per request, `?target=<model>` deep link from Models page, `aliasCount` per model in `/api/admin/models`
- 📊 **Per-request telemetry** — token usage, latency, cache hits, account attribution
- 🖥️ **Live Console** — dashboard page streaming per-request flow events (start → account → transport → done/error) over SSE from a ring-buffered in-process bus, with Pause / Clear / auto-scroll, live/reconnecting indicator, and matching colored lines on server stdout (gated by `CONSOLE_FLOW=0` to silence)
- 👥 **Client keys with per-key usage** — one bearer = one client identity; admin can see per-key breakdown on `/admin/usage`
- 🔁 **Pool fallback across upstream MiniMax keys** — admin adds N MiniMax keys; router fans out + backoffs + locks per-model
- 🪶 **RTK compression + Caveman mode + dual cache injection** — per-setting toggles in dashboard
- 🌊 **SSE stream pass-through** — OpenAI + Anthropic streaming with usage extraction on flush
- ✏️ **Inline CRUD on every page** — enable/disable/delete accounts, client keys, and models without the CLI. Reveal/hide bearer keys in the UI
- 🔐 **Optional dashboard password** — set via `/admin/settings` to lock the dashboard behind a login. Open mode by default for local use
- 🛡️ **Login rate-limit + CSRF** — 5 failed attempts per 15min per IP, cross-origin POSTs blocked
- 🌐 **Fetch from upstream** — `/admin/models` can pull MiniMax's current model list; 404 fallback shows a clear message
- 🎨 **Obsidian Gold dashboard** — Preact SPA (`client/`) with a dark-canvas + single-gold-accent theme, Fraunces/Inter/JetBrains Mono type stack, command palette (`⌘K`), keyboard nav (`g` then key), and live request telemetry
- 🛠️ **CLI scripts** — `add-client-key`, `add-account`, `seed-models`, `reset`
- 🧪 **Strict TDD** — 505 tests, `no any`, every commit verified by `vitest` + `tsc --noEmit`

## 🚀 Quick Start

### Prerequisites

- **Node.js ≥ 20**
- A MiniMax API key (`mm_…`) for testing

### Install

```bash
git clone https://github.com/aikazu/kelola-router.git
cd kelola-router
npm install

cp .env.example .env
# edit .env: set MINIMAX_API_KEY + region
```

### Bootstrap (no CLI required)

Open the dashboard at <http://localhost:20137/>. From there:

1. Add a MiniMax upstream account at `/admin/accounts` (label, credit type, API key)
2. Create a client key for each app at `/admin/client-keys` (label) — copy the bearer
3. Optional: lock the dashboard at `/admin/settings` ("Set password")

The CLI scripts (`npm run add-client-key`, `add-account`, `seed-models`, `reset`) are still available for power users / bulk seeding.

### Run the server

```bash
npm run dev          # runs Hono + Vite dev server (concurrently)
# or
npm run build && npm start
```

The dev server runs:
- **API + proxy** on `http://127.0.0.1:20137` (Hono)
- **Dashboard SPA** on `http://127.0.0.1:5173` (Vite) — proxies `/api`, `/v1`, `/login`, `/logout` to the server

In production (`npm start`), the server serves the static SPA from `client/dist/` on port 20137.

### Make a request

```bash
# health
curl http://127.0.0.1:20137/health

# chat completion (using the client_key from add-client-key)
curl -X POST http://127.0.0.1:20137/v1/chat/completions \
  -H "Authorization: Bearer rk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMax-M3",
    "messages": [{"role":"user","content":"hello"}]
  }'
```

## 🏗️ Architecture

### Per-request pipeline

```
1. requireApiKey / requireAdmin        → 401/403
2. parse JSON body, resolve model
3. selectAccount(state machine)        → 503 if all unavailable
4. check per-model lock                → 429 if locked for this model
5. augment (caveman + cache injection) → mutate body in place
6. compress messages (RTK) if enabled  → log byte savings
7. resolve upstream model + body transform
8. upstreamFetch(url, body)            → stream (pipeWithUsage) or buffered
9. record telemetry to request_logs    → cost, tokens, latency
10. update account state               → backoff / reset / model lock
```

### Directory layout

```
src/
├── server.ts                 # Hono app + listener
├── auth.ts                   # client_key + admin_key middleware
├── util/
│   ├── env.ts                # typed env getters (HOST, PORT, REGION, DB_PATH, LOG_LEVEL)
│   └── log.ts                # pino instance
├── accounts/                 # state machine + selection
│   ├── types.ts
│   ├── backoff.ts            # exponential cooldown (1s → 4min cap)
│   ├── errorRules.ts         # 429/2056/2061/5xx cascade
│   ├── state.ts              # apply/reset/filter/lock-checks
│   ├── selection.ts          # sticky + round-robin
│   └── locks.ts              # per-(account, model) cooldown CRUD
├── db/
│   ├── index.ts              # openDb (WAL, FK, busy_timeout)
│   ├── migrations/           # 001-initial (single consolidated schema) + index runner
│   └── repos/                # client_keys, accounts, models, aliases, requestLogs, quotaSnapshots, settings
├── providers/                # provider-specific behavior
│   ├── minimax.ts            # PROVIDER const, upstreamUrl/Headers helpers
│   ├── baseUrl.ts            # intl vs cn base URL
│   ├── headers.ts            # OpenAI Bearer vs Anthropic x-api-key
│   ├── alias.ts              # model alias + thinking + M3 max_completion_tokens + reasoning_split
│   ├── listModels.ts         # /v1/models fetch + merge
│   ├── pricing.ts            # per-token cost calc (incl cache)
│   ├── parseError.ts         # base_resp.status_code extraction
│   ├── quota.ts              # token-plan quota parser
│   ├── upstreamFetch.ts      # JSON POST wrapper over proxyAwareFetch
│   └── format/               # cross-format body + response conversion
│       ├── transform.ts      # tools/tool_choice/tool_use/tool_calls between OpenAI↔Anthropic
│       └── negotiate.ts      # decide upstream format from client + override
│   └── kiro/                 # Kiro (AWS CodeWhisperer) provider
│       ├── constants.ts      # endpoints, -thinking/-agentic resolution, thinking-mode prompt
│       ├── transform.ts      # OpenAI → CodeWhisperer conversationState
│       ├── eventstream.ts    # AWS event-stream binary frame decoder
│       ├── assembler.ts      # events → OpenAI SSE chunks + buffered JSON
│       ├── anthropicSse.ts   # events → native Anthropic Messages SSE
│       ├── tokenRefresh.ts   # AWS SSO OIDC / Kiro social refresh
│       ├── auth.ts           # ensureAccessToken (DB-cached, auto-refresh)
│       ├── deviceCode.ts     # OAuth Device Code Flow (register + device auth + poll)
│       ├── autoImport.ts     # auto-import from ~/.aws/sso/cache
│       ├── accountImport.ts  # paste JSON / Builder ID / IDC / social
│       └── index.ts          # executeKiro
├── rtk/                      # RTK compression pipeline
│   ├── index.ts              # compressMessages + formatRtkLog
│   ├── applyFilter.ts        # generic filter runner
│   ├── autodetect.ts         # choose filters by content
│   ├── registry.ts           # filter registry
│   ├── constants.ts
│   ├── types.ts
│   └── filters/              # dedupLog, smartTruncate
├── caveman/                  # terse system-prompt injection
│   ├── index.ts
│   └── prompts.ts
├── cache-injection.ts        # dual cache_control + auto-breakpoints
├── streaming/
│   ├── extractUsage.ts       # parse SSE → usage (OpenAI + Anthropic)
│   └── pipeWithUsage.ts      # tee upstream SSE + capture usage on flush
├── transport/                # proxy / relay resolution
│   ├── proxyFetch.ts         # direct | http | socks5 | relay
│   ├── dispatcherCache.ts
│   ├── socksLoader.ts
│   └── types.ts
└── scheduler/
    └── quotaPull.ts          # periodic /v1/token_plan/remains puller

# (the dashboard SPA lives in client/ and is served as static files by server.ts)

client/                       # Preact SPA dashboard (Vite) — see "Dashboard" below
├── src/
│   ├── pages/                # overview, usage, client-keys, accounts, models, quota, settings, login
│   ├── components/           # Card, Stat, Badge, Button, Modal, Toast, CommandPalette, …
│   ├── layout/               # AppShell, Sidebar, TopBar
│   ├── styles/               # base.css (tokens+fonts), components.css, animations.css
│   └── lib/                  # api.ts (fetch wrapper), queryClient, relativeTime
└── public/                   # favicon.svg

scripts/                      # CLI: add-client-key, add-account, seed-models, reset
tests/                        # mirror src/
```

### Lint

```bash
npm run lint          # check (server + client via root config)
npm run lint:fix      # auto-fix
cd client && npm run lint      # client only
cd client && npm run lint:fix  # client auto-fix
```

Biome is the single lint+format tool. Configs at `biome.json` (root) and `client/biome.json` (`"root": false` nested config). Strict rules are `warn` for v0.12 baseline — see [docs/roadmap.md](docs/roadmap.md) for the v0.12 entry.

## 🎨 Dashboard

The dashboard is a standalone **Preact SPA** in `client/` (Vite + preact-router + @tanstack/react-query). The Hono server exposes a JSON API under `/api/admin/*`; in production the built SPA is served as static files from `client/dist/` on port `20137`.

**Theme — Obsidian Gold.** Dark obsidian canvas (`#0A0A0A`) with a single restrained gold accent (`#C9A352`). Type stack: **Fraunces** (display headings, one italic-gold accent word each) · **Inter** (body) · **JetBrains Mono** (labels, metadata, eyebrows). Signature details: a 2px gold-line on the top edge of every card, mono uppercase eyebrows above each title, spec-sheet metadata blocks, and an asymmetric Overview hero. Green (`#6CC3A6`) marks OK status; terracotta (`#D27A6E`) marks errors.

| Page | Path | What it does |
|------|------|--------------|
| Overview | `#/admin` | Hero spend figure, pool status, by-model + recent requests; range selector (1 / 7 / 30 / 90 days / all, default 1 day) |
| Usage | `#/admin/usage` | Filterable, sortable, paginated request log with deltas; range selector (1 / 7 / 30 / 90 days / all, default 1 day) |
| Client keys | `#/admin/client-keys` | Create / enable / disable / delete bearer credentials; copy full key per row |
| Upstream | `#/admin/accounts` | Manage MiniMax + Kiro accounts (OAuth device code, auto-import, manual) |
| Models | `#/admin/models` | Catalog, aliases, fetch-from-upstream |
| Quota | `#/admin/quota` | Token-plan balance windows |
| Settings | `#/admin/settings` | Toggles, password, format override |

Shortcuts: `⌘K` / `Ctrl K` opens the command palette; `g` then a key jumps between pages; `?` shows help.

**Iterating on the UI:** run the Vite dev server for instant hot-reload against the live backend —

```bash
cd client && npm run dev    # http://localhost:5173, proxies /api /v1 /login /logout → :20137
```

> ⚠️ The dashboard on **:20137** is served from the build baked into the Docker image. Changes under `client/src` only appear there after a rebuild:
> ```bash
> docker compose build && docker compose up -d
> ```

## ⚙️ Configuration

All settings live in the `settings` table and are editable via the dashboard at `/admin/settings`. The `getSetting(db, key)` helper caches values for 1s.

| Key | Default | Purpose |
|-----|---------|---------|
| `rtk` | `{enabled:true,minCompressSize:500,rawCap:10485760}` | RTK compression config (v0.4) |
| `caveman` | `{level:"off"}` | Caveman prompt mode (v0.4) |
| `caching` | `{autoBreakpoints:true,respectCallerMarkers:true}` | Dual cache_control (v0.4) |
| `minimax` | `{upstreamFormat:"auto",m3DefaultMaxCompletionTokens:131072}` | Cross-format routing + M3 defaults (v0.7, simplified v0.11) |
| `transport` | `{relay:null,proxy:null}` | Upstream transport (v0.6) |
| `build` | `{version:"0.18.0"}` | Self-describe (auto-synced from package.json on startup) |

Per-user setting `user_settings.account_mode` controls selection: `sticky` (session-pinned) or `round-robin` (default). Sticky key is read from header `x-router-key`. *(deprecated in v0.7 — single-user model)*

## 🧑‍💻 Development

```bash
npm test              # vitest run (505 tests)
npm run test:watch    # watch mode
npm run typecheck     # strict type check
npm run dev           # tsx watch src/server.ts

# CLI scripts
npm run add-client-key -- --label myapp
npm run add-account -- --label "main" --credit-type payg --api-key mm_xxx
npx tsx scripts/seed-models.ts   # idempotent: upsert 9 builtin MiniMax models

# Kiro (AWS CodeWhisperer) upstream
npx tsx scripts/seed-kiro-models.ts                                   # builtin Kiro/Claude models
npm run add-kiro-account -- --label kiro1 --refresh-token eyJ...      # + optional --client-id/--client-secret/--region/--profile-arn
npx tsx scripts/reset.ts --yes   # delete db + WAL/SHM sidecars
```

### Commit conventions

- `feat:` new feature
- `fix:` bug fix
- `chore:` tooling, deps, non-code
- `test:` test-only changes
- `docs:` documentation
- `refactor:` internal restructure, no behavior change

TDD discipline: red test → green impl → commit. No "add tests later".

## 🐳 Docker

```bash
docker compose up -d
docker compose logs -f
```

Listens on `http://127.0.0.1:20137` by default (bind to localhost for safety; remove `127.0.0.1:` in `docker-compose.yml` to expose publicly).

## 🌐 VPS Deploy (Hetzner / OVH / DigitalOcean)

1. SSH into VPS, install Docker + Caddy
2. `git clone https://github.com/aikazu/kelola-router.git && cd kelola-router`
3. Edit `Caddyfile` — replace `router.example.com` with your domain
4. `docker compose up -d`
5. `caddy reload` — auto-TLS via Let's Encrypt
6. Visit `https://router.example.com/admin` and use your admin_key

## 🚇 Transport

The router supports 4 transport modes, in priority order:

1. **Direct** (default) — no config
2. **HTTP/HTTPS proxy** — set `HTTPS_PROXY=http://host:port` env
3. **SOCKS5 proxy** — set `HTTPS_PROXY=socks5://host:port` env
4. **Relay** (Vercel/Cloudflare) — set `transport.relay` row in `settings` table:
   ```sql
   UPDATE settings SET value = '{"relay":{"kind":"vercel","url":"https://your-relay.vercel.app/api/relay"}}' WHERE key = 'transport';
   ```

Use `NO_PROXY=localhost,127.0.0.1` to bypass for local targets.

## 🛣️ Roadmap

| Phase | Version | Status | Scope |
|------:|:--------|:------:|:------|
| 18 | **v0.18** | ✅ shipped | **CodeBuddy provider + provider-prefix routing.** Third upstream (CodeBuddy, `cb/` prefix) bridging an OpenAI upstream to client format (OpenAI SSE → Anthropic SSE assembler, forced `include_usage`, mid-stream error propagation, Python browser-automation sidecar). Explicit provider prefixes `mm/` / `kr/` / `cb/` on `body.model` (`src/providers/modelPrefix.ts`): prefixed → literal lookup with `provider` agreement, unprefixed → combo/alias only (strict), bare names rejected. **Combo fallback chains** — `combos` table + CRUD + dashboard page, ordered cross-provider member walk retrying `401/402/403` + `5xx`. **Per-provider account selection** (`selection.<provider>`: lowest-backoff / round-robin+step / sticky), Accounts + Models split into per-provider cards with health test + manual add. **Transport** geoip country probe, LRU + SOCKS dispatcher cache, proxy failure mode (`direct`\|`block`). Console per-request detail, filter bar, relative timestamps, RTK bytes-saved; `request_logs` retention pruning. Broad hot-path perf hardening (DB prepared-stmt cache + indexes + PRAGMAs, Kiro buffer reuse, client re-render scoping) |
| 17 | **v0.17** | ✅ shipped | **Live Console** — in-process flow event bus + SSE stream + dashboard page. `src/console/` modules: `bus.ts` (200-event ring buffer + throwing-subscriber isolation), `format.ts` (pure ANSI renderer with `stripAnsi` / `fmtTokens`), `flow.ts` (5 event builders + `genReqId`), `sink.ts` (env-gated stdout writer, `CONSOLE_FLOW=0` to silence). Both proxy paths (`handleProxy` MiniMax + `handleKiroProxy`) emit `start` / `account` / `transport` / `done` / `error` events with a shared `reqId`; log inserts carry the same `reqId`. `GET /api/admin/console/stream` (Hono `streamSSE`) backfills recent + live + 15s heartbeat. Migration `004-reqid` adds nullable `req_id` on `request_logs` (additive; `user_version = 4`). Dashboard `Console` page (`/admin/console`, hotkey `g n`, palette entry) — `EventSource` → grouped blocks by `reqId` (start / account / transport / done / error lines), Pause / Clear / auto-scroll-stick, live dot. +19 tests: 4 `bus`, 7 `format`, 5 `flow`, 2 `sink`, 1 `sse` (backfill), 1 `migration-004`, 1 `requestlog-reqid` roundtrip, 1 `emit-proxy` integration, 1 `emit-kiro` smoke; 423 → 484 server tests, 19 → 21 client tests. Server stdout gets the same lines colored (gold reqid, green ✓, red ✗) by default |
| 16 | **v0.16** | ✅ shipped | Kiro (AWS CodeWhisperer / Amazon Q) as a second upstream provider, routed by model `provider`. Additive migration `002-kiro` (`provider`/`access_token`/`token_expires_at`/`provider_data` on accounts, `provider` on models). New `src/providers/kiro/` modules: CodeWhisperer request transform, AWS event-stream binary decoder, OpenAI SSE + **native Anthropic Messages SSE** assemblers (Claude Code/hermes streaming), token refresh (AWS SSO OIDC / Kiro social) with DB-cached auto-refresh. Account import — paste credential JSON / AWS Builder ID / AWS IAM Identity Center / refresh token — via `POST /api/admin/accounts/kiro` + dashboard form. **OAuth Device Code Flow** for AWS Builder ID / IAM Identity Center (one-click login from dashboard): `POST /kiro/device-code` + `POST /kiro/poll`. **Auto-import** from Kiro IDE (`~/.aws/sso/cache`): `GET /kiro/auto-import`. `seed-kiro-models` + `add-kiro-account` CLI. **Switchable per-account persona** — `ide` (legacy, default; `codewhisperer.*.amazonaws.com` + KiroIDE fingerprint) ⇄ `cli` (experimental; `runtime.*.kiro.dev` mirroring the real kiro-cli wire format, verified against captured traffic) toggled from the dashboard or `PATCH /accounts/:id {persona}`, with CLI model-id dotting + automatic `profileArn` discovery via `ListAvailableProfiles`. **Live-verified** against real AWS/Kiro endpoints. 18 unit tests + end-to-end proxy integration test (mocked binary upstream) |
| 15 | **v0.15** | ✅ shipped | Quota duplicate-block fix: puller now skips `model_remains[]` items with no `model_name` and the admin query filters `model_name IS NOT NULL`, so legacy NULL-model rows can no longer render as a phantom 0% block. Schema consolidation: migrations 002–008 folded into a single `001-initial` (full schema, `user_version = 1`); legacy upgrade stubs + dead `repos/users.ts` removed — fresh-deploy only |
| 14 | **v0.14** | ✅ shipped | Usage all-time range (`days=0`, null deltas) + 1-day default; per-row Copy full client key (`GET /client-keys/:id/key`, list stays masked). Quota flow fix + redesign: parse real MiniMax nested `model_remains[]` shape (old parser read a flat shape → "no data"), fix used/remaining semantic swap (`used_count = usage_count`, `remaining_count = total − usage`), store `remaining_percent` + `remains_time` (consolidated into the single `001-initial` schema in v0.15); admin API groups latest snapshots per `(model_name, window_type)`; Quota page redesigned as per-model percent bars (general/video) with reset countdown, status dot, count detail when metered |
| 13 | **v0.13** | ✅ shipped | Hot-path latency cuts (warm SQLite statement executions per request 8 → 5): batched settings read, skip no-op account writes, throttled lock cleanup, client-key lookup cache, deferred request-log insert (off the response path via `setImmediate`), fast-path raw-body passthrough when no transform applies; fixed `stream_options.include_usage` injection (return value was discarded), `adminApi` per-request db handle, `resetDb` closing the handle |
| 12 | **v0.12** | ✅ shipped | Model aliases (CRUD, cache, `requested_model` log); Biome linter (root + client, `lint`/`lint:fix` scripts); roadmap → `docs/roadmap.md` |
| 11 | **v0.11** | ✅ shipped | Adaptive thinking: collapse `-thinking` built-ins into base models via allowlist, `thinking.type: "adaptive"` auto-inject, `reasoning_split` follows thinking presence, drop `thinking_enabled`/`thinking_budget` columns, legacy `-thinking` aliases still resolve |
| 10 | **v0.10** | ✅ shipped | Dashboard rebuilt as a Preact SPA (`client/`) with the Obsidian Gold theme: gold-line cards, eyebrow labels, asymmetric Overview hero, monogram favicon |
| 9 | **v0.9** | ✅ shipped | Inline dashboard CRUD, login + rate-limit + CSRF, fetch-models 404 fallback, usage account labels |
| 8 | **v0.8** | ✅ shipped | Cross-format tool conversion (OpenAI↔Anthropic), `stream_options.include_usage` auto-injection, MiniMax `base_resp` status code mapping, `/v1/embeddings` → 501, `reasoning_split` toggle |
| 7 | **v0.7** | ✅ shipped | Drop multi-tenant: client_keys vs accounts split, per-key usage, single-user self-host model |
| 6 | **v0.6** | ✅ shipped | Full transport (relay + http/socks + env), Dockerfile, Caddyfile, VPS docs |
| 5 | **v0.5** | ✅ shipped | Quota scheduler, dashboard UI (7 pages), SSE stream usage extraction |
| 4 | **v0.4** | ✅ shipped | RTK compression, Caveman mode, dual cache injection |
| 3 | **v0.3** | ✅ shipped | Model registry, alias resolution, tiered pricing, live fetch |
| 2 | **v0.2** | ✅ shipped | SQLite, auth, multi-account state machine, CLI |
| 1 | **v0.1** | ✅ shipped | Hono passthrough, 5 routes, smoke test |

For the full release history including upcoming ideas, see [docs/roadmap.md](docs/roadmap.md).

## 📜 License

MIT © 2026 aikazu

---

<p align="center">
  <sub>Built with 🛠️ <a href="https://hono.dev">Hono</a> · ⚛️ <a href="https://preactjs.com">Preact</a> · 💾 <a href="https://github.com/WiseLibs/better-sqlite3">better-sqlite3</a> · 🔒 TypeScript strict mode</sub>
  <br/>
  <sub>🎨 Dashboard theme: <b>Obsidian Gold</b> — dark canvas, single gold accent</sub>
</p>
