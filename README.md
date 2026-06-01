# 🛰️ Kelola Router

> Local-first API router for [MiniMax](https://minimax.io) — single provider, multi-account, intelligent fallback, prompt caching, RTK + Caveman compression, and a built-in dashboard.

[![Bun](https://img.shields.io/badge/bun-recommended-f9f1e1?logo=bun&logoColor=black)](https://bun.sh)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Hono](https://img.shields.io/badge/hono-4.x-E36002?logo=hono&logoColor=white)](https://hono.dev)
[![SQLite](https://img.shields.io/badge/sqlite-WAL-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![v0.6](https://img.shields.io/badge/release-v0.6-success)](https://github.com/aikazu/kelola-router/releases/tag/v0.6)

```text
┌──────────┐     ┌──────────────────────────────┐     ┌─────────────┐
│  client  │────▶│        Kelola Router         │────▶│  MiniMax    │
│ (curl,   │     │                              │     │  upstream   │
│  SDK,    │     │  auth → augment → compress   │     │  (intl/cn)  │
│  IDE)    │◀────│  → resolve → select → proxy  │◀────│             │
└──────────┘     └──────────────────────────────┘     └─────────────┘
                           │
                           ▼
                   ┌───────────────┐
                   │  SQLite (WAL) │
                   │  + dashboard  │
                   └───────────────┘
```

## ✨ Features

- 🔌 **Drop-in OpenAI + Anthropic compatibility** — `/v1/chat/completions`, `/v1/messages`, `/v1/messages/count_tokens`, `/v1/models`
- 🛠️ **Tool use passthrough with cross-format conversion** — `tools` / `tool_use` / `tool_calls` flow correctly between client + upstream regardless of which SDK you use (Anthropic SDK ↔ OpenAI SDK ↔ MiniMax upstream)
- 🔀 **Cross-format routing** — set `upstreamFormat` in `settings.minimax` (or `ROUTER_UPSTREAM_FORMAT` env) to route OpenAI clients to Anthropic upstream or vice versa; body + non-stream response converted automatically
- 📺 **OpenAI `stream_options.include_usage` auto-injected** — accurate per-client cost tracking even if the client forgets to set it
- 💡 **`reasoning_split` default** — when set, MiniMax-M3 always returns structured `reasoning_content` + `reasoning_details` (no `<think>` tags in `content`)
- 🔐 **Two-tier auth** — separate `api_key` for proxy traffic, `admin_key` for management routes
- 🧠 **Multi-account state machine** — sticky + round-robin selection, exponential backoff, per-model locks, automatic cooldown on 429/5xx
- 🌍 **Region-aware** — `MINIMAX_REGION=intl|cn` switch
- 🗃️ **SQLite-WAL storage** — zero-config persistence with idempotent migrations
- 📊 **Per-request telemetry** — token usage, latency, cache hits, account attribution
- 👥 **Client keys with per-key usage** — one bearer = one client identity; admin can see per-key breakdown on `/admin/usage`
- 🔁 **Pool fallback across upstream MiniMax keys** — admin adds N MiniMax keys; router fans out + backoffs + locks per-model
- 🪶 **RTK compression + Caveman mode + dual cache injection** — per-setting toggles in dashboard
- 🌊 **SSE stream pass-through** — OpenAI + Anthropic streaming with usage extraction on flush
- ✏️ **Inline CRUD on every page** — enable/disable/delete accounts, client keys, and models without the CLI. Reveal/hide bearer keys in the UI
- 🔐 **Optional dashboard password** — set via `/admin/settings` to lock the dashboard behind a login. Open mode by default for local use
- 🛡️ **Login rate-limit + CSRF** — 5 failed attempts per 15min per IP, cross-origin POSTs blocked
- 🌐 **Fetch from upstream** — `/admin/models` can pull MiniMax's current model list; 404 fallback shows a clear message
- 🛠️ **CLI scripts** — `add-client-key`, `add-account`, `seed-models`, `reset`
- 🧪 **Strict TDD** — 251+ tests, `no any`, every commit verified by `vitest` + `tsc --noEmit`

## 🛣️ Roadmap

| Phase | Version | Status | Scope |
|------:|:--------|:------:|:------|
| 1 | **v0.1** | ✅ shipped | Hono passthrough, 5 routes, smoke test |
| 2 | **v0.2** | ✅ shipped | SQLite, auth, multi-account state machine, CLI |
| 3 | **v0.3** | ✅ shipped | Model registry, alias resolution, tiered pricing, live fetch |
| 4 | **v0.4** | ✅ shipped | RTK compression, Caveman mode, dual cache injection |
| 5 | **v0.5** | ✅ shipped | Quota scheduler, dashboard UI (7 pages), SSE stream usage extraction |
| 6 | **v0.6** | ✅ shipped | Full transport (relay + http/socks + env), Dockerfile, Caddyfile, VPS docs |
| 7 | **v0.7** | ✅ shipped | Drop multi-tenant: client_keys vs accounts split, per-key usage, single-user self-host model |
| 8 | **v0.8** | ✅ shipped | Cross-format tool conversion (OpenAI↔Anthropic), `stream_options.include_usage` auto-injection, MiniMax `base_resp` status code mapping, `/v1/embeddings` → 501, `reasoning_split` toggle |
| 9 | **v0.9** | ✅ shipped | Inline dashboard CRUD, login + rate-limit + CSRF, fetch-models 404 fallback, usage account labels |

## 🚀 Quick Start

### Prerequisites

- **[Bun](https://bun.sh) ≥ 1.3** (recommended for blazing-fast install) **or Node.js ≥ 20**
- A MiniMax API key (`mm_…`) for testing

> **Note:** the dev/test server uses `better-sqlite3` (Node native binding), so the runtime stays on **Node**, not Bun. Bun is recommended for install speed and lockfile benefits.

### Install

```bash
# recommended — ~3x faster
git clone https://github.com/aikazu/kelola-router.git
cd kelola-router
bun install

# or with npm
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
npm run dev          # tsx watch mode
# or
npm run build && npm start
```

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
│   ├── migrations/           # 001-initial, 002-admin-key, 003-drop-users (adds client_keys)
│   └── repos/                # client_keys, accounts, models, requestLogs, quotaSnapshots, settings, users (admin key only)
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
├── dashboard/
│   ├── layout.ts             # shell + nav
│   ├── render.ts             # page() with active-nav class
│   └── pages/                # overview, usage, client-keys, accounts, models, quota, settings
└── scheduler/
    └── quotaPull.ts          # periodic /v1/token_plan/remains puller

scripts/                      # CLI: add-client-key, add-account, seed-models, reset
tests/                        # mirror src/
```

## ⚙️ Configuration

All settings live in the `settings` table and are editable via the dashboard at `/admin/settings`. The `getSetting(db, key)` helper caches values for 1s.

| Key | Default | Purpose |
|-----|---------|---------|
| `rtk` | `{enabled:true,minCompressSize:500,rawCap:10485760}` | RTK compression config (v0.4) |
| `caveman` | `{level:"off"}` | Caveman prompt mode (v0.4) |
| `caching` | `{autoBreakpoints:true,respectCallerMarkers:true}` | Dual cache_control (v0.4) |
| `minimax` | `{upstreamFormat:"auto",reasoningSplitDefault:false,m3DefaultMaxCompletionTokens:131072}` | Cross-format routing + M3 defaults (v0.7) |
| `transport` | `{relay:null,proxy:null}` | Upstream transport (v0.6) |
| `build` | `{version:"0.2.0",schemaVersion:2}` | Self-describe |

Per-user setting `user_settings.account_mode` controls selection: `sticky` (session-pinned) or `round-robin` (default). Sticky key is read from header `x-router-key`. *(deprecated in v0.7 — single-user model)*

## 🧑‍💻 Development

```bash
npm test              # vitest run (251+ tests)
npm run test:watch    # watch mode
npm run typecheck     # strict type check
npm run dev           # tsx watch src/server.ts

# CLI scripts
npm run add-client-key -- --label myapp
npm run add-account -- --label "main" --credit-type payg --api-key mm_xxx
npx tsx scripts/seed-models.ts   # idempotent: upsert 9 builtin MiniMax models
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

## 📜 License

MIT © 2026 aikazu

---

<p align="center">
  <sub>Built with 🛠️ <a href="https://hono.dev">Hono</a> · 💾 <a href="https://github.com/WiseLibs/better-sqlite3">better-sqlite3</a> · 🔒 TypeScript strict mode</sub>
</p>
