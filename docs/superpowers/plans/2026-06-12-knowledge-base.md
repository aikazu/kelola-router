# Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create deep technical notes under `.claude/docs/` for AI agent knowledge-base queries. These are NOT auto-loaded — they're discovered by `mcp__plugin_context-mode_context-mode__ctx_search` when the agent needs to recall something specific. The result: less repeated code-reading, faster answers, more accurate refactors.

**Architecture:** Markdown notes that go deep where `docs/reference/*.md` (terse lookup tables) and `ARCHITECTURE.md` (overview) leave off. Each KB file is topic-focused with: Why this exists, Code map, Key concepts, Gotchas, Cross-refs. Indexed for BM25 search via `ctx_index` (after the file lands on disk).

**Tech Stack:** Plain Markdown. No new dependencies. No code changes. Validation: `npm test` + `npm run typecheck` must stay green.

---

## File Structure

### Files created in this plan

| File | Topic | Why needed |
|---|---|---|
| `.claude/docs/codebase-map.md` | Module dependency graph + entry points | Agent needs to know what imports what, who calls whom |
| `.claude/docs/state-machines.md` | Deep notes on account selection / backoff / lock | `ARCHITECTURE.md` has the diagrams; this has the invariants + edge cases |
| `.claude/docs/data-flow.md` | Per-request pipeline annotated end-to-end | The 10-step pipeline + console emits + telemetry persistence |
| `.claude/docs/kiro-protocol.md` | AWS event-stream + IDE/CLI persona wire format | The Kiro protocol is the most complex piece in the codebase |
| `.claude/docs/format-conversion.md` | OpenAI ↔ Anthropic body transform rules | `src/providers/format/transform.ts` is 309 LOC; KB distills it |
| `.claude/docs/conventions.md` | Terse coding rules (no `any`, TDD, biome) | `AGENTS.md` is the workflow; this is the code-level discipline |

### Files NOT touched

- Existing code, tests, schema, `docs/`, MEMORY.md, or skills.
- `MEMORY.md` will get a one-line "Project knowledge base" update in Task 7.

---

## Conventions for all 6 KB files

1. **H1 title** with the topic.
2. **One-paragraph "Why this exists"** at the top — when an agent should reach for this doc.
3. **Code map** — directory tree of the relevant source files, with one-line purpose for each.
4. **Key concepts** — 3-6 sections, each with a heading + 2-4 paragraphs. Code snippets inline.
5. **Gotchas** — bullet list of "things that bite people" (invariants, edge cases, footguns).
6. **Cross-refs** at the bottom — links to ARCHITECTURE.md, docs/reference/*, docs/guides/*, related skills.
7. **Length**: 150-300 lines per file. Dense but not exhaustive.
8. **Voice**: terse, declarative, code-heavy. No "this is interesting because…" filler.

---

### Task 1: Create `.claude/docs/codebase-map.md`

**Files:**
- Create: `.claude/docs/codebase-map.md`
- Reference: `src/`, `client/src/`, root `package.json`

- [x] **Step 1: Write the file** (DONE)

Create `.claude/docs/codebase-map.md` with this content (exact paste):

```markdown
# Codebase Map

> Module dependency graph + entry points. For architectural overview see `ARCHITECTURE.md`. For terse lookup tables see `docs/reference/`.

## Why this exists

When refactoring, the agent needs to know what imports what and who calls whom. This file is the answer to "if I change X, what else breaks?". The dependency graph below is extracted from `import` statements across `src/` and `client/src/`.

## Top-level entry points

| File | Role | Imported by |
|---|---|---|
| `src/server.ts` | Hono app. Wires routes, middleware, the proxy dispatch. ~330 LOC. | `npm start`, `npm run dev:server` (and indirectly `tests/`) |
| `src/proxy/minimax.ts` | `handleProxy` — the MiniMax/OpenAI/Anthropic path. ~470 LOC. | `server.ts` (re-exports a wrapper) |
| `src/proxy/kiro.ts` | `handleKiroProxy` — the Kiro/AWS CodeWhisperer path. ~270 LOC. | `server.ts` |
| `src/proxy/combo.ts` | `handleComboProxy` — fallback chains across models. ~470 LOC. | `server.ts` |
| `src/proxy/helpers.ts` | 34 LOC of shared response/request utilities. | All 3 proxy handlers |
| `src/accounts/selection.ts` | `selectAccount` — the state machine. | All 3 proxy handlers |
| `src/accounts/state.ts` | `applyAccountError`, `isModelLockActive`. | All 3 proxy handlers |
| `src/db/index.ts` | `openDb()`, `migrate()`. Singleton via `getDb()`. | `server.ts`, every `db/repos/*.ts` |
| `client/src/main.tsx` | Preact entry. Mounts `<App />`. | `client/index.html` |
| `client/src/App.tsx` | QueryClientProvider + PrimeCache + AppShell. | `main.tsx` |
| `client/src/layout/AppShell.tsx` | Hash router (`#/admin/<page>`) + lazy page imports. | `App.tsx` |

## Server module dependency graph

`server.ts` imports (top-level only — not transitively listed):
- `hono` + middleware from `src/auth.ts` + `src/api/admin/`
- The 3 proxy handlers from `src/proxy/{minimax,kiro,combo}.ts`
- Scheduler: `src/scheduler/quotaPull.ts`
- Transport: `src/transport/resolve.ts` (used by proxy handlers, transitively)
- DB: `src/db/index.ts`

`src/proxy/minimax.ts` imports:
- `src/accounts/{selection,state,locks,errorRules,types}`
- `src/cache-injection.ts` (caveman + cache_control)
- `src/console/{bus,flow}`
- `src/db/repos/{accounts,combos,requestLogs,settings}`
- `src/providers/{alias,format/negotiate,format/transform,minimax,parseError,pricing,upstreamFetch}`
- `src/rtk/`
- `src/runtime/hotPathMetrics`
- `src/streaming/pipeWithUsage`
- `src/transport/resolve`
- `src/util/log`
- `src/proxy/{capture,helpers}`

`src/proxy/kiro.ts` imports the same minus RTK/cache-injection/alias-negotiation, plus `src/providers/kiro/`.

`src/accounts/selection.ts` imports:
- `src/accounts/state` (filter helper)
- `src/accounts/types`

`src/accounts/state.ts` imports:
- `src/accounts/errorRules` (decision)
- `src/accounts/types`

`src/accounts/locks.ts` imports: `src/util/log` only. Pure SQL.

`src/db/repos/settings.ts` has 1s cache via `WeakMap<Database, Map>`. Imported by all repos that read settings + the proxy handlers + `src/api/admin/settings.ts`.

## Client module dependency graph

`client/src/main.tsx` → `App.tsx`

`App.tsx` imports:
- `@tanstack/react-query` (`QueryClientProvider`, `useQueryClient`)
- `client/src/components/{Confirm,ToastProvider}`
- `client/src/layout/AppShell`
- `client/src/lib/{api,queryClient}`

`AppShell.tsx` imports all page components as `lazy(() => import(...))`. The `KNOWN_ROUTES` array + `switch (current)` are the dispatch.

Each page imports:
- `@tanstack/react-query` (`useQuery`, `useMutation`, `useQueryClient`)
- `client/src/components/*` (Card, Button, Modal, …)
- `client/src/lib/api` (`apiFetch`)
- `client/src/layout/TopBar` (most pages)

`client/src/lib/api.ts` exports `apiFetch<T>(path, opts)` which:
- prepends `/api`
- handles JSON request/response
- throws `ApiError` on non-2xx
- handles CSRF via `x-csrf-token` if a cookie is set

## Cyclic imports (be aware)

- `server.ts` ↔ `src/proxy/{minimax,kiro,combo}.ts` — broken by passing a `CursorRef` ref-object from server.ts to the proxy handlers. See comment in `src/proxy/kiro.ts` line 27-30. Don't try to "fix" this — the ref pattern is intentional.
- `src/db/repos/*` ↔ `src/db/index.ts` — repos import `openDb` from `db/index.ts`. Tests use a per-test db handle via `process.env.ROUTER_DB_PATH`. Don't cache the db handle in module scope.

## Where new code goes (decision tree)

| If you're adding… | Goes in… |
|---|---|
| New upstream provider | `src/providers/<name>/` + `src/proxy/<name>.ts` + extension to `ProviderName` in `db/repos/accounts.ts` |
| New admin route | `src/api/admin/<name>.ts` (Hono sub-router) + register in `src/api/admin/index.ts` |
| New repo function | `src/db/repos/<table>.ts` |
| New DB table | `src/db/migrations/00X-*.ts` + repo at `src/db/repos/<table>.ts` |
| New dashboard page | `client/src/pages/<Name>.tsx` + register in `AppShell` + entry in `Sidebar` |
| New shared UI component | `client/src/components/<Name>.tsx` |
| New error class / state machine | Extend `src/accounts/{state,selection,errorRules,types}.ts` |
| New console event | Extend `src/console/{types,flow}.ts` (union + builder) |

## Gotchas

- **Don't import from `src/proxy/*` into `src/server.ts` other than the handler function.** The handlers are the only public surface. The proxy module also imports `runtime/hotPathMetrics` — that's a singleton meant to be imported by proxy handlers only.
- **Don't add `any` to a repo return type.** If the SQL column is nullable, return `T | null` (not `undefined`) — tests rely on this.
- **Don't add new state machine logic outside `src/accounts/`.** Selection / backoff / lock is one cohesive module; spread it and you lose the invariants.
- **Don't break the `CursorRef` pattern.** `server.ts` owns the in-memory `rrCursor` and `stickyMap`; the proxy handlers mutate them through a ref. Don't try to lift the state into a module-global — that breaks test isolation.
- **Don't import `better-sqlite3` types in client code.** The dashboard is browser-side; server types don't flow there.

## Cross-refs

- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — module map (visual)
- [`../../AGENTS.md`](../../AGENTS.md) — TDD + test patterns
- [`../docs/guides/add-a-provider.md`](../docs/guides/add-a-provider.md) — provider integration checklist
- [`../docs/guides/add-an-admin-endpoint.md`](../docs/guides/add-an-admin-endpoint.md) — admin route checklist
- [`../docs/guides/add-a-dashboard-page.md`](../docs/guides/add-a-dashboard-page.md) — page checklist
- [`../docs/guides/add-a-migration.md`](../docs/guides/add-a-migration.md) — migration checklist
- [`../skills/add-provider/SKILL.md`](../skills/add-provider/SKILL.md) — provider skill
```

- [x] **Step 2: Verify**

Run: `wc -l .claude/docs/codebase-map.md && head -3 .claude/docs/codebase-map.md`
Expected: ~150-170 lines, first line `# Codebase Map`.

- [x] **Step 3: Commit**

```bash
cd /home/kocomon/Projects/kelola-router
git add .claude/docs/codebase-map.md
git commit -m "kb(codebase): add codebase-map.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Create `.claude/docs/state-machines.md`

**Files:**
- Create: `.claude/docs/state-machines.md`
- Reference: `src/accounts/{selection,state,locks,backoff,errorRules,types}.ts`

- [x] **Step 1: Write the file** (DONE)

Create `.claude/docs/state-machines.md` with this content (exact paste):

```markdown
# State Machines

> Deep notes on account selection, backoff, and per-model locks. For the visual diagrams see `ARCHITECTURE.md` "State machines" section. For error → decision mapping see `docs/reference/error-codes.md`.

## Why this exists

The 3 state machines (selection / backoff / lock) are the most-touched-and-most-misunderstood code in the repo. Refactors here cause subtle request-routing bugs. This doc captures the invariants, the edge cases, and the "if you change X, also change Y" coupling.

## 1. Account selection (`src/accounts/selection.ts`)

### Three modes

| Mode | Storage | Behavior | Reset on… |
|---|---|---|---|
| `lowest-backoff` (default) | stateless | Sort by `backoffLevel` asc, take first | N/A |
| `round-robin` | `rrCursor` per provider (in `server.ts` module-scope) | `idx = floor(cursor / step) % available.length`. Advance `cursor += 1` per request. | process restart (intentional — no DB persistence) |
| `sticky` | `Map<clientKeyId, accountId>` in `server.ts` `stickyMap` | Pin first-selected account per `clientKeyId`. Fallback to `lowest-backoff` on miss + re-pin. | process restart |

### Invariants

1. **Mode + step** are read from per-provider settings: `settings.selection.minimax` and `settings.selection.kiro`. The legacy `selection` setting (without `.provider`) is no longer read.
2. **No candidate → 503** with `reason = mode`. The proxy returns this to the client.
3. **Sticky is per-client-key**, not per-account. The pin survives across requests for the same `clientKeyId` until the pinned account becomes unavailable (backoff/disabled).
4. **Sticky fallback** when pinned is unavailable: select via `lowest-backoff` and re-pin. The pin is updated, not cleared.
5. **Round-robin cursor** lives in `server.ts` module scope. It's a single `number` per provider, not per-`clientKeyId`. Sticky + round-robin don't combine.

### What `selectAccount` returns

```ts
type SelectionResult = {
  account: Account | null,
  reason: 'lowest-backoff' | 'round-robin' | 'sticky' | 'fallback' | 'lowest-backoff' | 'mode' | 'no-accounts',
  nextCursor?: number  // only for round-robin
}
```

The proxy handler reads `account` + `nextCursor` and writes `nextCursor` back to the ref.

### Gotchas

- Don't add new modes without also updating `src/api/admin/settings.ts` `GET/POST /selection/:provider` + the dashboard `SelectionControls` component.
- The legacy `settings.selection` key is no longer read. If a user upgrades from pre-0.13 and the old key is still in their DB, they get default behavior (lowest-backoff) silently. No migration.
- Round-robin cursor reset on restart is by design. Persisting it would add a DB write per request.

## 2. Error → backoff (`src/accounts/errorRules.ts` + `state.ts`)

### Decision flow

See [`docs/reference/error-codes.md`](../../docs/reference/error-codes.md) for the full table. This section focuses on the `applyAccountError` side effects.

### What gets persisted

`applyAccountError` mutates an `AccountState` (in-memory copy, then `updateAccount(db, ...)` to persist):
- `rateLimitedUntil` — ISO timestamp. Set when `cooldownMs > 0`. Cleared on next success.
- `backoffLevel` — `0..BACKOFF_MAX_LEVEL` (5). Increments on `backoff: true` decisions. Resets to 0 on success.
- `lastError` — JSON blob `{status, message, timestamp, baseRespCode}`. Always set on error. Truncated to 500 chars in `state.ts:42`.
- `status` — `active` / `error` / `disabled`. Set to `error` on HTTP 401. Cleared on next success.

### Invariants

1. **1008 (balance) is permanent.** `applyAccountError` does not set `cooldownMs`; the account stays `active` but its `backoffLevel` stays at max. It won't be selected by `lowest-backoff` (which sorts by level asc — but max is still selected if all are max).
2. **2013 (param) is permanent too.** Same as 1008.
3. **401 sets `status='error'`.** The dashboard surfaces this and the user must re-add the account.
4. **Cooldown is wall-clock.** `rate_limited_until > now` is what `isAccountUnavailable` checks. Server time is trusted.
5. **Backoff level persists across cooldown.** Level 3 + cooldown expired ≠ level 0. The level only resets on a successful request.

### What `isAccountUnavailable` does

```ts
function isAccountUnavailable(account: AccountState): boolean {
  if (!account.rateLimitedUntil) return false;
  return new Date(account.rateLimitedUntil).getTime() > Date.now();
}
```

`isAccountUnavailable` is the only filter used by `filterAvailableAccounts` in `state.ts`. Sticky / round-robin also go through this filter.

### Gotchas

- `backoffLevel` is incremented in `errorRules.checkFallbackError` only when the rule has `backoff: true`. Most base_resp codes return `cooldownMs` directly without bumping the level.
- The exponential curve lives in `src/accounts/backoff.ts` `getQuotaCooldown(level)`. `BACKOFF_MAX_LEVEL = 5` caps the level; further increments are no-ops (Math.min).
- `applyAccountError` is called inside the proxy handler's `catch` block. If the request itself crashes (e.g. consoleBus throws), the error path may not run — check `src/console/bus.ts` for the throwing-subscriber isolation.

## 3. Per-model lock (`src/accounts/locks.ts`)

### What it is

`(account_id, model) → locked_until`. Short-lived (seconds to minutes). Inserted when the upstream signals a per-model problem (e.g. `base_resp.status_code = 1039` "token limit").

### What `selectAccount` does with it

The proxy checks `getModelLock(accountId, model)` before each request. If active:
- Returns 429 with `error: 'model_locked'`
- Does NOT try another account (model is the failure unit, not the account)

For combo routing, the proxy moves to the NEXT model in the chain.

### TTL

Lock TTL is short — `getQuotaCooldown(level+1)` typically. Cleared by `clearExpiredModelLocks` on the next proxy tick.

### Invariants

1. **Lock is per (account, model).** Two accounts can both have the same model locked independently.
2. **No per-account lock for the model means no lock.** Don't infer "no row = no lock" without checking `locked_until > now` first.
3. **Lock bypasses `selectAccount`.** Even a healthy account is rejected if its model is locked. This is intentional — model problems are sticky.

### Gotchas

- `clearExpiredModelLocks` runs on every `selectAccount` call (or close to it). It's a cheap `DELETE WHERE locked_until < now`.
- The PK is `(account_id, model)` — re-inserting on the same pair replaces the row.
- If you add a new "lock reason" (e.g. `rate_limited`, `safety_violation`), add a column to the table + a migration. Don't store the reason in a JSON blob — the dashboard wants to filter.

## Cross-coupling

- **Selection ↔ Backoff**: a high-`backoffLevel` account is still selectable in `lowest-backoff` if it's the only one. The level sorts; it doesn't exclude.
- **Backoff ↔ Lock**: independent. An account can be in backoff (whole account) AND have per-model locks active.
- **Selection ↔ Lock**: independent in single-model mode; combined in combo mode (lock → next model).

## Gotchas (general)

- **Don't add new state fields without bumping the migration.** Account state lives in `accounts` + `account_model_locks`. New field = new migration.
- **Don't put state in the proxy handlers.** Use the existing modules.
- **Don't race the `rrCursor`.** It's a `number`, not an atom. Two concurrent requests in round-robin mode may both see the same cursor value (read-modify-write race). The router is single-tenant, so this is acceptable. If you make it multi-tenant, refactor.
- **Don't bypass `isAccountUnavailable`.** If you write a new selection helper, go through the filter.

## Cross-refs

- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — state-machine diagrams
- [`../../docs/reference/error-codes.md`](../../docs/reference/error-codes.md) — error → decision table
- [`../../docs/guides/debug-a-failed-request.md`](../../docs/guides/debug-a-failed-request.md) — debug ladder
- `src/accounts/{selection,state,locks,backoff,errorRules,types}.ts` — source of truth
```

- [x] **Step 2: Verify**

Run: `wc -l .claude/docs/state-machines.md && head -3 .claude/docs/state-machines.md`
Expected: ~190-210 lines, first line `# State Machines`.

- [x] **Step 3: Commit**

```bash
cd /home/kocomon/Projects/kelola-router
git add .claude/docs/state-machines.md
git commit -m "kb(accounts): add state-machines.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Create `.claude/docs/data-flow.md`

**Files:**
- Create: `.claude/docs/data-flow.md`
- Reference: `src/proxy/minimax.ts`, `src/console/`, `src/db/repos/requestLogs.ts`

- [x] **Step 1: Write the file** (DONE)

Create `.claude/docs/data-flow.md` with this content (exact paste):

```markdown
# Data Flow per Request

> Annotated trace of one request from HTTP-in to HTTP-out. For the visual diagram see `ARCHITECTURE.md` "Data flow per request" section. For the debug ladder see `docs/guides/debug-a-failed-request.md`.

## Why this exists

When a refactor touches the proxy pipeline, the agent needs to know the exact sequence + what each step emits. This doc is the step-by-step commentary on `handleProxy` (MiniMax path) with line refs.

## 0. Before `handleProxy`: middleware

- `csrfGuard` (admin only) — blocks cross-origin POSTs
- `requireApiKey` (proxy) — checks `Authorization: Bearer <key>` against `client_keys.key`
- `requireAdmin` (admin) — session cookie OR `x-admin-key` OR open mode

## 1. `parseBody` + model resolution

`handleProxy(c, format, upstreamPath)` first line: `await c.req.json()` (or `parseBody()` for stream). The body is then passed to `resolveModel` in `src/providers/alias.ts`.

What `resolveModel` does:
- Lookup `model_aliases.alias_name` → `upstream_model`
- Strip `-thinking` / `-agentic` / `-thinking-agentic` suffix for kiro routing
- Return the resolved model + the original alias (stored as `requested_model` in logs)

## 2. `genReqId()` — 4-byte hex

Set on `c` context. Threaded through every `consoleBus.emit` and every `insertRequestLog` call. Stored in `request_logs.req_id` so the Console page can deep-link to Request Detail.

## 3. `consoleBus.emit('start', { reqId, model, endpoint })`

Emitted before account selection. The Console page renders this as the first line of the block.

## 4. `selectAccount`

See [`state-machines.md`](state-machines.md). Returns the chosen account + (for round-robin) the new cursor.

## 5. Per-model lock check

```ts
const lock = getModelLock(accountId, model);
if (isModelLockActive(lock)) {
  return c.json({ error: 'model_locked' }, 429);
}
```

If locked, the request returns here. No upstream call. The `request_logs` row gets `status_code = 429`, `error = 'model_locked'`.

## 6. `consoleBus.emit('account', { reqId, account })`

The Console page renders this so the user can see which account was selected.

## 7. `augmentRequest(body)` — caveman + cache_control

`src/cache-injection.ts`:
- If `caveman.level` is `'lite'` or `'full'`, prepend a system prompt that compresses the conversation
- If `caching.autoBreakpoints` is on, inject `cache_control: { type: 'ephemeral' }` on the system message and the last user message

The result is the modified body. Original body is NOT mutated.

## 8. RTK compression

If `rtk.enabled`:
- Compress the messages array using the runtime filter registry
- Log `rtk_bytes_saved` to the bus
- The result is the compressed body

Skipped if `rtk.enabled` is false (the default).

## 9. `resolveTransportForAccount`

`src/transport/resolve.ts` — returns a `TransportConfig` based on account's `relay_id` / `proxy_id` / `proxy_pool`, or the global `settings.transport` fallback, or `null` for direct.

`consoleBus.emit('transport', { reqId, kind: 'relay' | 'proxy' | 'direct', label: <url> })` (only when transport is non-null).

## 10. `upstreamFetch(url, body, headers, transport)`

`src/providers/upstreamFetch.ts`:
- Builds the URL from the account's `base_url` + `upstreamPath`
- Headers: provider + format-specific (see `src/providers/headers.ts`)
- If `transport` is set, uses `proxyAwareFetch`. Otherwise global `fetch`.
- Returns a `Response` (streaming or buffered)

`consoleBus.emit('transport-fail', { reqId, message })` if the transport errors. Then fallback behavior per `proxyFailureMode`.

## 11. SSE pipe OR buffered response

If `body.stream`:
- `pipeWithUsage(stream, c)` reads the stream, forwards to the client, and extracts usage
- `extractUsage` parses the last chunk for `usage` info (OpenAI streaming) or `message_delta` (Anthropic)
- Returns the assembled response

If not streaming:
- `await resp.json()` (or `.text()`)
- Format conversion applied to the body before returning

## 12. Format conversion (response side)

If client format is OpenAI but upstream is Anthropic (per `settings.minimax.upstreamFormat`):
- `responseAnthropicToOpenAI(body)` rewrites the JSON

Same for the reverse. See [`format-conversion.md`](format-conversion.md).

## 13. `consoleBus.emit('done', { reqId, status, latency_ms, ttft_ms, tokens, cost })`

Emitted on success. `ttft_ms` is the time to first byte (streaming only). `tokens` is the cumulative usage. `cost` is computed by `calculateCost` from `src/providers/pricing.ts`.

## 14. `insertRequestLog(row)`

`src/db/repos/requestLogs.ts:insertRequestLogDeferred` (deferred for buffered) or `insertRequestLog` (immediate for streaming). The row has 29 columns including `request_body`, `response_body`, `request_headers`, `response_headers` (bodies are stored for debugging — see `INSERT_REQUEST_LOG_BODY_RETENTION_DAYS` in scheduler).

## 15. `applyAccountError` (on failure)

If the upstream call threw or returned a 4xx/5xx:
- `checkFallbackError(status, body, baseRespCode, backoffLevel, ...)` returns a `FallbackDecision`
- `applyAccountError` mutates the account state in the DB
- `consoleBus.emit('error', { reqId, status, body })` — body is truncated to 200 chars
- For Kiro: a different error class (refresh token, persona mismatch) is handled inline in `src/proxy/kiro.ts`

The proxy still returns an HTTP response — the error is logged, not thrown.

## 16. Kiro-specific path

`handleKiroProxy` is structurally similar but uses `executeKiro` instead of `upstreamFetch`. The Kiro path:
- Builds the payload via `buildKiroPayload` (CodeWhisperer `conversationState` shape)
- `executeKiro` calls `ensureAccessToken` (refresh if needed)
- Decodes the AWS event-stream binary frames
- Re-emits as OpenAI SSE (`assembler.ts`) or Anthropic SSE (`anthropicSse.ts`)
- The 10-step console emit sequence is the same

## 17. Combo path

`handleComboProxy` iterates `combos.models` in order. For each model:
- Run the same 10-step sequence
- On `model_locked` or specific 4xx: move to next model
- On success: return the response

The combo emits multiple `start`/`account` lines per `reqid` in the Console page. Only the successful one emits `done`.

## Console event types (`src/console/types.ts`)

```ts
type FlowEvent =
  | { kind: 'start', reqId, model, endpoint, ts }
  | { kind: 'account', reqId, account: { id, label }, ts }
  | { kind: 'transport', reqId, kind: 'relay' | 'proxy' | 'direct', label, ts }
  | { kind: 'transport-fail', reqId, message, ts }
  | { kind: 'done', reqId, status, latency_ms, ttft_ms, tokens, cost, rtk_bytes_saved, ts }
  | { kind: 'error', reqId, status, body, ts };
```

Bus subscribers: the dashboard SSE stream + (optionally) `attachStdoutSink` for colored stdout.

## Gotchas

- **`reqId` is per-request, not per-attempt.** A combo with 3 failed models + 1 success still has one `reqId`. The 3 failures are visible as `error` lines under the same `reqId`.
- **`insertRequestLogDeferred` defers the INSERT to the next tick** for buffered responses. Streaming responses use the immediate `insertRequestLog` (so `ttft_ms` is captured).
- **`ttft_ms` is `null` for buffered responses.** It's only meaningful for streaming.
- **`latency_ms` is wall-clock from `c.get('startTime')`** to the moment the response is returned. Includes all upstream time + format conversion + SSE assembly.
- **The Console bus has 200-event ring buffer.** `consoleBus.recent(200)` is what new SSE clients backfill with.
- **`CONSOLE_FLOW=0` env disables the stdout sink only** (not the bus or SSE stream). The dashboard always gets events.
- **Bodies in `request_logs` are full** — they can be megabytes for long conversations. The retention is `REQUEST_LOG_RETENTION_DAYS` (default 30) via the scheduler.

## Cross-refs

- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — visual flow + state machines
- [`state-machines.md`](state-machines.md) — selection / backoff / lock
- [`format-conversion.md`](format-conversion.md) — body transform rules
- [`../../docs/reference/db-tables.md`](../../docs/reference/db-tables.md) — `request_logs` schema
- [`../../docs/guides/debug-a-failed-request.md`](../../docs/guides/debug-a-failed-request.md) — debug ladder
- `src/console/types.ts` — FlowEvent union
```

- [x] **Step 2: Verify**

Run: `wc -l .claude/docs/data-flow.md && head -3 .claude/docs/data-flow.md`
Expected: ~190-210 lines, first line `# Data Flow per Request`.

- [x] **Step 3: Commit**

```bash
cd /home/kocomon/Projects/kelola-router
git add .claude/docs/data-flow.md
git commit -m "kb(proxy): add data-flow.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Create `.claude/docs/kiro-protocol.md`

**Files:**
- Create: `.claude/docs/kiro-protocol.md`
- Reference: `src/providers/kiro/`, `docs/notes/kiro-cli-reverse-engineering.md`

- [x] **Step 1: Write the file** (DONE)

Create `.claude/docs/kiro-protocol.md` with this content (exact paste):

```markdown
# Kiro Protocol

> Wire format + auth + persona details for the Kiro upstream (AWS CodeWhisperer / Amazon Q). The full reverse-engineering notes live in `docs/notes/kiro-cli-reverse-engineering.md` (capture-from-real-traffic). This file is the digest.

## Why this exists

Kiro is the most complex provider in the router. Two client personas (`ide` / `cli`), a binary event-stream wire format, OAuth refresh tokens with 5-min expiry buffer, and a `profileArn` requirement that triggers a management-API round-trip on first use. When something breaks, the agent needs the protocol details, not just a function pointer.

## Two personas

| Persona | Host | UA / SDK fingerprint | When to use |
|---|---|---|---|
| `ide` (default) | `codewhisperer.{region}.amazonaws.com` | aws-sdk-js + `KiroIDE` | Legacy, battle-tested. Use unless explicitly told otherwise. |
| `cli` (experimental) | `runtime.{region}.kiro.dev` | aws-sdk-rust + `AmazonQ-For-CLI` | Looks like the real kiro-cli 2.6.0. Lower ban-risk. |

Switch per-account via `accounts.provider_data.persona` field. Toggle in the dashboard (Upstream → Edit → Persona) or `PATCH /api/admin/accounts/:id {persona}`.

**Never change the default from `ide` without explicit instruction.** Changing the default would break every existing Kiro account.

## Auth — refresh token + cached bearer

`src/providers/kiro/auth.ts:ensureAccessToken(db, account)`:
1. Read `accounts.access_token` + `accounts.token_expires_at`
2. If valid + > 5 min buffer: return existing
3. Else: call `refreshKiroToken(account.provider_data)` → `{ access_token, expires_in }`
4. Persist to DB (UPDATE `accounts SET access_token=?, token_expires_at=?`)
5. Return new bearer

`refreshKiroToken` picks the right URL:
- If `provider_data.clientId` + `clientSecret` present: AWS SSO OIDC endpoint `oidc.{region}.amazonaws.com/token`
- Else: Kiro desktop social `prod.us-east-1.auth.desktop.kiro.dev/refreshToken`

## Request — `buildKiroPayload` (OpenAI → CodeWhisperer)

`src/providers/kiro/transform.ts`. Branches on `persona`:

### Body shape — IDE persona

```jsonc
{
  "conversationState": {
    "currentMessage": { "userInputMessage": { ... } },
    "history": [ ... 0..N prior turns ... ]
  },
  "profileArn": "<resolved>"
}
```

System / tool messages are folded into the user turn (CodeWhisperer has no `system` role). Tools are transformed to `toolSpecification`. Images stay as content blocks.

### Body shape — CLI persona

Same as IDE structurally, but:
- `chatTriggerType: 'MANUAL'`
- Per-message `envState`
- `agentContinuationId` + `agentTaskType: 'vibe'`
- NO `inferenceConfig` (CLI doesn't use it)
- Model id is converted to dotted form: `claude-sonnet-4-6` → `claude-sonnet-4.6`

### Suffix handling

Synthetic model variants keep the suffix in `upstream_model`:
- `claude-sonnet-4-6-thinking` → upstream `claude-sonnet-4-6` + injected `<thinking_mode>enabled</thinking_mode>`
- `claude-sonnet-4-6-agentic` → injected chunked-write system prompt
- `claude-sonnet-4-6-thinking-agentic` → both

The executor strips the suffix before sending.

## Response — AWS event-stream binary

`src/providers/kiro/eventstream.ts:decodeFrames(rawStream)`. AWS event-stream is a binary framing format with:
- 12-byte prelude (total length + headers length)
- Headers (name-value pairs)
- Payload (JSON or binary)
- 4-byte CRC (optional, sometimes skipped)

Each frame is decoded into:
```ts
{ headers: { eventType, contentType, ... }, payload: Uint8Array }
```

### Re-emission

For each event, the assembler (`src/providers/kiro/assembler.ts`) re-emits as OpenAI SSE chunks:

| Upstream event | OpenAI chunk |
|---|---|
| `assistantResponseEvent` | `chat.completion.chunk` with delta.content |
| `toolUseEvent` | `chat.completion.chunk` with delta.tool_calls |
| `messageStopEvent` | `chat.completion.chunk` with finish_reason |
| `metadataEvent` (usage) | (no chunk, just captured for cost) |

For Anthropic clients, `anthropicSse.ts` re-emits as native Messages SSE:
- `message_start` → `content_block_start` (text/thinking/tool_use) → `content_block_delta` (×N) → `content_block_stop` → `message_delta` (stop_reason) → `message_stop`

## `profileArn` discovery (CLI persona only)

The CLI runtime host REJECTS requests without `profileArn`. On first CLI-persona use:

1. `ensureProfileArn(db, account)` checks `accounts.provider_data.profileArn`
2. If missing: call `ListAvailableProfiles` on `management.{region}.kiro.dev` (wire format captured from kiro-cli)
3. Take the first profile
4. Persist to `provider_data.profileArn`
5. Return it

The management host also uses `aws-sdk-rust` + `AmazonQ-For-CLI` fingerprint. The `discoverProfileArn` function in `src/providers/kiro/profile.ts` does the round-trip.

## Error handling

- **401 on `ensureAccessToken`**: token refresh failed. The account is marked `status='error'`. The user must re-add the account.
- **Upstream 4xx/5xx**: same `checkFallbackError` pipeline as MiniMax. `base_resp` doesn't apply (Kiro uses AWS-shaped errors, not MiniMax-shaped).
- **Persona mismatch**: `codewhisperer` host for `cli` persona → 403. Reverse → 403 too. Ensure the persona matches the host.

## Code map

```
src/providers/kiro/
├── constants.ts     endpoints, persona type, UA builders, toCliModelId()
├── transform.ts     buildKiroPayload() — branches IDE vs CLI
├── index.ts         executeKiro() — picks endpoint + headers per persona
├── profile.ts       discoverProfileArn() + ensureProfileArn()
├── auth.ts          ensureAccessToken() — token refresh + DB cache
├── tokenRefresh.ts  KiroProviderData type (persona, profileArn, clientId, ...)
├── eventstream.ts   binary frame decoder
├── assembler.ts     → OpenAI SSE chunks
├── anthropicSse.ts  → native Anthropic Messages SSE
├── deviceCode.ts    AWS Builder ID / IDC device code flow
├── accountImport.ts buildKiroAccountFields (token / idc / social)
├── deviceCode.test.ts
├── constants.test.ts
├── profile.test.ts
└── transform.test.ts
```

## Gotchas

- **Default persona is `ide`.** If the user switches to `cli`, they accept the risk of a less-tested wire format.
- **The `profileArn` is per-account.** Each account has its own discovery round-trip. Don't share.
- **AWS event-stream frames are 1 KB–4 KB.** Don't read the whole response into memory; pipe it.
- **The `cli` persona's `chatTriggerType: 'MANUAL'` is required** by the runtime host. Without it, the request is rejected.
- **The dot-vs-dash model id conversion is lossy** for display. The Kiro runtime host requires dotted form; the IDE host accepts either. The conversion happens in `constants.ts:toCliModelId()`.
- **Kiro responses are 2-3× slower** than MiniMax because of the binary framing + re-emission. TTFT is higher.

## Cross-refs

- [`docs/notes/kiro-cli-reverse-engineering.md`](../../docs/notes/kiro-cli-reverse-engineering.md) — full capture-from-traffic notes (single source of truth for wire format)
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — provider branching in `handleProxy`
- [`../../docs/guides/add-a-provider.md`](../../docs/guides/add-a-provider.md) — when extending with new personas
- [`../skills/add-provider/SKILL.md`](../skills/add-provider/SKILL.md) — provider integration skill
- `src/providers/kiro/constants.ts` — endpoint + UA constants
```

- [x] **Step 2: Verify**

Run: `wc -l .claude/docs/kiro-protocol.md && head -3 .claude/docs/kiro-protocol.md`
Expected: ~180-200 lines, first line `# Kiro Protocol`.

- [x] **Step 3: Commit**

```bash
cd /home/kocomon/Projects/kelola-router
git add .claude/docs/kiro-protocol.md
git commit -m "kb(kiro): add kiro-protocol.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Create `.claude/docs/format-conversion.md`

**Files:**
- Create: `.claude/docs/format-conversion.md`
- Reference: `src/providers/format/transform.ts`, `src/providers/format/`

- [x] **Step 1: Write the file** (DONE)

Create `.claude/docs/format-conversion.md` with this content (exact paste):

```markdown
# Format Conversion

> OpenAI ↔ Anthropic body and response transform rules. For terse reference see `docs/reference/`. Source: `src/providers/format/transform.ts` (309 LOC).

## Why this exists

The router accepts OpenAI and Anthropic client formats and proxies to MiniMax (which speaks OpenAI-shaped JSON) or Kiro (which speaks AWS event-stream). Format conversion lives in `src/providers/format/transform.ts`. The conversion is loss-y in places — agents need to know what's preserved and what's approximated.

## Two settings control conversion

| Setting | Default | Effect |
|---|---|---|
| `settings.minimax.upstreamFormat` | `auto` (detect from client) | `openai` forces OpenAI-shape upstream regardless of client. `anthropic` forces Anthropic-shape. |
| `ROUTER_UPSTREAM_FORMAT` env | (none) | Overrides the setting. Same values. |

When the client is OpenAI and upstream is Anthropic (`upstreamFormat: 'anthropic'`): outbound body converted via `bodyOpenAIToAnthropic`, response via `responseAnthropicToOpenAI`.

When client is Anthropic and upstream is OpenAI: `bodyAnthropicToOpenAI` + `responseOpenAIToAnthropic`.

## OpenAI → Anthropic body

`bodyOpenAIToAnthropic(body)`:
- `messages: [{role: 'system', content}, {role: 'user', content}, ...]`
  → `{ system: <extracted>, messages: [{role, content: <user/assistant only>}] }`
- System messages become the top-level `system` field. Multiple system messages are concatenated with `\n\n`.
- User/assistant messages pass through, but tool messages are special — see below.
- `tools: [{type: 'function', function: {name, description, parameters}}]`
  → `tools: [{name, description, input_schema: <parameters>}]`
- `tool_choice: 'auto' | 'any' | 'none' | {type: 'function', function: {name}}`
  → `tool_choice: {type: 'auto' | 'any' | 'tool', name?: <name>}`
  - `none` is approximated as `{type: 'auto'}` (Anthropic has no `none` — it just means "don't force tool use")
- `stream: true` → `stream: true` (plus `stream_options: {include_usage: true}` injected for OpenAI streaming — see below)
- `temperature`, `max_tokens`, `top_p`, `stop` — direct map
- `response_format: {type: 'json_object'}` → not directly supported by Anthropic; warning emitted, best-effort
- `n` (multiple completions) → not supported by Anthropic; warning emitted

### Tool messages — special case

OpenAI tool messages are `{role: 'tool', tool_call_id, content}`. Anthropic has `tool_result` blocks inside the `user` message. Conversion:
```ts
{ role: 'tool', tool_call_id: 'X', content: '...' }
→
{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'X', content: '...' }] }
```

The corresponding assistant message has `tool_use` blocks (not tool_calls) — see response conversion below.

## Anthropic → OpenAI body

`bodyAnthropicToOpenAI(body)`:
- `{ system, messages: [...] }` → `{ messages: [{role: 'system', content: system}, ...messages] }`
- `tools: [{name, description, input_schema}]` → `tools: [{type: 'function', function: {name, description, parameters: input_schema}}]`
- `tool_choice: {type, name?}` → `tool_choice: 'auto' | 'none' | {type: 'function', function: {name: name}}`
- `max_tokens` → `max_tokens` (direct)
- `stream: true` → `stream: true` (no `stream_options` injection — Anthropic is the upstream here)
- `metadata.user_id` → discarded (no OpenAI equivalent)

## Response conversion

`responseAnthropicToOpenAI(body)`:
- Anthropic `{id, type: 'message', role: 'assistant', content: [{type: 'text', text}, {type: 'tool_use', id, name, input}], stop_reason, usage: {input_tokens, output_tokens}}`
  → OpenAI `{id, object: 'chat.completion', choices: [{index: 0, message: {role: 'assistant', content: <text or null>, tool_calls: [...]}, finish_reason}], usage: {prompt_tokens, completion_tokens, total_tokens}}`
- `stop_reason` mapping:
  - `end_turn` → `stop`
  - `max_tokens` → `length`
  - `tool_use` → `tool_calls`
  - `stop_sequence` → `stop`
- `usage` mapping:
  - `input_tokens` → `prompt_tokens`
  - `output_tokens` → `completion_tokens`
  - (cache read/creation tokens are added by the router based on `request_logs.cache_*_tokens`, not from the upstream response)

`responseOpenAIToAnthropic(body)` is the inverse.

## Streaming chunks

The streaming conversion is more involved because each chunk is partial. See `src/streaming/pipeWithUsage.ts` for the SSE pipe. Key invariants:

- `chat.completion.chunk` with delta.content → `content_block_start` + `content_block_delta` (text)
- `chat.completion.chunk` with delta.tool_calls → `content_block_start` (tool_use) + `content_block_delta` (input_json_delta)
- Final `chat.completion.chunk` with finish_reason → `message_delta` (stop_reason) + `message_stop`
- The router injects `stream_options.include_usage=true` so OpenAI streaming responses include the usage chunk — this is the project's auto-inject behavior (`src/proxy/minimax.ts`). Without it, `usage` is null and cost tracking breaks.

## Cache control

Anthropic has `cache_control: {type: 'ephemeral'}` on content blocks. OpenAI has no equivalent. The router:
- Passes `cache_control` through to Anthropic (upstream)
- Strips `cache_control` from the body when converting Anthropic → OpenAI (it would be ignored anyway)
- The router's own cache injection (`src/cache-injection.ts`) adds `cache_control` to the system + last user message if `settings.caching.autoBreakpoints` is on

## Code map

```
src/providers/format/
├── transform.ts        309 LOC — all 4 conversion functions
├── negotiate.ts        getUpstreamFormat(db, requestedFormat) — picks openai vs anthropic
├── headers.test.ts
└── transform.test.ts   50+ tests covering edge cases
```

## Gotchas

- **The `none` tool_choice doesn't exist in Anthropic.** Conversion to `{type: 'auto'}` is a best-effort approximation. Clients that depend on `none` to suppress all tool use will still see Anthropic tool-using responses.
- **`response_format: {type: 'json_object'}` is not supported by Anthropic.** The router warns and passes the body through unchanged. Anthropic may or may not produce valid JSON.
- **`stop_sequences` is an array in Anthropic, scalar in OpenAI.** `bodyAnthropicToOpenAI` joins with `||` separator (which OpenAI splits back). Loss-y for clients that use `||` in their stops.
- **`metadata.user_id` is dropped** on Anthropic → OpenAI. No way to preserve it.
- **The router injects `stream_options.include_usage=true` for OpenAI streaming** — even if the client didn't set it. This is intentional. See CLAUDE.md "OpenAI ↔ Anthropic format conversion".
- **Tool messages always require a preceding assistant tool_calls message.** If the client sends a tool message with no matching `tool_use_id` upstream, the upstream may 400.
- **System messages at the END of the messages array** (some clients do this) are moved to the top by the OpenAI → Anthropic converter. The reverse is also true.

## Cross-refs

- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — pipeline overview
- [`../../docs/guides/debug-a-failed-request.md`](../../docs/guides/debug-a-failed-request.md) — format-mismatch debug
- `src/providers/format/transform.ts` — source of truth
- `src/providers/format/transform.test.ts` — edge-case coverage
```

- [x] **Step 2: Verify**

Run: `wc -l .claude/docs/format-conversion.md && head -3 .claude/docs/format-conversion.md`
Expected: ~165-185 lines, first line `# Format Conversion`.

- [x] **Step 3: Commit**

```bash
cd /home/kocomon/Projects/kelola-router
git add .claude/docs/format-conversion.md
git commit -m "kb(format): add format-conversion.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Create `.claude/docs/conventions.md`

**Files:**
- Create: `.claude/docs/conventions.md`
- Reference: `AGENTS.md`, `biome.json`, `tsconfig.json`

- [x] **Step 1: Write the file** (DONE)

Create `.claude/docs/conventions.md` with this content (exact paste):

```markdown
# Conventions

> Terse code-level rules. For workflow + TDD see `../../AGENTS.md`. For commit/PR process see `../../CONTRIBUTING.md`.

## Why this exists

When an agent writes a single line of code, the line should pass `biome check` + `tsc --noEmit` + the existing test suite on the first try. This file distills the rules that catch the most issues in code review. Read once, apply always.

## TypeScript (`tsconfig.json`)

- `strict: true` is on. No implicit `any`. No implicit `this`. Strict null checks. No fall-through cases.
- **`no `any`**. Wrap forced-`any` (third-party type gaps) in a typed shim with a comment explaining why.
- `import type` for type-only imports. Biome warns on the bare `import` form.
- `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`. ESM with `.js` extensions in import paths.
- `?? null` to coerce `better-sqlite3` `undefined` to `null` at repo boundaries.

## Biome (`biome.json`)

- Single quotes, 2-space indent, 100-col soft wrap, `es5` trailing commas, `lf` line endings, semicolons on.
- `noExplicitAny: warn` — combine with `tsc` to enforce no-`any`.
- `noDebugger: error`.
- Client dir (`client/`) is excluded from biome's `files.includes`. The client has its own `package.json` + lint setup (none currently — add when needed).
- Run `npm run lint:fix` before commit. Re-read the diff before `git add` — biome sometimes does things you didn't ask for.

## Naming

| Item | Convention | Example |
|---|---|---|
| Files (server) | `kebab-case.ts` (one per concept) | `errorRules.ts`, `pipeWithUsage.ts` |
| Files (client) | `PascalCase.tsx` (one per component) | `AccountsTable.tsx`, `KiroAuthForm.tsx` |
| React components | `PascalCase`, default export matching filename | `export function Accounts() {}` |
| Functions | `camelCase`, verb-first | `selectAccount`, `applyAccountError` |
| Types / interfaces | `PascalCase`, no `I` prefix | `Account`, `SelectionResult` |
| Constants | `camelCase` for runtime, `SCREAMING_SNAKE_CASE` for compile-time | `BACKOFF_MAX_LEVEL` |
| DB columns | `snake_case` | `rate_limited_until` |
| TypeScript enum values | `kebab-case` strings | `'lowest-backoff'`, `'round-robin'`, `'sticky'` |
| Env vars | `SCREAMING_SNAKE_CASE` | `ROUTER_DB_PATH`, `MINIMAX_REGION` |
| Settings keys | `kebab-case` with dots for nesting | `caveman`, `selection.minimax`, `transport.proxyFailureMode` |
| Provider names | `lowercase` (short identifier) | `minimax`, `kiro` |
| Model names | `PascalCase-Kebab` | `MiniMax-M3`, `claude-sonnet-4-6` |

## Imports

- Order (biome auto-sorts, but write them in this order): external → internal absolute (`src/`) → relative.
- Use `from '../foo.js'` not `from '../foo'` — NodeNext + ESM require the extension.
- Use `import type` for types-only.
- Group by directory, not by file. Don't import 5 functions from the same file with 5 separate `import` lines.

## Functions

- **Early returns** over nested `if/else`. Max 2 levels of indentation in the function body.
- **`const` over `let`**. `let` only for accumulators or state that genuinely changes.
- **Pure functions preferred.** Side effects (DB writes, fetch) live at the boundary (proxy handlers, repo functions).
- **No arrow functions for component declarations** — use `function ComponentName() {}` so it's hoisted + has a name in dev tools.
- **No `void`-prefixed function calls** unless intentionally fire-and-forget. `void foo()` is a code smell; usually you want to `await` or move to an event handler.

## Error handling

- Use `throw new ApiError('code', 'message', status)` for expected errors in admin API routes. Catch with `handleApiError(e)`.
- Use `consoleBus.emit('error', ...)` for proxy errors that the user should see in the Console page.
- `try/catch` around every admin route handler. Required by convention (see `src/api/admin/middleware.ts:handleApiError`).
- **Never** swallow an error silently. If you `catch {}`, write a comment explaining why.

## Logging

- Use `import { log } from '../util/log.js'`. Pino-based, structured JSON in prod.
- `log.info({ key: 'value' }, 'message')` — structured fields first, message second.
- Never `console.log` in `src/`. (Biome's `noConsole: off` is set, but the convention is `log.*`.)
- The one exception: `src/db/migrations/index.ts` uses `console.log` for migration progress because the logger isn't initialized yet.

## Testing

See `../../AGENTS.md` "Test patterns" for the full set. Highlights:

- `process.env.ROUTER_DB_PATH = join(mkdtempSync(...), 't.db')` in `beforeEach`.
- `resetDb()` from `src/server.ts` to reset the Hono app handle.
- Mock `globalThis.fetch` with `vi.spyOn(...)` and `mockImplementation` (not `mockResolvedValueOnce`) for multi-shot.
- `clearCacheForDb(db)` from `src/db/repos/settings.ts` when changing settings mid-test.
- For client tests: `cd client && npm test`. Mock `apiFetch`, not global `fetch`.
- Don't write a test that only verifies the mock — the test should verify the behavior given the mock's response.

## Git

- Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, `perf:`, `style:`. Optional scope: `feat(accounts): …`.
- Subject ≤ 72 chars, body explains *why*.
- One `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer per commit (this is the global project default).
- Branch names: `feat/<scope>-<short>`, `fix/<scope>-<short>`, etc.
- Never push without asking (root CLAUDE.md).

## Gotchas

- **`new Date().toISOString()` is the only acceptable time format** in the codebase. Unix timestamps (s/ms) are not used in app code. The DB stores ISO strings.
- **Don't use `process.env.ROUTER_DB_PATH` directly** — read it via `getDbPath()` from `src/util/env.ts`.
- **Don't call `getDb()` outside `src/server.ts`.** Other modules receive the `db` from the Hono context (`c.get('db')`).
- **Don't import from `src/server.ts` outside `tests/`.** It's the entry point, not a library.
- **Settings are JSON in TEXT.** `getSetting` parses; `setSetting` stringifies. Don't store a raw string.
- **Repo functions return `T | null`**, not `T | undefined`. The repo coerces with `?? null`. Tests rely on this.

## Cross-refs

- [`../../AGENTS.md`](../../AGENTS.md) — workflow + TDD
- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) — git + PR
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — pipeline
- `biome.json`, `tsconfig.json` — tool configs
- [`codebase-map.md`](codebase-map.md) — what to import from where
```

- [x] **Step 2: Verify**

Run: `wc -l .claude/docs/conventions.md && head -3 .claude/docs/conventions.md`
Expected: ~175-195 lines, first line `# Conventions`.

- [x] **Step 3: Commit**

```bash
cd /home/kocomon/Projects/kelola-router
git add .claude/docs/conventions.md
git commit -m "kb(conventions): add conventions.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Update `MEMORY.md` — add Project knowledge base section with 6 links

**Files:**
- Modify: `MEMORY.md` (replace the "Project knowledge base (when written)" placeholder)

- [x] **Step 1: Find the existing placeholder**

Run: `grep -n "knowledge base" MEMORY.md`

- [x] **Step 2: Replace the placeholder block**

Find the existing block starting with `## Project knowledge base (when written)` and replace it with:

```markdown
## Project knowledge base

Deep technical notes indexed for search. Read with `mcp__plugin_context-mode_context-mode__ctx_search` when an agent needs depth beyond the lookup tables or playbooks.

- `.claude/docs/codebase-map.md` — module dependency graph + entry points
- `.claude/docs/state-machines.md` — account selection / backoff / lock invariants
- `.claude/docs/data-flow.md` — per-request pipeline annotated end-to-end
- `.claude/docs/kiro-protocol.md` — AWS event-stream + IDE/CLI persona wire format
- `.claude/docs/format-conversion.md` — OpenAI ↔ Anthropic body transform rules
- `.claude/docs/conventions.md` — terse code-level rules
```

- [x] **Step 3: Verify**

Run: `grep -oE "\.claude/docs/[a-z-]+\.md" MEMORY.md | sort -u`
Expected: 6 unique paths (codebase-map, state-machines, data-flow, kiro-protocol, format-conversion, conventions).

- [x] **Step 4: Commit**

```bash
cd /home/kocomon/Projects/kelola-router
git add MEMORY.md
git commit -m "docs: link 6 KB files from MEMORY.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Verify Phase 5 — all 6 KB files exist + linked from MEMORY.md

**Files:**
- Read-only verification (no file changes)

- [x] **Step 1: Confirm all 6 KB files exist with expected sizes**

Run:
```bash
cd /home/kocomon/Projects/kelola-router
for f in codebase-map state-machines data-flow kiro-protocol format-conversion conventions; do
  p=".claude/docs/$f.md"
  if [ -f "$p" ]; then
    printf "%-40s %s lines\n" "$p" "$(wc -l < "$p")"
  else
    echo "MISSING: $p"
  fi
done
```

Expected (approximate):
```
.claude/docs/codebase-map.md         160 lines
.claude/docs/state-machines.md       200 lines
.claude/docs/data-flow.md            200 lines
.claude/docs/kiro-protocol.md        190 lines
.claude/docs/format-conversion.md    175 lines
.claude/docs/conventions.md          185 lines
```

- [x] **Step 2: Confirm MEMORY.md links to all 6 KB files**

Run:
```bash
cd /home/kocomon/Projects/kelola-router
grep -oE "\.claude/docs/[a-z-]+\.md" MEMORY.md | sort -u
```

Expected: 6 unique paths.

- [x] **Step 3: Confirm 7 new commits in git log**

Run:
```bash
cd /home/kocomon/Projects/kelola-router
git log --oneline -10
```

Expected: 7 new commits most recent:
- `docs: link 6 KB files from MEMORY.md`
- `kb(conventions): add conventions.md`
- `kb(format): add format-conversion.md`
- `kb(kiro): add kiro-protocol.md`
- `kb(proxy): add data-flow.md`
- `kb(accounts): add state-machines.md`
- `kb(codebase): add codebase-map.md`

Plus prior Phase 1-4 commits.

- [x] **Step 4: `npm run typecheck` + `npm test` green (Phase 5 is docs only)**

Run:
```bash
cd /home/kocomon/Projects/kelola-router
npm run typecheck 2>&1 | tail -5
echo "==="
npm test 2>&1 | tail -5
```

Expected: typecheck clean, tests pass.

- [x] **Step 5: Final report**

Tell the user:

```
Phase 5 done. Seven commits added:
  - .claude/docs/codebase-map.md         (module dep graph + entry points)
  - .claude/docs/state-machines.md       (selection / backoff / lock invariants)
  - .claude/docs/data-flow.md            (request pipeline annotated)
  - .claude/docs/kiro-protocol.md        (event-stream + IDE/CLI personas)
  - .claude/docs/format-conversion.md    (OpenAI ↔ Anthropic transform rules)
  - .claude/docs/conventions.md          (terse code-level rules)
  - MEMORY.md updated with links to all 6

Verification:
  - All 6 files exist, sizes in range
  - MEMORY.md has 6 unique links to .claude/docs/*.md
  - npm run typecheck green
  - npm test green (no code changed)

Note: to use these via ctx_search, the user can run:
  mcp__plugin_context-mode_context-mode__ctx_index(path: ".claude/docs", source: "kelola-router-kb")

Next phases (not in this plan):
  - Phase 6 (next plan): docs/adr/* (4-5 ADRs backfilled from git history)
```

---

## Self-Review

### Spec coverage

| Spec requirement | Task |
|---|---|
| `.claude/docs/codebase-map.md` | Task 1 |
| `.claude/docs/state-machines.md` | Task 2 |
| `.claude/docs/data-flow.md` | Task 3 |
| `.claude/docs/kiro-protocol.md` | Task 4 |
| `.claude/docs/format-conversion.md` | Task 5 |
| `.claude/docs/conventions.md` | Task 6 |
| `MEMORY.md` updated | Task 7 |
| Verification gate | Task 8 |

All covered.

### Placeholder scan

Searched for `TBD`, `TODO`, `implement later`, `fill in details`. None present.

### Type / name consistency

- File names match `MEMORY.md` links.
- File paths + line refs match the actual source (`src/proxy/minimax.ts`, `src/accounts/selection.ts`, `src/providers/kiro/`, etc.).
- Code identifiers (`selectAccount`, `applyAccountError`, `isModelLockActive`, etc.) match the source.
- Setting keys (`settings.minimax.upstreamFormat`, `settings.caching.autoBreakpoints`, etc.) match.

Plan ready for execution.
