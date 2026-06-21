# Architecture

A deep-dive into how `kelola-router` is wired. Pair with `AGENTS.md` (overview + workflow) and `MEMORY.md` (knowledge index).

## Bird's-eye

```
  Client (Claude Code, hermes-agent, curl, anything speaking OpenAI/Anthropic)
    │
    │  Authorization: Bearer <client_key>      ── two-tier auth ──
    ▼
┌──────────────────────────────────────────────────────────────┐
│ Hono app (src/server.ts)                                     │
│   • requireApiKey middleware  → client_keys row              │
│   • requireAdmin middleware    → session / x-admin-key / open │
│   • csrfGuard on /admin/* POSTs                              │
└──────────────────────────────────────────────────────────────┘
    │
    │  /v1/chat/completions | /v1/messages | /v1/messages/count_tokens | /v1/models
    ▼
┌──────────────────────────────────────────────────────────────┐
│ handleProxy (minimax.ts + kiro/cb/pioneer/zai/combo helpers) │
│                                                              │
│  1. parseBody                                                │
│  2. resolve model: alias → upstream_model                    │
│  3. selectAccount  (sticky / round-robin / lowest-backoff)   │
│  4. check per-model lock                                     │
│  5. augmentRequest  (caveman system prompt + cache_control)  │
│  6. compress  (RTK runtime filter compression)              │
│  7. transform body  (OpenAI ↔ Anthropic per upstreamFormat)  │
│  8. upstreamFetch + SSE pipe                                 │
│  9. transform response back to client format                 │
│ 10. insertRequestLog  (cost, tokens, latency, account)       │
│ 11. applyAccountError  (backoff / lock on 4xx/5xx)           │
└──────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│ Upstream                                                     │
│  • MiniMax   (api.minimax.io / api.minimaxi.com)  HTTP-JSON   │
│  • Kiro      (CodeWhisperer / Amazon Q)  AWS event-stream    │
│  • CodeBuddy (codebuddy.ai)  OpenAI-compatible HTTP-JSON     │
│  • Pioneer  (api.pioneer.ai)  OpenAI-compatible HTTP-JSON    │
│  • Notion    (app.notion.com) cookie auth + JSON/NDJSON       │
│  • Z.AI      (api.z.ai) Bearer + Anthropic/OpenAI HTTP-JSON  │
└──────────────────────────────────────────────────────────────┘
```

A shared `reqId` is generated per request and threaded through every emit (`consoleBus`) and every `request_log` row for correlation.

## Module map (server)

```
src/
├── server.ts                 Hono app, routes, middleware wiring (≈ 330 LOC)
├── auth.ts                   requireApiKey, requireAdmin, csrfGuard, session cookie
├── auth/                     password (scrypt), session, rate limit
├── api/admin/                Admin API routes
│   ├── index.ts              Route wiring for all admin endpoints
│   ├── accounts.ts           CRUD: accounts, provider fields, refresh token
│   ├── aliases.ts            CRUD: model aliases (+ combo conflict check)
│   ├── auth.ts               POST /login, /logout, /check-password, /set-password
│   ├── clientKeys.ts         CRUD: client_keys (bearer tokens)
│   ├── models.ts             GET /models + seed; POST create/update
│   ├── overview.ts           GET / (provider health, usage sparkline)
│   ├── usage.ts              GET usage stats (request count, token sums)
│   ├── quota.ts              GET quota snapshots per account
│   ├── combos.ts             CRUD: combo models (fallback chains)
│   ├── transports.ts         CRUD: transports (relay/proxy/SOCKS config)
│   ├── settings.ts           GET /settings, POST key/value store
│   ├── requestLogs.ts        GET request logs (paginated, filterable)
│   ├── modelHealth.ts        GET model health (per-account lock status)
│   ├── cache.ts              POST /clear-cache (settings cache burst)
│   └── middleware.ts         Shared middleware for /api/admin/* routes
├── proxy/
│   ├── helpers.ts            Shared response/request utilities
│   ├── minimax.ts            handleProxy — MiniMax pipeline + per-provider dispatch (~534 LOC)
│   ├── kiro.ts               handleKiroProxy — Kiro pipeline (~327 LOC)
│   ├── codebuddy.ts          handleCodeBuddyProxy — CodeBuddy pipeline (~363 LOC)
│   ├── pioneer.ts            handlePioneerProxy — Pioneer pipeline (~363 LOC)
│   ├── notion.ts             handleNotionProxy — Notion pipeline (~445 LOC)
│   ├── zai.ts                handleZaiProxy — Z.AI pipeline (~367 LOC)
│   ├── combo.ts              handleComboProxy — combo routing (~429 LOC)
│   ├── pipeline.ts           Pure helpers extracted from the proxy handlers (buildLogRow, applyErrorState, …)
│   ├── capture.ts            Request/response body capture (truncate + headersToJson)
│   └── errorHandling.ts      Shared error response shaping
├── accounts/                 Account selection state machine
│   ├── selection.ts          sticky / round-robin / lowest-backoff picker
│   ├── state.ts              applyAccountError, isModelLockActive
│   ├── locks.ts              per-model locks (TTL)
│   ├── backoff.ts            exponential backoff level helpers
│   ├── errorRules.ts         base_resp / HTTP status → decision
│   └── types.ts              AccountState, ModelLock, SelectionOpts
├── providers/
│   ├── format/               OpenAI ↔ Anthropic body + stream conversion
│   │   ├── transform.ts      bodyOpenAIToAnthropic + bodyAnthropicToOpenAI + response counterparts
│   │   ├── negotiate.ts      client format detection + per-provider upstreamFormat override
│   │   └── messageTypes.ts   shared body/message types
│   ├── common/               shared provider internals
│   │   └── SseAssemblerBase.ts  abstract template-method for Anthropic-SSE emitters
│   │                           (shared by Kiro + CodeBuddy; see "Provider layer" below)
│   ├── kiro/                 Kiro protocol stack
│   │   ├── auth.ts           ensureAccessToken (refresh + persist)
│   │   ├── tokenRefresh.ts   AWS SSO OIDC vs Kiro social refresh
│   │   ├── transform.ts      buildKiroPayload (OpenAI → CodeWhisperer)
│   │   ├── eventstream.ts    binary frame decoder
│   │   ├── assembler.ts      → OpenAI SSE chunks (own I/O type; not SseAssemblerBase)
│   │   ├── anthropicSse.ts   → Anthropic Messages SSE (extends SseAssemblerBase<KiroEvent>)
│   │   ├── index.ts          executeKiro (orchestrator)
│   │   ├── deviceCode.ts     AWS Builder ID / IDC device code flow
│   │   ├── accountImport.ts  buildKiroAccountFields (token / idc / social)
│   │   ├── autoImport.ts     one-click import from ~/.aws/sso/cache
│   │   ├── profile.ts        Kiro profile/region resolution
│   │   ├── chunkAccumulator.ts  stream chunk aggregation
│   │   ├── streamConsumer.ts NDJSON → OpenAI delta assembly
│   │   ├── constants.ts      Kiro-specific constants
│   │   └── usage.ts          Kiro usage extraction
│   ├── codebuddy/            CodeBuddy protocol stack
│   │   ├── index.ts          executeCodeBuddy orchestrator
│   │   ├── transform.ts      prepareCodeBuddyBody (client → OpenAI upstream)
│   │   └── streamConvert.ts  aggregate + OpenAI SSE → Anthropic SSE
│   │                         (extends SseAssemblerBase<OpenAIStreamChunk>)
│   ├── pioneer/             Pioneer protocol (OpenAI CC + X-API-Key;
│   │                         reuses CodeBuddy SSE bridge)
│   │   ├── index.ts          execute orchestrator
│   │   ├── transform.ts      client → OpenAI upstream body
│   │   └── models.ts         pioneer/ namespaced model catalogue
│   ├── notion/              Notion protocol (CRDT-style JSON + NDJSON patch-stream;
│   │                         cookie-based session, no schema migration — provider_data JSON)
│   │   ├── auth.ts           3-step OTP login + cookie persistence
│   │   ├── transform.ts      buildNotionPayload (client → Notion JSON)
│   │   ├── extract.ts        NDJSON patch-stream → OpenAI delta assembly
│   │   ├── constants.ts      Notion-specific constants (cookie list, endpoint)
│   │   └── manifest.json     20-row builtin model catalogue
│   ├── zai/                  Z.AI protocol (Anthropic Messages + OpenAI CC;
│   │                         Bearer API key, single key per account)
│   │   ├── index.ts          execute orchestrator
│   │   ├── transform.ts      client → upstream body (Anthropic or OpenAI)
│   │   └── models.ts         zai/ namespaced model catalogue
│   ├── alias.ts              resolveModel — alias/combo/prefix → upstreamModel
│   ├── aliasCache.ts         in-process alias cache (per-request ctx)
│   ├── modelPrefix.ts        parseModelPrefix — <prefix>/<name> split + PREFIX_TO_PROVIDER map
│   ├── minimax.ts            MiniMax provider constants + URL/header builders
│   ├── baseUrl.ts            MiniMax region switch (intl/cn)
│   ├── headers.ts            upstream auth/header builders
│   ├── parseError.ts         base_resp.status_code extractor
│   ├── pricing.ts            per-model USD pricing
│   ├── quota.ts              quota pull
│   ├── upstreamFetch.ts      fetch w/ transport (proxy/relay/direct)
│   └── listModels.ts         MiniMax /v1/models fetcher
├── caveman/                  System-prompt compression (wired in step 5)
├── rtk/                      Runtime filter compression (wired in step 6)
├── streaming/                pipeWithUsage, extractUsage
├── transport/                undici dispatcher cache + SOCKS proxy loader
│   ├── resolve.ts            resolveTransportForAccount — per-account transport
│   ├── geoip.ts              country probe via ipapi.co on transport add
│   ├── proxyFetch.ts         undici Agent builder w/ proxy settings
│   ├── dispatcherCache.ts    per-transport dispatcher cache
│   ├── socksLoader.ts        SockSocket factory (socks5/socks4 client)
│   ├── resolvedCache.ts      resolved transport cache
│   └── types.ts              TransportConfig discriminated union
├── console/                  Live flow event bus
│   ├── bus.ts                ring buffer + SSE subscribe
│   ├── flow.ts               FlowEvent builders + reqId gen
│   ├── format.ts             ANSI renderer
│   ├── sink.ts               stdout sink (CONSOLE_FLOW env gate)
│   └── types.ts              FlowEvent discriminated union
├── scheduler/quotaPull.ts    Background tick: quota pull + log prune
├── cache-injection.ts        caveman system prompt + cache_control dual breakpoints
├── runtime/                  per-request context (rrCursor, stickyMap, getDb)
├── db/
│   ├── index.ts              openDb() — branches on getDbKey(): plaintext via better-sqlite3,
│   │                         SQLCipher via better-sqlite3-multiple-ciphers when ROUTER_DB_KEY set
│   │                         (key applied via pragma('key') BEFORE any other PRAGMA;
│   │                         refuses to start if key set on a plaintext DB — fresh-deploy only)
│   ├── migrations/           001-initial, 002-kiro, 003-transports, 004-reqid, 005-combos, 006-transport-country, 007-audit-log, 008-pioneer-dedup, 009-pioneer-anthropic-dedup, 010-model-context-output (Notion: provider_data JSON carries cookies + spaceId, no schema migration)
│   └── repos/                One file per table: accounts, client_keys, models,
│                             aliases, combos, requestLogs, quotaSnapshots,
│                             transports, settings (1s cache)
└── util/                     env, log
```

## Module map (client)

```
client/src/
├── main.tsx                  Preact entry
├── App.tsx                   QueryClientProvider + PrimeCache + AppShell
├── layout/AppShell.tsx       Sidebar + top bar + hash router (#/admin/<page>)
├── pages/                    14 pages: Overview, Usage, Accounts, Aliases, Models,
│                             ClientKeys, Combos, Quota, Transports, Settings,
│                             Console, RequestDetail, Login, NotFound
├── components/               Card, Stat, Badge, Button, Modal, Toast,
│                             CommandPalette, ErrorState, Skeleton, Confirm, …
├── hooks/                    useKiroDeviceFlow, useKiroAutoImport
├── lib/                      api.ts (apiFetch), queryClient, relativeTime
└── styles/                   base.css (Obsidian Gold tokens), components.css,
                              animations.css
```

The client is a Preact SPA — NOT server-rendered. The Hono app exposes a JSON API under `/api/admin/*`; the SPA consumes it via `apiFetch`. Built with Vite, bundled into `client/dist/`, served as static assets by the Hono app in production. In Docker, `client/dist` is baked at build time and copied to runtime.

## State machines

### Account selection (per request)

```
┌──────────────────────────────────────────────────────────────┐
│ listAccounts(provider=…) → filter to enabled + not backoff   │
└──────────────────┬───────────────────────────────────────────┘
                   ▼
         ┌─────────────────────┐
         │  mode?  (settings)  │
         └──────┬──────────────┘
                │
   ┌────────────┼────────────┐
   │            │            │
   ▼            ▼            ▼
sticky     round-robin   lowest-backoff
   │            │            │
   │  pinned &  │  cursor/   │  sort by
   │  available │  step % N  │  backoffLevel asc
   │  → return  │  → return  │  → return first
   │            │            │
   └────────────┴────────────┘
                │
                ▼
       ┌─────────────────┐
       │  no candidate?  │
       │  → 503 with     │
       │  reason=mode    │
       └─────────────────┘
```

`sticky` pins the first selected account to a `clientKeyId` in an in-memory `Map`. `round-robin` advances a per-provider cursor every `step` requests. `lowest-backoff` is the default — picks the healthiest available.

### Error → backoff (applyAccountError)

```
base_resp_code / HTTP status
        │
        ▼
  errorRules.checkFallbackError()
        │
        ├─ 1002 (rate limit)        → cooldownMs = 30s
        ├─ 1008 (balance)           → permanent lock
        ├─ 1013 (server busy)       → cooldownMs = 5s
        ├─ 1027 (rate limit variant)→ cooldownMs = 30s
        ├─ 1039 (token limit)       → per-model lock
        ├─ 2013 (param)             → permanent lock
        ├─ 401                       → account.status = 'error'
        ├─ 429 + Retry-After         → cooldownMs = retryAfter
        └─ 5xx                       → exponential backoff level++
```

`backoffLevel` is per-account, persists in `accounts.rate_limited_until` and `accounts.backoff_level`. `selectAccount` filters by `isAccountUnavailable` (rate_limited_until > now). Resets to 0 on next success.

### Model lock

`account_model_locks(account_id, model, locked_until)`. Inserted on certain error classes (e.g. 1039). `selectAccount` short-circuits to 429 with `error: 'model_locked'` for the locked `(account, model)` pair. TTL is short (seconds to minutes); the proxy checks `isModelLockActive(lock)` before every request.

## Data flow per request

```
HTTP in
  ↓
csrfGuard (admin only) → requireApiKey (proxy) / requireAdmin (admin)
  ↓
parseBody (c.req.json / c.req.parseBody)
  ↓
model resolution
  • parseModelPrefix(model): mx/|kr/|cb/|pio/|nt/|zai/ selects provider via literal,
    provider-matched lookup; unprefixed resolves only via combos/aliases (strict)
  • aliasCache.lookup(model) → upstream_model
  • -thinking / -agentic suffix handling
  • M3 max_completion_tokens
  ↓
provider routing (resolved.provider)
  • combo name      → handleComboProxy (walk fallback members)
  • 'kiro'          → handleKiroProxy
  • 'codebuddy'     → handleCodeBuddyProxy
  • 'pioneer'       → handlePioneerProxy
  • 'zai'           → handleZaiProxy
  • else (minimax)  → continue MiniMax path
  ↓
consoleBus.emit('start', { reqId, model, endpoint })
  ↓
selectAccount(db, provider, opts)
  ↓
getModelLock(accountId, model) → 429 if active
  ↓
augmentRequest(body) — caveman + cache_control
  ↓
RTK compress body
  ↓
bodyOpenAIToAnthropic / bodyAnthropicToOpenAI (per upstreamFormat)
  ↓
resolveTransportForAccount(account) → TransportConfig
  ↓
upstreamFetch(url, body, headers, transport)
  ↓
  • streaming → pipeWithUsage → extractUsage
  • buffered  → resp.json/text
  ↓
response transform back to client format
  ↓
consoleBus.emit('done', { reqId, status, latency, ttft, tokens, cost })
  ↓
insertRequestLog(row)
  ↓
on error: applyAccountError → emit('error')
HTTP out
```

The `emit('start' | 'done' | 'error')` lines above are conceptual; the actual builders are `buildStart` / `buildAccount` / `buildDone` / `buildError` in `src/console/flow.ts` — every provider handler emits start → account → done/error with a `request_log` row on every terminal path, and combo requests share one `reqId` across delegated legs (combo delegates via `parentReqId`, so one combo request is one console thread; minimax emits `buildStart` after model resolution + before `buildAccount`).

## Two-tier auth

| Layer | Token | Source | Where it travels |
|---|---|---|---|
| Client (proxy) | `client_keys.key` | Dashboard → copy bearer | `Authorization: Bearer …` from client to router |
| Admin (dashboard) | session cookie OR `x-admin-key` header | Password set in `/admin/settings` (scrypt) OR `ROUTER_ADMIN_KEY` env | Browser cookie / script header |

**Never** mix these. Client never sees upstream MiniMax/Kiro keys; upstream never sees client bearers.

## Storage

`~/.local/share/kelola-router/router.db` (override: `ROUTER_DB_PATH`). WAL journal, foreign keys on, 5s busy timeout. Migrations tracked via `PRAGMA user_version` (current = 10). All migrations live in `src/db/migrations/`; one file per migration, additive ALTERs when possible (e.g. `002-kiro` adds `provider` / `access_token` etc. without rewriting rows).

**Optional encryption-at-rest** via `ROUTER_DB_KEY` (read by `getDbKey()` in `src/util/env.ts`). When set, `openDb()` swaps to `better-sqlite3-multiple-ciphers` and issues `PRAGMA key = '...'` as the FIRST statement on the fresh handle (SQLCipher requires the key before any other PRAGMA). The cipher fork is structurally identical to `better-sqlite3` at runtime — repos see the same `Database` type via a single cast at the `openDatabase()` boundary, no repo changes anywhere else.

**Fresh-deploy-only policy.** Setting `ROUTER_DB_KEY` against an existing unencrypted file refuses to start with a clear error; no in-place `--rekey` migration. The detection signal is the raw 16-byte SQLite header (the `cipher_version` pragma is unreliable in this fork — returns `[]` regardless of state). New deploys created under the key are encrypted from byte 0.

## Provider layer — Anthropic-SSE assembly

`src/providers/common/SseAssemblerBase.ts` is an abstract template-method base for Anthropic Messages-SSE emitters. Generic over `<TInput, TOutput = AnthropicEvent>`. Owns the shared state machine (`ensureStart` / `closeBlock` / `openBlock`) plus an async-iteration queue; subclasses implement five hooks:

- `createStartEvent()` — emit the `message_start` payload
- `createBlockEvent(input): BlockSpec | null` — describe a new `content_block_start` (or return null to skip)
- `createDeltaEvent(input): AnthropicEvent | null` — emit one `content_block_delta` (or null if no delta)
- `createFinishEvent(): AnthropicEvent[]` — emit `message_delta` + `message_stop`
- `getErrorEvent(err): AnthropicEvent` — wrap an upstream error

Concrete subclasses:

- **`KiroAnthropicAssembler`** (`src/providers/kiro/anthropicSse.ts`, `TInput = KiroEvent`) — translates decoded Kiro event-stream frames to Anthropic SSE; overrides `process()` to route richer Kiro event types (tool-use, metadata, messageStop) through the inherited state machine.
- **`OpenAIToAnthropicSSEAssembler`** (`src/providers/codebuddy/streamConvert.ts`, `TInput = OpenAIStreamChunk`) — translates aggregated OpenAI chunks to Anthropic SSE; uses the default 1-block-1-delta orchestrator without overriding `process()`. Pioneer reuses this same assembler (and the `aggregateOpenAISSE` / `openaiSSEToAnthropicSSE` bridge) — no Pioneer-specific assembler.

**Not in scope.** `KiroAssembler` (`src/providers/kiro/assembler.ts`, → OpenAI SSE) does NOT extend the base — its I/O type is OpenAI chunks, not Anthropic events, and it predates the template-method. Leaving it untouched keeps the base generic for Anthropic-SSE only.

## Key invariants

- `client_keys.key` is unique per active row. Soft-deleted keys keep their row.
- One `accounts` row per upstream key per provider. `provider='kiro'` rows store the OAuth refresh token in `api_key` and the cached short-lived bearer in `access_token`.
- `models.upstream_model` is unique (index).
- `model_aliases.alias_name` is unique and conflicts with `combos.name` (enforced in `createCombo`).
- `transports` are referenced by `accounts.relay_id` / `proxy_id` / `proxy_pool` (JSON array). Mutual exclusion: a row has at most one of `relay_id` / `proxy_id` / `proxy_pool` non-null.
- `request_logs` rows are pruned at `REQUEST_LOG_RETENTION_DAYS` (default 30) by the quota-pull scheduler.
- `settings.*` reads cache for 1s (`src/db/repos/settings.ts`). Call `clearCacheForDb(db)` in tests.

## Where to look next

- Proxy pipeline deep-dive → `AGENTS.md` "Architecture (one-page)"
- Provider-specific quirks (MiniMax base_resp, Kiro event-stream) → `AGENTS.md` "MiniMax quirks" + "Kiro provider"
- Data model → `src/db/migrations/001-initial.ts` (all tables consolidated)
- Live flow event types → `src/console/types.ts`
- Test patterns → `AGENTS.md` "Test patterns"
