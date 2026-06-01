# Implementation Spec — MiniMax API Router

_Single source of truth for v1 implementation. Pairs with `docs/idea/` (research) and per-module detail in `docs/idea/<area>/SUMMARY.md`._

**Status:** DRAFT v1
**Scope:** v0.1 → v0.6 (~2-3 days lean)
**Date:** 2026-06-01

---

## 1. Position

Build a Hono-based local-first single-provider API router (Node.js 20+, TypeScript strict) for MiniMax. Single binary, SQLite-backed, multi-account (PAYG + Token Plan), prompt caching with auto dual-breakpoint injection, RTK tool-output compression, Caveman terse-prompt injection, model alias for thinking variants, multi-transport (direct / HTTP / SOCKS5 / Vercel-relay / Cloudflare-relay), 5-page admin dashboard, usage + quota tracking.

**What this spec does:**
- Lock the file tree (target end-of-v1 state)
- Lock module boundaries + dependency graph
- Lock the request/response data flow
- Lock the integration contract (`src/server.ts` glue)
- Lock v0.1→v0.6 milestones with acceptance criteria

**What this spec does NOT do:**
- Per-module skeleton code (lives in `docs/idea/<area>/SUMMARY.md`)
- Risk register (lives in `docs/idea/RISKS.md`)
- Architecture rationale (lives in `docs/idea/DECISION.md`)

When implementation starts, `docs/idea/<area>/SUMMARY.md` is the port skeleton; this spec is the wiring.

---

## 2. File Tree (target end-of-v0.6)

```
minimax-router/
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── Dockerfile
├── docker-compose.yml
├── Caddyfile                          # VPS deploy snippet
├── docs/
│   ├── idea/                          # research + design rationale (read-only after v1)
│   └── spec/
│       └── IMPLEMENTATION.md          # this file
├── src/
│   ├── server.ts                      # Hono app + listener
│   ├── auth.ts                        # requireApiKey + requireAdmin middleware
│   ├── cache-injection.ts             # dual cache_control breakpoint logic
│   ├── accounts/
│   │   ├── types.ts
│   │   ├── backoff.ts
│   │   ├── errorRules.ts
│   │   ├── state.ts
│   │   ├── selection.ts
│   │   └── locks.ts
│   ├── caveman/
│   │   ├── index.ts
│   │   └── prompts.ts
│   ├── db/
│   │   ├── index.ts
│   │   ├── migrations/
│   │   │   ├── index.ts
│   │   │   └── 001-initial.ts
│   │   └── repos/
│   │       ├── users.ts
│   │       ├── accounts.ts
│   │       ├── requestLogs.ts
│   │       ├── quotaSnapshots.ts
│   │       ├── models.ts
│   │       ├── settings.ts
│   │       └── userSettings.ts
│   ├── providers/
│   │   ├── minimax.ts                 # Provider interface impl
│   │   ├── alias.ts
│   │   ├── baseUrl.ts
│   │   ├── headers.ts
│   │   ├── upstreamFetch.ts
│   │   ├── parseError.ts
│   │   ├── quota.ts
│   │   ├── listModels.ts
│   │   └── pricing.ts
│   ├── rtk/
│   │   ├── index.ts
│   │   ├── applyFilter.ts
│   │   ├── autodetect.ts
│   │   ├── constants.ts
│   │   ├── registry.ts
│   │   ├── types.ts
│   │   └── filters/
│   │       ├── smartTruncate.ts
│   │       └── dedupLog.ts
│   ├── transport/
│   │   ├── proxyFetch.ts
│   │   ├── dispatcherCache.ts
│   │   ├── socksLoader.ts
│   │   └── types.ts
│   ├── streaming/
│   │   ├── extractUsage.ts            # SSE usage chunk parser
│   │   └── pipeWithUsage.ts           # TransformStream wrapper
│   ├── dashboard/
│   │   ├── layout.ts                  # HTML shell + nav
│   │   ├── pages/
│   │   │   ├── overview.ts            # GET /admin
│   │   │   ├── usage.ts               # GET /admin/usage
│   │   │   ├── accounts.ts            # GET /admin/accounts
│   │   │   ├── models.ts              # GET /admin/models
│   │   │   ├── quota.ts               # GET /admin/quota
│   │   │   └── settings.ts            # GET /admin/settings
│   │   └── render.ts                  # html template helpers
│   ├── scheduler/
│   │   └── quotaPull.ts               # periodic /v1/token_plan/remains
│   └── util/
│       ├── log.ts                     # structured logger (pino wrapper)
│       └── env.ts                     # typed env access
├── data/                              # gitignored, holds router.db + WAL
└── scripts/
    ├── seed-models.ts                 # CLI: add custom model
    ├── add-account.ts                 # CLI: add MiniMax account
    ├── add-user.ts                    # CLI: create router-user
    └── reset.ts                       # CLI: drop + re-migrate (dev only)
```

Total target: ~35 TS files, ~3500 LOC including stubs.

---

## 3. Module Boundaries

### 3.1 Layer diagram

```
┌────────────────────────────────────────────────────────────┐
│  HTTP (Hono)                                              │
│    ↓                                                      │
│  Middleware: auth (requireApiKey, requireAdmin)           │
│    ↓                                                      │
│  Route handler: handleProxy() — orchestrates below        │
│    ↓                                                      │
│  Augment: caveman + cache-injection (mutate body)         │
│    ↓                                                      │
│  RTK: compressMessages (mutate body)                      │
│    ↓                                                      │
│  Provider: resolveModel + buildHeaders + buildUrl         │
│    ↓                                                      │
│  Account selection: selectAccount (sticky | round-robin)  │
│    ↓                                                      │
│  Transport: proxyAwareFetch (relay | proxy | direct)      │
│    ↓                                                      │
│  Upstream: MiniMax API                                    │
│    ↓                                                      │
│  Response: stream usage extract OR buffer + parse         │
│    ↓                                                      │
│  Persist: request_logs INSERT                             │
│    ↓                                                      │
│  Account state: applyErrorState | resetAccountState       │
│    ↓                                                      │
│  Return to caller                                         │
└────────────────────────────────────────────────────────────┘
```

### 3.2 Module dependency graph (one-way)

```
server.ts
  ├─→ auth.ts ─→ db/repos/users.ts
  ├─→ cache-injection.ts
  │     ├─→ caveman/
  │     └─→ db/repos/settings.ts
  ├─→ rtk/
  ├─→ providers/alias.ts ─→ db/repos/models.ts
  ├─→ providers/headers.ts
  ├─→ providers/baseUrl.ts
  ├─→ providers/upstreamFetch.ts
  │     ├─→ transport/proxyFetch.ts
  │     └─→ providers/headers.ts
  ├─→ providers/parseError.ts
  ├─→ providers/pricing.ts ─→ db/repos/models.ts
  ├─→ accounts/selection.ts
  │     └─→ accounts/state.ts
  │           └─→ accounts/errorRules.ts
  │                 └─→ accounts/backoff.ts
  ├─→ accounts/locks.ts ─→ db
  ├─→ accounts/state.ts
  ├─→ streaming/pipeWithUsage.ts
  │     └─→ streaming/extractUsage.ts
  ├─→ db/repos/requestLogs.ts
  └─→ db/repos/accounts.ts
```

**Invariant:** All arrows go down or right. No cycles. `db/` is leaf — never imports from providers/accounts/rtk.

### 3.3 Public interfaces per module

| Module | Public surface | Internal |
|--------|----------------|----------|
| `server.ts` | `start()` | `handleProxy()` |
| `auth.ts` | `requireApiKey`, `requireAdmin` | `lookupByApiKey`, `lookupByAdminKey` |
| `cache-injection.ts` | `addDualCacheBreakpoints`, `augmentRequest` | — |
| `accounts/state.ts` | `applyErrorState`, `resetAccountState`, `isAccountUnavailable`, `isModelLockActive` | — |
| `accounts/selection.ts` | `selectAccount` | — |
| `accounts/locks.ts` | `getModelLock`, `setModelLock`, `clearExpiredModelLocks` | — |
| `caveman/index.ts` | `injectCaveman` | `injectClaudeSystem`, `injectMessagesSystem` |
| `db/index.ts` | `openDb` | `defaultDbPath`, `migrate` |
| `db/repos/*` | `getX`, `listX`, `insertX`, `updateX`, `deleteX` per entity | — |
| `providers/minimax.ts` | `Provider` interface impl | re-exports |
| `providers/alias.ts` | `resolveModel` | — |
| `providers/upstreamFetch.ts` | `upstreamFetch` | `buildHeaders` |
| `providers/quota.ts` | `pullQuota` | `parseTokenPlanRemains`, `parseCodingPlanRemains` |
| `providers/listModels.ts` | `fetchModels` | `detectFamily` |
| `providers/pricing.ts` | `resolvePricing`, `calculateCost` | — |
| `rtk/index.ts` | `compressMessages`, `formatRtkLog` | `compressText` |
| `transport/proxyFetch.ts` | `proxyAwareFetch` | `getEnvProxyUrl`, `normalizeProxyUrl` |
| `streaming/pipeWithUsage.ts` | `pipeWithUsage` | — |
| `streaming/extractUsage.ts` | `extractUsageFromSSE` | — |
| `dashboard/pages/*` | `render(ctx)` per page | shared `layout` |
| `scheduler/quotaPull.ts` | `startQuotaPuller` | `pullAllAccounts` |

---

## 4. Data Flow

### 4.1 Request path

```
1. POST /v1/chat/completions | /v1/messages | etc
2. requireApiKey → look up user by `Authorization: Bearer <KEY>` or `x-api-key: <KEY>`
   ├─ miss → 401
   └─ hit → attach user to c.set("user", ...)
3. c.req.json() → body (mutated in place downstream)
4. detectFormat(body) → "openai" | "anthropic"
5. getSettings(db) → { rtk, caveman, caching, transport } (1s cache)
6. augmentRequest(body, settings)
   ├─ if caveman.level !== "off" → injectCaveman(body, level)
   └─ if caching.autoBreakpoints && body.system → addDualCacheBreakpoints(body, respectCallerMarkers)
7. compressMessages(body, rtk.enabled) → returns stats (or null)
   └─ rtk_saved_bytes = stats ? (bytesBefore - bytesAfter) : 0
8. resolveModel(body.model) → { upstreamModel, bodyTransform }
   └─ bodyTransform(body)  // e.g. inject thinking for *-thinking alias
9. selectAccount(user.accounts, user.config.accountMode, stickyKey, stickyMap)
   ├─ none available → 503
   └─ picked → continue with account
10. getModelLock(db, account.id, upstreamModel) → if active, 429
11. buildUrl(account, format, upstreamPath) → absolute URL
12. buildHeaders(body, account, stream, format) → headers
13. proxyAwareFetch(url, {method, headers, body, signal}, transport)
    ├─ relay: wrap with x-relay-target + x-relay-path
    ├─ proxy: undici ProxyAgent
    └─ direct
14. response handling (see 4.2)
```

### 4.2 Response path

**Non-stream (`stream: false`):**
```
15a. resp.text() → body
16a. parseUsage(body, format) → { prompt, completion, cache_creation, cache_read, total, baseRespCode? }
17a. calculateCost(model, usage) → cost_usd
18a. if !resp.ok:
       ├─ parseError(resp, body) → { baseRespCode, windowResetMs, retryAfterSec }
       ├─ applyErrorState(account, ...) → updated account
       └─ UPDATE accounts SET ... ; if 429/1002: setModelLock(db, account.id, model, cooldown)
    else:
       └─ UPDATE accounts SET rate_limited_until=NULL, backoff_level=0, ... (reset)
19a. INSERT INTO request_logs (...) VALUES (...)
20a. return c.body(body, resp.status)
```

**Stream (`stream: true`):**
```
15b. pipeWithUsage(resp.body, { onUsage, onError, onEnd })
    └─ TransformStream:
       ├─ tee chunks → pass to client
       ├─ on final `usage` chunk: accumulate, call onUsage(usage)
       └─ on stream end: call onEnd({ usage, status, latency_ms, ttft_ms })
16b. INSERT INTO request_logs (...) with accumulated usage
17b. return c.body(transformedBody, resp.status)
```

### 4.3 Quota-pull path (background)

```
1. scheduler/quotaPull.ts — startQuotaPuller(intervalMs)
2. setInterval: every 5 min (configurable via settings)
3. for each account where enabled=1 AND credit_type='token-plan':
   ├─ upstreamFetch("/v1/token_plan/remains", {}, account, "openai", false, ...)
   ├─ if !ok: warn, fall back to /v1/api/openplatform/coding_plan/remains
   ├─ parse response → snapshots
   └─ for each snapshot: INSERT INTO quota_snapshots
4. cleanup: DELETE FROM quota_snapshots WHERE fetched_at < now - 30 days
```

### 4.4 Admin path

```
GET /admin/overview
  ├─ requireAdmin (same api_key as proxy OR dedicated admin key, settings row)
  ├─ SELECT COUNT(*), SUM(cost_usd), ... FROM request_logs WHERE created_at > now-7d
  ├─ SELECT * FROM accounts WHERE user_id=? (current user)
  └─ render(dashboard/pages/overview, ctx)

POST /admin/accounts (add MiniMax account)
  ├─ requireAdmin
  ├─ validate body { label, creditType, apiKey, baseUrl? }
  ├─ generate id (ulid)
  └─ INSERT INTO accounts (...)

PUT /admin/settings/caveman
  ├─ requireAdmin
  ├─ validate { level: "off" | "terse" | "ultra" }
  └─ setSetting(db, "caveman", { level })

... (similar for /admin/usage, /admin/models, /admin/models/fetch, /admin/quota)
```

---

## 5. Integration Contract — `src/server.ts`

This is the only file that wires all modules. Each module exports its public surface; server.ts orchestrates. ~180 LOC.

```ts
// src/server.ts — outline, full impl at implementation time
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { openDb } from "./db/index.js";
import { requireApiKey, requireAdmin } from "./auth.js";
import { augmentRequest } from "./cache-injection.js";
import { compressMessages, formatRtkLog } from "./rtk/index.js";
import { resolveModel } from "./providers/alias.js";
import { upstreamFetch, buildHeaders } from "./providers/upstreamFetch.js";
import { buildUrl, defaultBaseUrl } from "./providers/baseUrl.js";
import { parseError } from "./providers/parseError.ts";
import { calculateCost } from "./providers/pricing.js";
import { selectAccount } from "./accounts/selection.js";
import { applyErrorState, resetAccountState, isModelLockActive } from "./accounts/state.js";
import { getModelLock, setModelLock } from "./accounts/locks.js";
import { getUserAccounts, updateAccount, persistLog, persistLogStream } from "./db/repos/...";
import { getSetting } from "./db/repos/settings.js";
import { proxyAwareFetch } from "./transport/proxyFetch.js";
import { pipeWithUsage } from "./streaming/pipeWithUsage.js";
import { startQuotaPuller } from "./scheduler/quotaPull.js";
import { renderOverview, renderUsage, renderAccounts, renderModels, renderQuota, renderSettings } from "./dashboard/pages/...";

const db = openDb();
const app = new Hono();
app.use("*", async (c, next) => {
  c.set("db", db);
  c.set("startTime", Date.now());
  await next();
});

app.get("/health", (c) => c.json({ ok: true, version: getSetting(db, "build")?.version }));

// --- Proxy routes ---
app.post("/v1/chat/completions", requireApiKey, (c) => handleProxy(c, "openai", "/v1/chat/completions"));
app.post("/v1/messages", requireApiKey, (c) => handleProxy(c, "anthropic", "/v1/messages"));
app.post("/v1/messages/count_tokens", requireApiKey, (c) => handleProxy(c, "anthropic", "/v1/messages/count_tokens"));
app.post("/v1/embeddings", requireApiKey, (c) => handleProxy(c, "openai", "/v1/embeddings"));
app.get("/v1/models", requireApiKey, (c) => handleProxy(c, "openai", "/v1/models"));

// --- Admin routes ---
app.get("/admin", requireAdmin, (c) => renderOverview(c));
app.get("/admin/usage", requireAdmin, (c) => renderUsage(c));
app.get("/admin/accounts", requireAdmin, (c) => renderAccounts(c));
app.post("/admin/accounts", requireAdmin, (c) => /* insert */);
app.put("/admin/accounts/:id", requireAdmin, (c) => /* update */);
app.delete("/admin/accounts/:id", requireAdmin, (c) => /* soft delete */);
app.get("/admin/models", requireAdmin, (c) => renderModels(c));
app.post("/admin/models", requireAdmin, (c) => /* add custom model */);
app.post("/admin/models/fetch", requireAdmin, (c) => /* hit /v1/models on each account, merge */);
app.get("/admin/quota", requireAdmin, (c) => renderQuota(c));
app.get("/admin/settings", requireAdmin, (c) => renderSettings(c));
app.put("/admin/settings/caveman", requireAdmin, (c) => /* update */);
app.put("/admin/settings/rtk", requireAdmin, (c) => /* update */);
app.put("/admin/settings/caching", requireAdmin, (c) => /* update */);
app.put("/admin/settings/transport", requireAdmin, (c) => /* update */);

// --- Core handler ---
async function handleProxy(c, format, upstreamPath) { /* ~120 LOC, see §4.1 */ }

// --- Start ---
const port = parseInt(process.env.PORT ?? "20137", 10);
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "127.0.0.1" }, (info) => {
  console.log(`[router] listening on http://${info.address}:${info.port}`);
  startQuotaPuller(db, 5 * 60_000);
});
```

**Open stubs in `handleProxy`:**
- `streamResponse` — wraps `pipeWithUsage` + log on end. ~50 LOC.
- `persistLog` / `persistLogStream` — insert into request_logs. ~30 LOC each.

Both live in `db/repos/requestLogs.ts`. See `streaming/` for the TransformStream impl.

---

## 6. Milestones

Each milestone has: **deliverables** (what lands), **acceptance criteria** (how to verify), **ref** (where the detail lives).

### v0.1 — Passthrough proxy (target: 1-2h)

**Deliverables:**
- `package.json` + `tsconfig.json` (strict, target ES2022, module NodeNext)
- `src/server.ts` (Hono app, 5 routes, no auth, no augmentation)
- `src/providers/upstreamFetch.ts` (no transport layer yet — direct fetch)
- `src/transport/proxyFetch.ts` (direct path only; relay/proxy stubs return error)
- `src/auth.ts` (stub: `requireApiKey` accepts any `Bearer <KEY>`, no DB lookup)

**Acceptance:**
- `npm run dev` starts on `127.0.0.1:20137`
- `curl -X POST http://127.0.0.1:20137/v1/chat/completions -H "Authorization: Bearer test" -H "Content-Type: application/json" -d '{"model":"MiniMax-M3","messages":[{"role":"user","content":"hi"}]","stream":false}'` returns MiniMax response with same body
- `curl -X POST http://127.0.0.1:20137/v1/messages -H "x-api-key: test" -H "anthropic-version: 2023-06-01" -H "Content-Type: application/json" -d '{"model":"MiniMax-M3","max_tokens":100,"messages":[{"role":"user","content":"hi"}]}'` works
- Streaming works: `stream:true` returns SSE with same chunks as direct MiniMax call
- `GET /health` returns `{ok:true}`

**Ref:** `docs/idea/schema/SUMMARY.md` §server.ts (no augmentation), `docs/idea/transport/SUMMARY.md` (direct path only)

### v0.2 — Auth + accounts + multi-account state (target: 3-4h)

**Deliverables:**
- `src/db/index.ts` + `migrations/001-initial.ts` (7 tables seeded per `docs/idea/schema/SUMMARY.md`)
- `src/db/repos/{users,accounts,requestLogs,quotaSnapshots,models,settings,userSettings}.ts`
- `src/accounts/{types,backoff,errorRules,state,selection,locks}.ts` (full port)
- `src/auth.ts` real impl: look up by api_key (proxy) OR admin_key (admin), attach user
- `users.admin_key` column added (migration 002 alters 001)

**Acceptance:**
- `scripts/add-user.ts` creates a user, prints api_key
- `scripts/add-account.ts` creates an account
- `requireApiKey` rejects unknown keys with 401
- `users.admin_key` populated by `scripts/add-user.ts --admin` (prints admin_key separately from api_key)
- `requireAdmin` accepts EITHER `x-admin-key: <KEY>` header OR `Authorization: Bearer <ADMIN_KEY>` (same key shape, different column)
- Proxy key cannot hit admin routes: `GET /admin/accounts` with proxy api_key → 403
- Admin key CAN hit proxy routes (escape hatch for ops)
- Single-account request: works, persists log with account_id
- Multi-account + sticky mode: first request picks first account, subsequent same `x-router-key` use same account until 429, then fallback
- Multi-account + round-robin mode: each request rotates to next available account
- Simulated 429 (mock by temporarily bad api_key) → mark `rate_limited_until` + backoff_level, next request picks different account
- `account_model_locks` populated on 429 for that model only
- 6 error rules from `errorRules.ts` correctly classify text matches and HTTP status

**Ref:** `docs/idea/account-fallback/SUMMARY.md`, `docs/idea/schema/SUMMARY.md` §001-initial

### v0.3 — Model registry + alias + thinking injection (target: 2-3h)

**Deliverables:**
- `src/providers/{alias,baseUrl,headers}.ts` (full impl)
- `src/providers/listModels.ts` (live fetch from `/v1/models`)
- `src/providers/pricing.ts` (resolvePricing + calculateCost with M3 tiered pricing)
- 11 default models seeded by migration 001
- `scripts/seed-models.ts` CLI for custom model add

**Acceptance:**
- `GET /v1/models` returns union of enabled models from local registry (seeded)
- `POST /admin/models/fetch` hits upstream on each active account, merges new models
- `body.model = "MiniMax-M3-thinking"` → upstream sees `MiniMax-M3` with `thinking.enabled=true, thinking.budget_tokens=4096`
- Caller's `thinking.budget_tokens=N` overrides the default
- `body.model = "MiniMax-M2.7"` → no thinking injected
- `body.model = "unknown-model"` → 400 with clear error
- M3 with `prompt_tokens > 512_000` → uses high tier pricing in cost calculation
- `request_logs.cost_usd` populated correctly for non-stream responses

**Ref:** `docs/idea/minimax-api/SUMMARY.md`, `docs/idea/schema/SUMMARY.md` §models seed

### v0.4 — RTK + Caveman + cache injection (target: 2-3h)

**Deliverables:**
- `src/rtk/{index,applyFilter,autodetect,constants,registry,types}.ts`
- `src/rtk/filters/{smartTruncate,dedupLog}.ts`
- `src/caveman/{index,prompts}.ts`
- `src/cache-injection.ts` (caveman + dual breakpoints orchestration)
- 4 settings rows seeded (rtk, caveman, caching, build)

**Acceptance:**
- `settings.rtk.enabled = true`: tool_result blocks > 500 bytes get smart-truncate or dedup-log applied
- Stats logged: `[RTK] saved X/Y (Z%) via [filter1,filter2] hits=N`
- `request_logs.rtk_bytes_saved > 0` when RTK hits
- `settings.caveman.level = "terse"`: system prompt prepended (or system block added before last cache_control)
- `settings.caching.autoBreakpoints = true`: Anthropic requests get dual cache_control markers on (a) last system block (b) last assistant tool_use/text
- `settings.caching.respectCallerMarkers = true`: existing markers NOT overwritten
- Idempotency: 2 consecutive identical requests → same body shape (no duplicate markers)
- Anthropic cache test: send same request twice, verify `cache_read_input_tokens > 0` in second response

**Ref:** `docs/idea/rtk/SUMMARY.md`, `docs/idea/caveman/SUMMARY.md`, `docs/idea/schema/SUMMARY.md` §cache-injection

### v0.5 — Quota + dashboard (target: 2-3h)

**Deliverables:**
- `src/providers/quota.ts` (pullQuota + parseTokenPlanRemains + parseCodingPlanRemains)
- `src/scheduler/quotaPull.ts` (periodic pull, 5 min interval)
- `src/streaming/{extractUsage,pipeWithUsage}.ts` (SSE usage extraction)
- `src/dashboard/{layout,render}.ts` + 6 pages (overview, usage, accounts, models, quota, settings)
- All admin routes from §5

**Acceptance:**
- Scheduler runs every 5 min, populates `quota_snapshots` for token-plan accounts
- PAYG accounts: coding_plan endpoint pulled
- `used_count` correctly computed (semantic inversion fix per RISKS #1)
- Stream response: `request_logs.completion_tokens` and `cost_usd` populated from SSE usage chunk
- Dashboard `/admin` shows: total cost 7d, request count 7d, top 5 models, last 50 requests
- `/admin/accounts` lists accounts with status badge, last error, allows add/edit/disable
- `/admin/models` lists registry, allows add custom with pricing form
- `/admin/quota` shows per-account quota window (5h + weekly) with progress bars
- `/admin/settings` toggles: caveman level, RTK on/off, caching on/off, transport relay/proxy form
- XSS: dashboard escapes all dynamic content (no raw model output rendered)

**Ref:** `docs/idea/minimax-api/SUMMARY.md` §quota, `docs/idea/RISKS.md` #1, #7, #10

### v0.6 — Transport + Dockerfile (target: 1-2h)

**Deliverables:**
- `src/transport/proxyFetch.ts` full impl (relay + proxy + env fallback)
- `src/transport/{dispatcherCache,socksLoader,types}.ts`
- `src/util/env.ts` (typed access: ROUTER_DB_PATH, PORT, HOST, ROUTER_MASTER_KEY placeholder)
- `.env.example`
- `Dockerfile` (multi-stage: build → runtime, distroless or node:20-slim)
- `docker-compose.yml` (volume mount for `/data`, port mapping)
- `Caddyfile` snippet (TLS + reverse proxy for VPS)
- `README.md` (setup, run, deploy, troubleshooting)

**Acceptance:**
- `HTTPS_PROXY=http://localhost:7890 npm run dev` → upstream call goes through proxy
- `transport.relay = { kind: "vercel", url: "https://..." }` → upstream call hits relay first
- `transport.proxy = { kind: "socks5", url: "socks5://..." }` → uses SocksProxyAgent (dynamic import)
- No relay/proxy → direct
- `docker build -t minimax-router .` succeeds
- `docker compose up` starts on `127.0.0.1:20137`, data persists in `./data/router.db`
- VPS deploy: Caddyfile + `caddy reload` provides HTTPS, dashboard accessible at `https://router.example.com/admin`
- Stream through CF relay: 30s `: ping\n\n` keepalive (only if CF relay configured)

**Ref:** `docs/idea/transport/SUMMARY.md`, `docs/idea/RISKS.md` #2

---

## 7. Build, Run, Deploy

### Build
```bash
npm install
npm run build         # tsc → dist/
npm run dev           # tsx watch src/server.ts
npm start             # node dist/server.js
```

### Run (local)
```bash
cp .env.example .env  # edit if needed
npm run dev
# Listens on http://127.0.0.1:20137 by default
# For LAN/VPS: HOST=0.0.0.0 npm run dev
```

### Setup CLI
```bash
# One-time: create router-user
npx tsx scripts/add-user.ts --name "me"
# → prints: api_key: rk_abc123...

# Add MiniMax account
npx tsx scripts/add-account.ts --user 1 --label "PAYG main" --credit-type payg --api-key mm_xxx

# Verify
curl -H "Authorization: Bearer rk_abc123..." http://127.0.0.1:20137/v1/models
```

### Deploy (Docker)
```bash
docker build -t minimax-router .
docker compose up -d
docker compose logs -f
```

### Deploy (VPS + Caddy)
1. Provision Hetzner/OVH 1vCPU 2GB
2. Install Docker + Caddy
3. Clone repo, copy `.env` (with `HOST=0.0.0.0`)
4. `docker compose up -d`
5. Caddyfile:
   ```
   router.example.com {
     reverse_proxy 127.0.0.1:20137
   }
   ```
6. `caddy reload` (auto-TLS via Let's Encrypt)

---

## 8. Out of Scope (v1.1+)

Tracked in `docs/idea/RISKS.md` + DECISION.md "Fallback plan":

- **v1.1: API key encryption** — AES-256-GCM for `accounts.api_key`, sha256 for `users.api_key`. Key from `ROUTER_MASTER_KEY`. Migration 002.
- **v1.1: SQLite backup** — daily cron `sqlite3 .backup`, 30-day retention. Litestream optional.
- **v1.1: Audio/image/video proxies** — `/v1/audio/*`, `/v1/images/*`, `/v1/video/*` routes.
- **v1.1: Per-user daily spend cap** — `accounts.daily_limit_usd` field, enforced in handleProxy.
- **v1.1: Optional dashboard password** — settings row `dashboard.password_hash` (bcrypt/argon2). When set, dashboard pages render login form first; `requireAdmin` still required for API. ~50 LOC.
- **v1.1: Per-request overrides** — `x-caveman`, `x-router-skip-cache-injection` headers.
- **v2: Multi-provider** — add second provider by copying `src/providers/minimax.ts`, register in provider list. Refactor `handleProxy` to dispatch on `account.provider`.
- **v2: Format translation** — OpenAI ↔ Anthropic translator (only if a future provider doesn't speak both natively).
- **v2: OAuth** — MiniMax OAuth flow.
- **v2: Cloudflare Workers port** — 128MB memory limit will require splitting better-sqlite3 → Cloudflare D1.

---

## 9. Open Questions

From `docs/idea/REPORT.md` §Open questions + new ones surfaced:

1. **Admin auth** — RESOLVED: separate `admin_key` per user (column on `users`, populated by `scripts/add-user.ts --admin`). Proxy `api_key` rejected on `/admin/*` with 403. Admin key can hit proxy routes (escape hatch). Future v1.1: optional dashboard password (settings row `dashboard.password_hash` + bcrypt), gates dashboard UI in addition to admin_key. Architecture doesn't preclude — `renderOverview` etc accept ctx.user with `requireAdmin` already done; add password check before render when setting enabled.
2. **Log retention** — hardcoded 90d for `request_logs`, 30d for `quota_snapshots`? Or settings row?
3. **Per-user hard spend cap** — config-driven, not v1.
4. **CLI vs dashboard for initial setup** — both. CLI for headless/server, dashboard for interactive.
5. **Multiple router-instances** — explicitly NOT supported (per RISKS #9). Document loudly.
6. **Database migrations** — additive only. When destructive change needed, manual script.
7. **What if upstream changes pricing?** — update `models` table via `/admin/models/edit`. No restart.

---

## 10. Refs (→ docs/idea/)

| Section | Source |
|---------|--------|
| §1 Position, scope, non-requirements | `docs/idea/CONTEXT.md` |
| §2 File tree (module list) | `docs/idea/DECISION.md` "Next steps" + each SUMMARY.md |
| §3.1 Layer diagram | `docs/idea/REPORT.md` §Architecture |
| §3.2 Module deps | derived from each SUMMARY.md imports |
| §3.3 Public interfaces | each `docs/idea/<area>/SUMMARY.md` |
| §4 Data flow | `docs/idea/DECISION.md` + each SUMMARY.md "Integration" |
| §5 server.ts contract | `docs/idea/schema/SUMMARY.md` §server.ts |
| §6 Milestones | `docs/idea/REPORT.md` §Milestones + `docs/idea/DECISION.md` "Next steps" |
| §6 v0.1 acceptance | `docs/idea/transport/SUMMARY.md` (direct path) |
| §6 v0.2 acceptance | `docs/idea/account-fallback/SUMMARY.md` |
| §6 v0.3 acceptance | `docs/idea/minimax-api/SUMMARY.md` |
| §6 v0.4 acceptance | `docs/idea/{rtk,caveman}/SUMMARY.md` + `docs/idea/schema/SUMMARY.md` §cache-injection |
| §6 v0.5 acceptance | `docs/idea/minimax-api/SUMMARY.md` §quota + `docs/idea/RISKS.md` #1, #7, #10 |
| §6 v0.6 acceptance | `docs/idea/transport/SUMMARY.md` + `docs/idea/RISKS.md` #2 |
| §7 Build/Run/Deploy | `docs/idea/CONTEXT.md` "Constraints" + "Deployment" |
| §8 Out of Scope | `docs/idea/RISKS.md` + `docs/idea/DECISION.md` "Fallback plan" |
| §9 Open Questions | `docs/idea/REPORT.md` §Open questions |

---

**End of spec.** When implementation starts, work through §6 milestones in order. Each milestone's "Ref" points to the port skeleton — translate that skeleton to actual `.ts` files, then run the acceptance tests.

