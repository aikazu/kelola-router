# Notion Desktop AI Chat — Reverse Engineer & Router Integration

**Date:** 2026-06-18
**Status:** Draft (pending user review)
**Owner:** aikazu
**Related:** mirrors `src/proxy/kiro.ts` + `src/proxy/codebuddy.ts` patterns

---

## Goal

Reverse engineer the AI chat endpoints of the Notion desktop client, document the protocol, and integrate Notion as a new upstream provider in `kelola-router` — with OTP-based account auth, multi-account failover, and conversation continuity (same `conversation_id` sticks to the same account, with graceful migration on failure).

**Non-goals:** WebSocket streaming (SSE first), multi-workspace routing, image/file upload, conversation history sync, publishing an official Notion SDK.

---

## Why

The router currently fronts MiniMax, Kiro, CodeBuddy, and Pioneer. Notion AI is a popular subscription users already pay for; routing it through the router gives them a single OpenAI-compatible surface, key isolation, usage logs, and failover across multiple Notion accounts.

---

## Architecture

```
src/proxy/notion.ts          # selectAccount + upstreamFetch + applyAccountError + body format conversion
src/auth/notion.ts           # requestOtp(email) + exchangeOtp(email, code) → { token, user_id, workspace_id }
src/selection/notion.ts      # sticky / round-robin state machine (mirrors selection/kiro.ts)
src/models/notion.ts         # model catalogue seeded on account-add (mirrors models/kiro.ts)
src/db/migrations/00X-notion.ts  # CREATE TABLE conversation_routing
scripts/notion-add-account.ts    # CLI: email → OTP prompt → token stored
docs/notion/                 # captured HAR, endpoint table, request/response examples, ToS note
tests/proxy/notion.test.ts
tests/auth/notion.test.ts
tests/selection/notion.test.ts
tests/fixtures/notion/*.har  # 1+ captured sessions
```

Mirror `src/proxy/kiro.ts` and `src/proxy/codebuddy.ts` 1:1. Only deviations: (a) OTP login instead of static refresh token, (b) `conversation_routing` table for chat continuity.

---

## Components

### 1. Auth — `src/auth/notion.ts`

```ts
export async function requestOtp(email: string): Promise<void>
export async function exchangeOtp(email: string, code: string): Promise<{
  token: string
  userId: string
  workspaceId: string
}>
export async function refreshNotionToken(accountId: string): Promise<void>  // no-op placeholder; OTP re-auth when expired
```

- Endpoints discovered via mitmproxy capture (placeholders until RE done):
  - `POST https://api.notion.com/v1/login/sendOtp` body `{ email }`
  - `POST https://api.notion.com/v1/login/verify` body `{ email, code }` → `{ token, user_id, workspace_id }`
- Errors: invalid code → throw `NotionAuthError('invalid_code')`; expired → `'otp_expired'`.

### 2. CLI — `scripts/notion-add-account.ts`

```
$ npm run notion-add-account -- --label personal --email user@x.com
> Sending OTP to user@x.com...
> Enter 6-digit code: 482910
> ✓ Account 'personal' added (workspace_id=ws_abc123)
```

- `readline` prompts for code after OTP request
- On success: insert into `accounts` w/ `provider='notion'`, `access_token=token`, `email`, `workspace_id`
- On failure: no partial row (transactional)
- Trigger model seed: `seedModelsFor('notion')` (mirrors `seed-models` pattern)

### 3. Proxy — `src/proxy/notion.ts`

Implements the standard provider interface (same as Kiro):
- `selectAccount({ mode, step })` — sticky or round-robin
- `checkModelLock(accountId, model)` → returns locked-state
- `upstreamFetch(account, body, signal)` — calls Notion AI endpoint w/ Bearer + client-version headers
- `applyAccountError(account, response)` — backoff, model lock, disable
- `bodyOpenAIToNotion(req)` / `responseNotionToOpenAI(sse)` — format conversion (TBD from capture)
- `pipeWithUsage` for SSE (reuse from `streaming/pipeWithUsage.ts`)

### 4. Selection state — `src/selection/notion.ts`

Mirrors `selection/kiro.ts`:
- `mode`: `sticky` (default) | `round-robin`
- `step`: round-robin offset (default 1)
- Skip rules: account in `backoff_until > now`, `state='locked'` or `'disabled'`, model explicitly locked
- After successful response: clear backoff, bump `last_used_at`, decrement `error_count`

### 5. Conversation continuity — new table

```sql
CREATE TABLE conversation_routing (
  conversation_id TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  model           TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  last_used_at    INTEGER NOT NULL
);
CREATE INDEX idx_conv_routing_last_used ON conversation_routing(last_used_at);
```

**Lookup flow** (in `selectAccount` for `notion`):
1. Extract `conversation_id` from request body (OpenAI `messages` metadata or custom `x-notion-conversation` header — TBD from capture)
2. If present in `conversation_routing` AND referenced account is healthy (not backoff/locked/disabled) → use that account (override selection mode)
3. If present but referenced account unhealthy → pick next healthy account, **insert/upsert routing row with new account_id** (graceful migration), set response header `X-Notion-Conversation-Migrated: true`
4. If absent → fresh conversation, run normal `selectAccount`, insert routing row after upstream returns the conversation_id

**Cleanup:** lazy check on lookup — if `last_used_at < now - 7d` → delete row, treat as absent.

### 6. Models — `src/models/notion.ts`

Catalogue seeded on `account-add`. Discovered via capture (placeholders):
- `notion-claude-sonnet-4` (Anthropic Claude Sonnet 4)
- `notion-claude-opus-4`
- `notion-gpt-4o`
- `notion-gpt-4-turbo`
- `notion-llama-3.1-70b`

Stored in `models` table w/ `provider='notion'`, thinking params, max-tokens defaults.

---

## Error Handling

| Notion status | Class | Action | Failover? |
|---|---|---|---|
| 200 | success | sticky, clear backoff | — |
| 401 | fatal | disable account, surface to client | NO |
| 403 | fatal | disable account, surface to client | NO |
| 404 | fatal (unknown conversation) | return 404, suggest new conversation | NO |
| 429 | retryable | backoff 60s, model lock if `Retry-After` per-model | YES |
| 500/502/503 | retryable | exp backoff 1s→2s→4s, max 3 attempts | YES |
| network/timeout | retryable | failover immediately | YES |
| OTP wrong/expired | fatal | no partial DB row, CLI exits non-zero | — |

Config (mirroring Kiro settings):
- `settings.notion.selection.mode` default `sticky`
- `settings.notion.selection.step` default `1`
- `settings.notion.maxFailoverAttempts` default `3`
- `settings.notion.conversationTtlDays` default `7`

---

## Data Flow — Single Request

```
Client (OpenAI format)
  → POST /v1/chat/completions w/ Bearer client_key
  → parseBody + model alias resolution
  → selectAccount('notion')
      ├─ extract conversation_id from body/header
      ├─ if in conversation_routing + healthy → return that account
      ├─ if in routing + unhealthy → failover + migrate row + X-Migrated header
      └─ else → run sticky/round-robin selection
  → checkModelLock → 429 if locked
  → augment system prompt + cache breakpoints
  → bodyOpenAIToNotion(req)
  → upstreamFetch (Bearer + Notion-Client-Version headers)
      ├─ SSE pipe via pipeWithUsage
      └─ parse chunks → assemble conversation_id from first response event
  → responseNotionToOpenAI → client
  → upsert conversation_routing(conversation_id, account_id, model)
  → insertRequestLog(cost, tokens, latency, account_id, requested_model)
  → applyAccountError (clear on success, backoff/lock on failure)
```

---

## Testing (TDD red-green per CLAUDE.md)

**`tests/auth/notion.test.ts`**
- `requestOtp` posts email, no partial DB row on failure
- `exchangeOtp` invalid code → throws `NotionAuthError('invalid_code')`, no row inserted
- `exchangeOtp` success → row inserted w/ token, email, workspace_id, `provider='notion'`

**`tests/proxy/notion.test.ts`**
- Format conversion roundtrip: OpenAI request → Notion body → OpenAI response preserves message content
- SSE chunk assembly produces valid OpenAI streaming chunks
- 401 → account disabled, NO failover attempted
- 429 → backoff set, failover to next account attempted
- 5xx → exp backoff, max 3 attempts, then return error to client
- `conversation_id` present + account healthy → uses that account, routing row unchanged
- `conversation_id` present + account unhealthy → migrates to new account, `X-Notion-Conversation-Migrated: true` header set
- `conversation_id` absent → fresh selection, routing row upserted after upstream response

**`tests/selection/notion.test.ts`**
- Sticky mode: 5 sequential requests → same account
- Round-robin w/ step=1, 3 accounts → each used 2x across 6 requests
- Skip rules: account in backoff / locked / disabled / model-locked all excluded
- After successful response → backoff cleared, `last_used_at` bumped

**`tests/fixtures/notion/`**
- 1+ captured HAR files for parser regression (single chat completion + 1 streaming)

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Notion ToS prohibits third-party AI chat clients | Document in `docs/notion/README.md`, mark feature `experimental`, require user acceptance on CLI add |
| Endpoint drift (Notion can change internal API) | Pin `Notion-Client-Version` header from capture; alert on error spike; model catalogue re-seed script |
| OTP UX friction (every session needs new code) | `notion-add-account` is one-time; token reused until 401, then re-OTP flow exposed via dashboard |
| Subscription gating server-side (token valid but no AI access) | Detect via 402 Payment Required in capture; emit clear error to client |

---

## Open Questions (capture-driven, will resolve during RE)

1. Exact OTP endpoint URL — desktop may use internal subdomain, not `api.notion.com`
2. SSE chunk format — Anthropic-style events vs proprietary JSON lines
3. Which model IDs are available + their thinking params
4. Whether conversation_id is in body metadata or custom header
5. Whether Notion AI requires active subscription (gating signal beyond token)

---

## Out of Scope (YAGNI)

- WebSocket streaming (HTTP SSE only for v1)
- Multi-workspace routing per account (1 workspace = 1 account)
- Image/file upload endpoints (chat-only)
- Conversation history sync (each chat request is stateless from router's view)
- Publishing an official Notion SDK

---

## Implementation Order

1. RE phase: mitmproxy + Notion desktop → capture HAR, document endpoints, fill open questions
2. DB migration: `conversation_routing` table
3. Auth module + CLI script + tests (TDD)
4. Proxy module + format conversion + tests (TDD, driven by captured fixtures)
5. Selection module + failover tests (TDD)
6. Model catalogue seed + integration test
7. `sync-docs` skill to update README + CHANGELOG

Each step: red test → green impl → commit (conventional commits, ~300 LOC max per commit).