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

- 🔌 **Drop-in OpenAI + Anthropic compatibility** — `/v1/chat/completions`, `/v1/messages`, `/v1/messages/count_tokens`, `/v1/embeddings`, `/v1/models`
- 🔐 **Two-tier auth** — separate `api_key` for proxy traffic, `admin_key` for management routes
- 🧠 **Multi-account state machine** — sticky + round-robin selection, exponential backoff, per-model locks, automatic cooldown on 429/5xx
- 🌍 **Region-aware** — `MINIMAX_REGION=intl|cn` switch
- 🗃️ **SQLite-WAL storage** — zero-config persistence with idempotent migrations
- 📊 **Per-request telemetry** — token usage, latency, cache hits, account attribution
- 🛠️ **CLI scripts** — `add-user`, `add-account`, `seed-models`, `reset`
- 🧪 **Strict TDD** — 141+ tests, `no any`, every commit verified by `vitest` + `tsc --noEmit`

## 🛣️ Roadmap

| Phase | Version | Status | Scope |
|------:|:--------|:------:|:------|
| 1 | **v0.1** | ✅ shipped | Hono passthrough, 5 routes, smoke test |
| 2 | **v0.2** | ✅ shipped | SQLite, auth, multi-account state machine, CLI |
| 3 | **v0.3** | ✅ shipped | Model registry, alias resolution, tiered pricing, live fetch |
| 4 | v0.4 | 🔜 next | RTK compression, Caveman mode, dual cache injection |
| 5 | v0.5 | 📋 planned | Quota scheduler, dashboard UI, SSE |
| 6 | **v0.6** | ✅ shipped | Full transport (relay + http/socks + env), Dockerfile, Caddyfile, VPS docs |

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

### Bootstrap a user + account

```bash
# 1. create user (prints api_key + admin_key)
ROUTER_DB_PATH=./data/router.db npm run add-user -- --name alice

# 2. add an account
ROUTER_DB_PATH=./data/router.db npm run add-account -- \
  --user 1 \
  --label "PAYG main" \
  --credit-type payg \
  --api-key mm_your_real_key
```

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

# chat completion (using your api_key from add-user)
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
1. requireApiKey / requireAdmin  → 401/403
2. parse JSON body, resolve model
3. selectAccount(state machine)  → 503 if all unavailable
4. build upstream URL + headers
5. proxyAwareFetch(upstream)     → stream or buffered
6. record telemetry to request_logs
7. update account state (backoff / reset on success)
```

### Directory layout

```
src/
├── server.ts                 # Hono app + listener
├── auth.ts                   # api_key + admin_key middleware
├── accounts/                 # state machine + selection
│   ├── types.ts
│   ├── backoff.ts            # exponential cooldown (1s → 4min cap)
│   ├── errorRules.ts         # 429/2056/2061/5xx cascade
│   ├── state.ts              # apply/reset/filter
│   └── selection.ts          # sticky + round-robin
├── db/
│   ├── index.ts              # openDb (WAL, FK, busy_timeout)
│   ├── migrations/           # 001-initial, 002-admin-key
│   └── repos/                # users, accounts, model_locks
├── providers/                # baseUrl + headers per format
└── transport/                # proxyFetch (direct in v0.1)

scripts/                      # CLI: add-user, add-account
tests/                        # mirror src/
```

## ⚙️ Configuration

All settings live in the `settings` table and are editable via the dashboard (v0.5). For now, edit SQLite directly or seed via migration.

| Key | Default | Purpose |
|-----|---------|---------|
| `rtk` | `{enabled:true,minCompressSize:500,rawCap:10485760}` | RTK compression config (v0.4) |
| `caveman` | `{level:"off"}` | Caveman prompt mode (v0.4) |
| `caching` | `{autoBreakpoints:true,respectCallerMarkers:true}` | Dual cache_control (v0.4) |
| `transport` | `{relay:null,proxy:null}` | Upstream transport (v0.6) |
| `build` | `{version:"0.2.0",schemaVersion:2}` | Self-describe |

Per-user setting `user_settings.account_mode` controls selection: `sticky` (session-pinned) or `round-robin` (default). Sticky key is read from header `x-router-key`.

## 🧑‍💻 Development

```bash
npm test              # vitest run (65 tests)
npm run test:watch    # watch mode
npx tsc --noEmit      # strict type check
npm run dev           # tsx watch src/server.ts
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
