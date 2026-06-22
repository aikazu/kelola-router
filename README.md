# Kelola Router

> Local-first API router for **MiniMax**, **Kiro (AWS CodeWhisperer / Amazon Q)**, **CodeBuddy**, **Pioneer**, **Notion**, and **Z.AI**: provider-prefix routing, multi-account pool, combo fallback, prompt caching, RTK + Caveman compression, live request-flow console, and a built-in Preact dashboard.

[![Node >=20](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript 5.x](https://img.shields.io/badge/typescript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Hono](https://img.shields.io/badge/hono-server-E36002?logo=hono&logoColor=white)](https://hono.dev)
[![SQLite (WAL)](https://img.shields.io/badge/sqlite-WAL-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/wal.html)
[![License MIT](https://img.shields.io/badge/license-MIT-c9a352)](#license)
[![Release v0.22.0](https://img.shields.io/badge/release-v0.22.0-c9a352?logo=github)](https://github.com/aikazu/kelola-router/releases/tag/v0.22.0)
[![Tests 1000+](https://img.shields.io/badge/tests-1000%2B-22c55e)](./tests)
[![UI Obsidian Gold](https://img.shields.io/badge/ui-obsidian%20gold-c9a352)](#dashboard)

`#c9a352` is the accent gold used across the dashboard, badges, and log highlights.

---

## Architecture at a glance

```
                          +---------------------+
   OpenAI / Anthropic --> |   Hono proxy        | <-- /v1/chat/completions
   /v1/messages client    |   (src/server.ts)   |     /v1/messages
                          +----------+----------+
                                     |
        +--------------+-------------+----------------+---------------+
        |              |             |                |               |
        v              v             v                v               v
  +-----------+  +-----------+ +-----------+   +-----------+   +-----------+
  | provider  |  | account   | | transport |   | streaming |   | RTK +     |
  | selection |  | state +   | | (proxy/   |   | SSE pipe  |   | Caveman   |
  | (sticky,  |  | backoff + | | relay/    |   | + usage   |   | compress  |
  | round-    |  | locks)    | | direct)   |   | extractor |   | filters   |
  | robin)    |  |           | |           |   |           |   |           |
  +-----------+  +-----------+ +-----------+   +-----------+   +-----------+
        |              |             |                |               |
        +------+-------+-------------+-----+----------+-------+
               |                                 |
               v                                 v
        +---------------+                +----------------+
        | format/       |                | upstream       |
        | transform +   |                | HTTP via       |
        | negotiate     |                | proxyAwareFetch|
        | (OpenAI<->    |                |                |
        |  Anthropic)   |                +-------+--------+
        +---------------+                        |
                                                 v
                            +----------------------------------+
                            |   Upstream providers (6)         |
                            |                                  |
                            |   🟧 MiniMax        (mx/)         |
                            |   🟣 Kiro (AWS Q)   (kr/)        |
                            |   🟦 CodeBuddy      (cb/)        |
                            |   🟢 Pioneer        (pio/)       |
                            |   🌸 Notion         (nt/)        |
                            |   ⚪  Z.AI          (zai/)       |
                            +----------------------------------+
```

All six upstreams live behind a single OpenAI-compatible or Anthropic-compatible endpoint. Account selection, transport, prompt caching, RTK + Caveman compression, and live request-flow events are handled inside the router.

---

## Features

- **Six upstream providers**: MiniMax, Kiro (AWS CodeWhisperer / Amazon Q), CodeBuddy, Pioneer, Notion, and Z.AI behind a single URL.
- **Provider-prefix routing**: `mm/MiniMax-M3`, `kr/claude-sonnet-4.5`, `cb/gpt-5`, `pio/...`, `nt/...`, `zai/...`. Aliases and combos translate user-facing model names to any of the six upstreams.
- **Multi-account pool with state machine**: sticky + round-robin selection per provider, exponential backoff (1s → 4min cap), per-(account, model) cooldown locks, and error rules for 429 / 2056 / 2061 / 5xx cascades.
- **OpenAI ↔ Anthropic wire-format negotiation**: clients speak either protocol; the router translates per upstream (Kiro EventStream binary, Notion CRDT NDJSON, Z.AI dual API).
- **RTK compression pipeline**: `compressMessages` with `dedupLog` + `smartTruncate` filters, runtime registry, autodetect, and per-request RTK log surfaced in the console.
- **Caveman terse system-prompt injection**: optional off / light / strong prompt mutation per request.
- **Dual cache_control + auto-breakpoints**: Anthropic-style prompt caching, automatic breakpoint insertion when callers omit markers, respects caller-provided markers.
- **Live request-flow console**: every step (selection, transport, upstream, error) emits a flow event you can tail in the dashboard or via `CONSOLE_FLOW=stdout`.
- **Scheduler / quota puller**: periodic `POST /v1/token_plan/remains` for Kiro-style quota tracking, persisted in `quota_snapshots`.
- **Auth + security**: scrypt password hashing + session cookies, CSRF, 5-fail-per-15min rate limit, optional SQLCipher encryption-at-rest, admin audit log, security banner.
- **Built-in Preact dashboard**: Obsidian-Gold-themed SPA (Vite) with Overview, Usage, Client keys, Upstream accounts, Models, Aliases, Combos, Quota, Transports, Console, and Settings.
- **Transport flexibility**: direct / SOCKS proxy / HTTP proxy / upstream relay, per-account assignment with geoip-aware defaulting, dispatcher cache.
- **Docker-ready**: multi-stage Dockerfile, `docker-compose.yml`, bind-mount friendly, `recover-db.ts` for WAL race recovery.
- **1000+ tests** across server (Vitest, 160 files), client (Vitest, 83 tests), and the audit-fixes suite (14 new tests).
- **Audit-fixes v0.22.0**: quota uses `Promise.allSettled` for parallel per-account fetch with per-account error shape, settings GET returns `null` for missing keys (client merges UI defaults), admin cache 250ms TTL with explicit `bumpAdminCacheVersion` invalidation from `flushDb`, combo/alias name uniqueness enforced both directions (`checkComboConflict` exported), and `upsertAlias` UPDATE branch now sets `source`.

---

## Quick start

### Prerequisites

- Node.js >= 20
- A SQLite build (libsqlite3), bundled via `better-sqlite3`
- Accounts for at least one upstream:
  - **MiniMax**: MiniMax API key
  - **Kiro (AWS CodeWhisperer / Amazon Q)**: Social auth or IdC, Kiro refresh token
  - **CodeBuddy**: CodeBuddy bearer cookie
  - **Pioneer**: Pioneer API key (Anthropic-compatible)
  - **Notion**: Notion internal integration token
  - **Z.AI**: Z.AI API key (OpenAI-compatible)

### Bootstrap

```bash
git clone https://github.com/aikazu/kelola-router.git
cd kelola-router
npm install
cp .env.example .env
npm run dev          # starts Hono server + Vite dashboard in parallel
```

Open the dashboard at `http://localhost:5173`, set the admin password on first run, and add at least one account per provider you plan to use:

- `Upstream -> Accounts -> + Add` (MiniMax / CodeBuddy / Pioneer / Z.AI)
- `Upstream -> Accounts -> + Add (Kiro)` for Kiro social or device-flow
- `Upstream -> Accounts -> + Add (Notion)` for Notion internal integration

### Send a request

```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer <client_key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mm/MiniMax-M3",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

Swap `mm/` for `kr/`, `cb/`, `pio/`, `nt/`, or `zai/` to target a different upstream.

---

## Request pipeline (per request)

1. **Auth**: `client_key` middleware validates the bearer token; `admin_key` is reserved for `/api/admin/*`.
2. **CSRF**: same-origin guard for state-changing admin requests.
3. **Rate limit**: 5 failed auth attempts per IP per 15 minutes.
4. **Model resolution**: `modelPrefix.ts` parses `<provider>/<model>`; aliases and combos are resolved through `providers/alias.ts` + `providers/aliasCache.ts`.
5. **Account selection**: `accounts/selection.ts` chooses per `(provider, model)` with sticky or round-robin strategy, respecting `accounts/locks.ts` cooldowns.
6. **Transport resolution**: `transport/resolve.ts` picks proxy / relay / direct via `dispatcherCache.ts`; geoip defaults to intl/cn per `providers/baseUrl.ts`.
7. **Caveman + RTK**: optional terse system-prompt injection and message compression through `caveman/` and `rtk/`.
8. **Format transform**: `format/transform.ts` + `format/negotiate.ts` convert OpenAI<->Anthropic to whatever the upstream expects (Kiro uses EventStream binary framing, Notion uses an internal JSON shape, etc.).
9. **Upstream call**: `providers/upstreamFetch.ts` POSTs JSON via `proxyAwareFetch`, with streaming SSE assembled per-provider (Kiro uses `providers/kiro/assembler.ts`, CodeBuddy uses `providers/codebuddy/streamConvert.ts`).
10. **Streaming + usage**: `streaming/pipeWithUsage.ts` tees the SSE upstream response back to the client while `streaming/extractUsage.ts` parses token usage; `tailBuffer.ts` buffers partial lines.

Every step emits a `console/` flow event for the dashboard Console page and the `request_logs` table.

---

## Directory layout

```
src/
├── server.ts                     # Hono app + listener bootstrap
├── auth/                         # client_key + admin_key + CSRF + rate-limit
│   ├── password.ts               # scrypt hashing + session cookie
│   ├── rateLimit.ts              # 5 fails / 15min per IP
│   └── csrf.ts                   # same-origin guard
├── util/
│   ├── env.ts                    # typed env getters
│   └── log.ts                    # pino instance
├── accounts/                     # state machine + selection
│   ├── backoff.ts                # exponential cooldown (1s -> 4min cap)
│   ├── errorRules.ts             # 429/2056/2061/5xx cascade
│   ├── state.ts                  # apply/reset/filter/lock-checks
│   ├── selection.ts              # sticky + round-robin per provider
│   ├── locks.ts                  # per-(account, model) cooldown CRUD
│   └── types.ts
├── db/
│   ├── index.ts                  # openDb (WAL, FK, busy_timeout, optional SQLCipher)
│   ├── hooks.ts                  # bumpAdminCacheVersion re-export
│   ├── migrations/               # 001-initial only (schema.sql / indexes.sql / seed.sql)
│   └── repos/                    # accounts, aliases, auditLog, client_keys,
│                                 #   combos, models, quotaSnapshots,
│                                 #   requestLogs, requestLogsQueue, settings,
│                                 #   transports (+ settings.types.ts)
├── providers/
│   ├── minimax.ts                # PROVIDER const, upstreamUrl/Headers
│   ├── baseUrl.ts                # intl vs cn
│   ├── headers.ts                # OpenAI Bearer vs Anthropic x-api-key
│   ├── alias.ts + aliasCache.ts
│   ├── listModels.ts             # /v1/models fetch + merge
│   ├── modelPrefix.ts            # mm/kr/cb/pio/nt/zai parser
│   ├── pricing.ts                # per-token cost calc (incl cache)
│   ├── parseError.ts             # base_resp.status_code extraction
│   ├── quota.ts                  # token-plan quota parser
│   ├── upstreamFetch.ts          # JSON POST wrapper over proxyAwareFetch
│   ├── common/                   # SseAssemblerBase.ts template-method
│   ├── format/                   # transform.ts + negotiate.ts + messageTypes.ts
│   ├── kiro/                     # AWS CodeWhisperer / Amazon Q
│   ├── codebuddy/                # index, transform, streamConvert
│   ├── notion/                   # auth, constants, extract, transform, manifest.json
│   ├── pioneer/                  # index, models, transform
│   └── zai/                      # index, transform
├── proxy/                        # per-provider request proxies
│   ├── minimax.ts, kiro.ts, codebuddy.ts, pioneer.ts, notion.ts, zai.ts
├── rtk/                          # RTK compression pipeline
│   ├── index.ts, applyFilter.ts, autodetect.ts, registry.ts, constants.ts, types.ts
│   └── filters/                  # dedupLog, smartTruncate
├── caveman/                      # terse system-prompt injection
├── cache-injection.ts            # dual cache_control + auto-breakpoints
├── streaming/
│   ├── extractUsage.ts           # parse SSE -> usage
│   ├── pipeWithUsage.ts          # tee upstream SSE
│   └── tailBuffer.ts             # SSE partial-line buffering
├── transport/                    # proxy / relay resolution
│   ├── proxyFetch.ts, dispatcherCache.ts, socksLoader.ts, types.ts
│   ├── geoip.ts                  # ipapi.co country probe
│   ├── resolve.ts                # resolveTransportForAccount
│   └── resolvedCache.ts
├── scheduler/
│   └── quotaPull.ts              # periodic /v1/token_plan/remains puller
├── console/                      # flow event bus
└── security/status.ts            # GET /api/admin/security/status

client/                           # Preact SPA dashboard (Vite)
├── src/
│   ├── App.tsx, main.tsx
│   ├── __tests__/                # 11 test files + setup
│   ├── components/               # Card, Stat, Badge, Button, Modal, Toast,
│   │                             #   CommandPalette, Icon, Pagination, Progress,
│   │                             #   SelectionControls, SecurityBanner,
│   │                             #   TransportAssignment, ToastProvider
│   ├── components/accounts/      # AddAccountModal, EditAccountModal, KiroUsageModal,
│   │                             #   ProviderAccountSection, AccountsTable,
│   │                             #   NotionAuthForm, KiroAutoImportForm,
│   │                             #   KiroDeviceFlowForm
│   ├── components/models/        # AddModelModal, EditModelModal, ProviderModelsSection
│   ├── components/transports/    # AddTransportModal, BulkImportModal,
│   │                             #   EditTransportModal, FailureModeCard,
│   │                             #   TransportsTable
│   ├── hooks/                    # useKiroAutoImport, useKiroDeviceFlow, useNotionAuth
│   ├── layout/                   # AppShell, Sidebar, TopBar
│   ├── lib/                      # api.ts (fetch wrapper), queryClient,
│   │                             #   relativeTime, types, providerPrefix
│   ├── pages/                    # 15 pages (see Dashboard below)
│   └── styles/                   # base.css (tokens+fonts), components.css, animations.css

scripts/                          # CLI scripts
├── add-account.ts + add-account.cliArgs.ts
├── add-client-key.ts
├── notion-add-account.ts
├── recover-db.ts                 # WAL race recovery
├── reset.ts
├── seed-models.ts                # base models
├── seed-kiro-models.ts
├── seed-codebuddy-models.ts
├── seed-notion-models.ts
└── seed-zai-models.ts

tests/                            # integration + API + console + DB + provider + proxy + bench
docker-compose.yml, Dockerfile, Caddyfile, .env.example
docs/roadmap.md, docs/zai/, docs/notion/
```

---

## Dashboard

Built-in Preact SPA (Vite). Sidebar order is fixed; pages route via the hash router. Theme accent: `#c9a352` (Obsidian Gold).

| Page              | Route                  | Purpose                                                                      |
| ----------------- | ---------------------- | ---------------------------------------------------------------------------- |
| Login             | `#/login`              | Admin password + session cookie bootstrap                                    |
| Overview          | `#/`                   | Counts, health, recent request log                                           |
| Usage             | `#/usage`              | Per-model token + cost rollups                                               |
| Client keys       | `#/client-keys`        | Issue / rotate bearer tokens for downstream callers                          |
| Upstream          | `#/accounts`           | Add / edit / disable accounts per provider (incl. Kiro auth flows)          |
| Models            | `#/models`             | Catalog + custom model registry, `family` field (audit-fix A4)              |
| Aliases           | `#/aliases`            | User-facing name -> upstream model (e.g. `mm-fast` -> `mm/MiniMax-M3`)      |
| Combos            | `#/combos`             | Ordered fallback lists across providers (symmetric uniqueness, audit-fix B1) |
| Quota             | `#/quota`              | Kiro / per-account quota snapshots + per-account error shape (audit-fix A5) |
| Proxies           | `#/transports`         | Manage transports (direct / SOCKS / HTTP / relay), bulk import              |
| Console           | `#/console`            | Live request-flow event stream                                               |
| Settings          | `#/settings`           | caveman / caching / rtk / minimax / version + per-provider selection        |
| RequestDetail     | `#/request/:id`        | Drill-in for a single request (prompt, upstream, usage, RTK log)            |
| Placeholder       | `#/...`                | Catch-all for unimplemented sections                                         |
| 404               | `#/404`                | Not-found page                                                               |

---

## Configuration

`GET /api/admin/settings` returns the current settings object. Missing keys return `null`; the dashboard merges UI defaults over the response (audit-fix A7). Seeded defaults come from migration `001-initial`.

```jsonc
{
  "caveman":  { "level": "off" },                                 // "off" | "light" | "strong"
  "caching":  { "autoBreakpoints": true, "respectCallerMarkers": true },
  "rtk":      {
    "enabled": true,
    "minCompressSize": 500,
    "rawCap": 10485760,
    "filters": ["dedupLog", "smartTruncate"]
  },
  "minimax":  { "upstreamFormat": "auto", "m3DefaultMaxCompletionTokens": 131072 },
  "version":  "<auto>"
}
```

### Per-provider selection

`settings.selection.<provider>` controls account-pick strategy per provider.

| Provider   | Default mode | Notes                                                              |
| ---------- | ------------ | ------------------------------------------------------------------ |
| `minimax`  | sticky       | Round-robin opt-in via `{mode: "round-robin", step: N}`            |
| `kiro`     | sticky       | Same shape; Kiro accounts carry their own quota snapshot           |
| `codebuddy`| sticky       | Round-robin available                                              |
| `pioneer`  | sticky       | Round-robin available                                              |
| `notion`   | sticky       | Notion internal integration only; no rotation across workspaces    |
| `zai`      | sticky       | Round-robin available                                              |

### Environment variables (selected)

| Var                              | Purpose                                                              |
| -------------------------------- | -------------------------------------------------------------------- |
| `HOST` / `PORT`                  | Bind address (default `0.0.0.0:8787`)                                |
| `REGION`                         | `intl` vs `cn` for `providers/baseUrl.ts`                            |
| `DB_PATH`                        | SQLite file path (default `./data/router.db`)                        |
| `ROUTER_DB_KEY`                  | SQLCipher encryption key (optional)                                  |
| `LOG_LEVEL`                      | pino level (`debug` / `info` / `warn` / `error`)                     |
| `ROUTER_UPSTREAM_FORMAT`         | Force `openai` or `anthropic` wire format                            |
| `CONSOLE_FLOW`                   | `stdout` to mirror flow events to terminal                           |

---

## Development

```bash
npm run dev                # server + client in parallel
npm run dev:server         # Hono on :8787 only
npm run dev:client         # Vite on :5173 only
npm run build              # tsc + Vite build
npm run start              # node dist/server.js
npm run lint               # biome check .
npm run lint:fix
npm run typecheck
npm run test               # server Vitest
npm run test:client        # client Vitest
npm run test:watch
```

### CLI scripts

Each script has a `:docker` variant that runs the same command inside the compose container.

| Command                       | Purpose                                              |
| ----------------------------- | ---------------------------------------------------- |
| `npm run add-account`         | Interactive account add (provider picked at prompt)  |
| `npm run add-client-key`      | Mint a new client_key                                |
| `npm run seed-models`         | Seed the base model catalog                          |
| `npm run seed-kiro-models`    | Seed Kiro-specific models                            |
| `npm run seed-codebuddy-models` | Seed CodeBuddy models                             |
| `npm run seed-zai-models`     | Seed Z.AI models                                     |
| `npm run seed-notion-models`  | Seed Notion models                                   |
| `npm run seed-all`            | Run every `seed-*` script                            |
| `npm run reset`               | Wipe DB and reseed (destructive)                     |
| `npm run recover-db`          | Recover from a WAL race or interrupted checkpoint    |
| `npx tsx scripts/notion-add-account.ts` | Notion-specific add (device code path)    |

### Commit conventions

Conventional Commits, one logical unit per commit. Examples:

- `feat(minimax): add round-robin selection step`
- `fix(aliases): enforce combo-name uniqueness on insert`
- `chore(release): v0.22.0`
- `docs: sync with v0.21.0 (zai provider)`

WIP commits are prefixed `wip:`. Never force-push or rewrite published history.

---

## Docker

```bash
docker compose up -d --build
docker compose logs -f router
```

- The container expects `/data` to be bind-mounted. The SQLite file lives at `/data/router.db`.
- **WAL race warning**: if the container was killed mid-write you may see `database disk image is malformed` on next start. Run `npm run recover-db` (or `docker compose run --rm router npm run recover-db`) to checkpoint and reattach.
- The Caddyfile is provided as a reference for TLS termination; it is not started automatically by `docker-compose.yml`.
- `.env.example` lists every env var the server reads at boot.

---

## VPS deploy

1. Provision a small VPS (1 vCPU / 1 GB is enough for personal use).
2. Clone the repo and `cp .env.example .env`. Fill in `HOST`, `PORT`, `DB_PATH`, `LOG_LEVEL`, and `ROUTER_DB_KEY` (if encrypting at rest).
3. `npm ci && npm run build`.
4. On first boot, open the dashboard at `http://<vps>:8787` and **enter the dashboard password you set** (password mode + session cookie; the legacy open-mode `admin_key` flow is gone). The password is hashed with scrypt and stored in `settings`.
5. Put Caddy (or your reverse proxy of choice) in front of port `8787` for TLS, then point your local OpenAI/Anthropic client at `https://router.example.com`.

If you ever forget the password, the only recovery is to wipe `settings` from the DB and re-bootstrap; there is no backdoor.

---

## Transport

`/api/admin/transports` lets you assign one transport per upstream account. Four modes:

| Mode     | Settings key                          | Env override  | Notes                                                |
| -------- | ------------------------------------- | ------------- | ---------------------------------------------------- |
| Direct   | `transport.proxy = null`              | (n/a)         | Default; uses local NIC                              |
| SOCKS    | `transport.proxy = "socks5h://..."`   | `ALL_PROXY`   | Lazy-loaded via `transport/socksLoader.ts`           |
| HTTP     | `transport.proxy = "http://..."`      | `HTTP_PROXY`  | Standard HTTP CONNECT                                |
| Relay    | `transport.relay = "https://relay.example.com"` | (n/a) | Hand-off to a remote proxy that fans out to upstreams |

`resolveTransportForAccount` caches the resolved dispatcher per account in `transport/resolvedCache.ts`. Geoip defaults to `intl` vs `cn` via `transport/geoip.ts` (ipapi.co country probe) and `providers/baseUrl.ts`.

---

## Security

- **Open mode (default, dev-only)**: no admin auth. Set a dashboard password before exposing the service.
- **Password mode**: scrypt-hashed admin password, session cookie with CSRF guard. This is the production default after first boot.
- **Encryption-at-rest**: set `ROUTER_DB_KEY` and the SQLite file is opened via SQLCipher. Losing the key loses the DB.
- **Rate limit**: 5 failed auth attempts per IP per 15 minutes (`auth/rateLimit.ts`).
- **Audit log**: every admin mutation is appended to `audit_log` (repos in `db/repos/auditLog.ts`); readable on the Settings page.
- **Security banner**: top-of-dashboard warning when running in open mode or with no DB encryption (`components/SecurityBanner`).
- **Security status endpoint**: `GET /api/admin/security/status` (`security/status.ts`) reports mode, key presence, and last audit entries.

---

## Roadmap

| Version  | Theme                                                                                          | Status   |
| -------- | ---------------------------------------------------------------------------------------------- | -------- |
| v0.22.0  | Audit-fixes batch: quota parallel + per-account errors, settings null + client merge, admin cache TTL + explicit invalidation, combo/alias symmetry, upsertAlias source tracking | Shipped  |
| v0.21.0  | Z.AI provider + provider-prefix model routing (`mm/`, `kr/`, `cb/`, `pio/`, `nt/`, `zai/`)    | Shipped  |
| v0.20.0  | Pioneer provider, combo cross-provider fallback, Kiro quota snapshots                           | Shipped  |
| v0.19.0  | Notion provider, request-flow console, RTK log surfacing                                       | Shipped  |
| v0.18.x  | Kiro (AWS CodeWhisperer) provider, device-flow import                                          | Shipped  |
| v0.17.x  | CodeBuddy provider, OpenAI<->Anthropic negotiation                                            | Shipped  |
| v0.16.x  | RTK pipeline + Caveman terse-prompt injection                                                  | Shipped  |
| v0.15.x  | Built-in Preact dashboard (Obsidian Gold)                                                      | Shipped  |
| v0.14.x  | SQLite + WAL + SQLCipher optional encryption                                                   | Shipped  |
| v0.13.x  | Multi-account pool, exponential backoff, per-model locks                                      | Shipped  |
| v0.12.x  | Transport layer (proxy / relay / direct)                                                       | Shipped  |
| v0.11.x  | Initial MiniMax proxy + client_key auth                                                        | Shipped  |

See `docs/roadmap.md` for upcoming ideas and `CHANGELOG.md` for the full per-version list.

---

## License

MIT. See `LICENSE` for the full text.

---

<sub>Built with Hono, Preact, better-sqlite3, pino, and an unreasonable amount of provider-specific wire-format glue. Gold accent `#c9a352`. Stay sticky, stay cached, stay on a healthy cooldown.</sub>
