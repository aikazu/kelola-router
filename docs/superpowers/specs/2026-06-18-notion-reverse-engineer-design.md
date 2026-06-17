# Notion Desktop AI Chat — Reverse Engineer & Router Integration

**Date:** 2026-06-18
**Status:** REVISED — based on mitmproxy capture (commit cabf7af). Original spec assumed OTP + SSE; capture proved 3-step temp-password login + cookie auth + JSON-Patch CRDT protocol + NDJSON streaming. See `docs/notion/capture-notes.md` for raw findings.
**Owner:** aikazu
**Related:** mirrors `src/proxy/kiro.ts` + `src/proxy/codebuddy.ts` patterns

---

## Goal

Reverse engineer the AI chat endpoints of the Notion desktop client, document the protocol, and integrate Notion as a new upstream provider in `kelola-router` — with 3-step temp-password login, cookie-based session auth, JSON-Patch CRDT protocol translation to/from OpenAI chat-completion format, and conversation continuity (one Notion conversation document per client conversation_id).

**Non-goals:** WebSocket streaming, multi-workspace routing, image/file upload, function/tool calling, publishing an official Notion SDK, supporting legacy password-only accounts (we use temp-password flow).

---

## Why

The router currently fronts MiniMax, Kiro, CodeBuddy, and Pioneer. Notion AI is a popular subscription users already pay for; routing it through the router gives them a single OpenAI-compatible surface, key isolation, usage logs, and (future) failover across multiple Notion accounts.

---

## Architecture

```
src/auth/notion.ts               # getLoginOptions + sendTempPassword + loginWithEmail + cookie extraction
src/proxy/notion.ts              # selectAccount + upstreamFetch + applyAccountError
src/proxy/notion/patch.ts        # JSON-Patch emitter (OpenAI request → Notion patch doc)
src/proxy/notion/extract.ts      # NDJSON stream parser + JSON-Patch applicator + text-delta extractor
src/selection/notion.ts          # sticky / round-robin state machine + conversation routing lookup/upsert
src/models/notion.ts             # manifest-driven model catalogue
src/models/notion/manifest.json  # model list from getAvailableModels
src/db/migrations/008-conversation-routing.ts
scripts/notion-add-account.ts    # CLI: email → 6-char temp password prompt → cookie stored
docs/notion/capture-notes.md     # RE capture (already exists, commit cabf7af)
docs/notion/capture.har          # raw HAR (already exists)
tests/fixtures/notion/sample-stream.har  # AI + auth subset (already exists)
tests/proxy/notion/*.test.ts
tests/auth/notion.test.ts
tests/selection/notion.test.ts
```

---

## Components

### 1. Auth — `src/auth/notion.ts`

Three-step login (no OTP, uses 6-character temp password emailed to user):

```ts
export async function getLoginOptions(email: string): Promise<{
  loginOptionsToken: string
  hasAccount: boolean
  passwordSignIn: boolean
}>

export async function sendTemporaryPassword(
  email: string,
  loginOptionsToken: string,
  deviceId: string,
): Promise<{ csrfState: string }>

export async function loginWithEmail(
  csrfState: string,
  password: string,
): Promise<{
  cookies: { notion_user_id: string; token_v2: string; file_token: string }
  userId: string
}>
```

Endpoints (from capture):
- `POST https://app.notion.com/api/v3/getLoginOptions` body `{email, requireWorkTypeEmail: false}`
- `POST https://app.notion.com/api/v3/sendTemporaryPassword` body `{email, loginOptionsToken, deviceId, disableLoginLink, native, isSignup, shouldHidePasscode, loginRouteOrigin}`
- `POST https://app.notion.com/api/v3/loginWithEmail` body `{state: csrfState, password, appSource: "notion", loginRouteOrigin: "login"}`
- Response: `Set-Cookie` header carries `notion_user_id`, `token_v2`, `file_token`. Auth module parses these via `undici`'s `set-cookie` handler.

Errors: `getLoginOptions` returns `hasAccount: false` → CLI exits with "no Notion account for this email". `sendTemporaryPassword` non-200 → "email send failed, check spam or retry". `loginWithEmail` 401 → wrong password, prompt again. No DB write until all 3 steps succeed.

### 2. CLI — `scripts/notion-add-account.ts`

```
$ npm run notion-add-account -- --label personal --email attila@kcmon.id
> Checking Notion account...
> ✓ Account exists
> Sending temporary password to attila@kcmon.id...
> Enter 6-character password from email: hdqiGs
> ✓ Account 'personal' added (user_id=382d872b-...)
```

- `readline` prompts for password after `sendTemporaryPassword`
- On success: insert into `accounts` with `provider='notion'`, `cookie_token_v2=<token>`, `cookie_file_token=<file>`, `cookie_user_id=<id>`, `user_id`, `email`
- Cookie columns encrypted via SQLCipher at rest (already enforced)
- Trigger model seed: `seedModelsFor('notion')` reads `manifest.json`

### 3. Patch emitter — `src/proxy/notion/patch.ts`

Converts OpenAI chat request → Notion JSON-Patch document. Inputs: model alias (e.g., `notion-gpt-5`), `messages[]`, optional `conversation_id` (UUID). Output: NDJSON body ready to POST.

```ts
export function buildPatchRequest(opts: {
  modelInternalId: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  spaceId: string           // from getAvailableModels request in capture
  conversationId?: string   // existing conversation UUID
}): {
  conversationId: string    // new UUID if not provided
  patches: string[]         // NDJSON lines
}
```

Patch document structure (from capture):
1. `patch-start` line: establishes `s` (state) array containing initial `agent-instruction-state` record with `owner: "regular"`, `root: {type: "none"}`, empty `sources`, `selectedSkillPageIds`, `trackedInstructionTreePages`
2. `patch` lines adding records to `s` array via `o: "a", p: "/s/-"`:
   - One `agent-turn-full-record-map` record (parent for messages)
   - For each message: an `agent-inference` record with `value: [{type: "text", content: "..."}]`, `traceId: <uuid>`, `startedAt: <unix-ms>`
3. `done` line

Internal model IDs (from capture, must be used verbatim):
- `oatmeal-cookie` (GPT-5.2)
- `oval-kumquat-medium` (GPT-5.4)
- `opal-quince-medium` (GPT-5.5)
- `vertex-gemini-2.5-flash` (Gemini 2.5 Flash)
- `vertex-gemini-3.5-flash` (Gemini 3.5 Flash)
- `almond-croissant-low` (Sonnet 4.6)
- `acai-budino` (Fable 5, restricted)

Router-facing aliases → internal IDs:
- `notion-gpt-5.2` → `oatmeal-cookie`
- `notion-gpt-5.4` → `oval-kumquat-medium`
- `notion-gpt-5.5` → `opal-quince-medium`
- `notion-gemini-2.5-flash` → `vertex-gemini-2.5-flash`
- `notion-gemini-3.5-flash` → `vertex-gemini-3.5-flash`
- `notion-sonnet-4.6` → `almond-croissant-low`

### 4. NDJSON extractor — `src/proxy/notion/extract.ts`

Parses the response stream and produces text deltas for OpenAI streaming:

```ts
export interface TextDelta {
  conversationId: string
  delta: string        // new text appended
  done: boolean        // true after final patch
  toolCall?: never     // out of scope v1
}

export function* parseNdjsonResponse(
  stream: AsyncIterable<Buffer>,
): AsyncIterable<TextDelta>
```

Algorithm:
1. Accumulate patches into a state object (use `fast-json-patch` library)
2. Track each `agent-inference` record's `value[0].content` field
3. On each `o: "x"` patch against a content path, diff old vs new value
4. Emit `TextDelta { delta: <new - old>, ... }` for each diff
5. On `{"type": "done"}` line, emit final delta with `done: true`
6. The root conversation UUID is the `id` of the first `agent-turn-full-record-map` patch

### 5. Proxy — `src/proxy/notion.ts`

```ts
export async function proxyNotion(ctx: ProxyContext): Promise<ProxyResult>
```

Per-request flow:
1. Extract `conversation_id` from request body (`messages[0].conversation_id` metadata field, or custom header — TBD)
2. Lookup `conversation_routing` table — if found AND referenced account healthy → pin to that account, reuse patch document
3. If not found OR account unhealthy → run `selectAccount('notion')` for a fresh account
4. Build patch document via `buildPatchRequest(...)` using account's `space_id` (cached from `getAvailableModels` call on account-add)
5. POST `https://app.notion.com/api/v3/runInferenceTranscript` with NDJSON body + cookies
6. Parse response via `parseNdjsonResponse(stream)` → convert each `TextDelta` to OpenAI `chat.completion.chunk`
7. On success: upsert `conversation_routing(conversation_id, account_id, model)`
8. Error handling per status code (table below)

### 6. Selection — `src/selection/notion.ts`

Same as spec v1: sticky / round-robin, skip backoff/locked/disabled/model-locked.

### 7. Conversation routing — `src/db/migrations/008-conversation-routing.ts`

Schema unchanged from spec v1:
```sql
CREATE TABLE conversation_routing (
  conversation_id TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  model           TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  last_used_at    INTEGER NOT NULL
);
```

Key change from v1 spec: a "conversation" is now identified by the root `agent-turn-full-record-map` UUID. We do NOT send this UUID back as `conversation_id` to Notion on subsequent calls (Notion doesn't accept cross-account conversation reuse based on capture evidence). Instead: each request creates a fresh patch document and sends to Notion. Notion's server tracks history server-side per `space_id`. The router's `conversation_routing` table is used to:
- Sticky-route to the same Notion account (for session continuity, since each account has its own server-side state)
- Avoid re-issuing a new patch doc UUID when the client already has one

**Migration semantics on failover:**
- If mapped account unhealthy → pick next healthy account, **omit** the conversation UUID from the patch document (force a fresh conversation on the new account)
- Set `X-Notion-Conversation-Migrated: true` header in response
- Insert new row with the new patch-doc UUID

### 8. Models — `src/models/notion.ts` + `manifest.json`

Manifest populated from `getAvailableModels` capture:
```json
{
  "provider": "notion",
  "models": [
    { "id": "oatmeal-cookie", "alias": "notion-gpt-5.2", "family": "openai", "displayName": "GPT-5.2", "thinking": { "supported": false }, "maxCompletionTokens": 8192, "pricing": { "inputPerMillion": 0, "outputPerMillion": 0 } },
    { "id": "oval-kumquat-medium", "alias": "notion-gpt-5.4", ... },
    { "id": "opal-quince-medium", "alias": "notion-gpt-5.5", ... },
    { "id": "vertex-gemini-2.5-flash", "alias": "notion-gemini-2.5-flash", ... },
    { "id": "vertex-gemini-3.5-flash", "alias": "notion-gemini-3.5-flash", ... },
    { "id": "almond-croissant-low", "alias": "notion-sonnet-4.6", ... }
  ]
}
```

Pricing left at 0 (Notion AI is subscription-based, not per-token; router can compute "API-equivalent" cost later).

---

## Error Handling

| Notion status | Class | Action | Failover? |
|---|---|---|---|
| 200 | success | sticky, clear backoff | — |
| 401 | fatal | disable account, surface `notion_reauth_required` to client | NO |
| 403 | fatal | disable account | NO |
| 404 | fatal (unknown record) | return 404, suggest new conversation | NO |
| 429 | retryable | backoff 60s, model lock if `Retry-After` per-model | YES |
| 500/502/503 | retryable | exp backoff 1s→2s→4s, max 3 attempts | YES |
| network/timeout | retryable | failover immediately | YES |
| `hasAccount: false` | fatal | CLI rejects email, do not insert row | — |
| `passwordSignIn: true` | unsupported | CLI rejects with message "account requires password, not supported" | — |

---

## Data Flow — Single Request

```
Client (OpenAI format)
  → POST /v1/chat/completions w/ Bearer client_key
  → parseBody + model alias resolution (router-facing → internal model ID via manifest)
  → extract conversation_id from body (custom field or header)
  → selectAccount('notion')
      ├─ if conversation_id in routing + account healthy → use that account
      ├─ if conversation_id in routing + account unhealthy → next healthy account, omit conversation_id (force fresh conversation)
      └─ else → normal selection, no conversation_id from client
  → checkModelLock → 429 if locked
  → augment system prompt
  → buildPatchRequest({modelInternalId, messages, spaceId, conversationId?})
      → returns {conversationId, patches[]} (NDJSON body)
  → upstreamFetch (cookies + notion-client-version header, NO Authorization)
      ├─ POST runInferenceTranscript with NDJSON body
      └─ parseNdjsonResponse → for each TextDelta, emit OpenAI chunk via pipeWithUsage
  → on success: upsert conversation_routing(conversationId, accountId, model)
  → insertRequestLog(cost=0, tokens=<from inference record if available>, latency, account_id, requested_model, conversation_id)
  → applyAccountError (clear on success, backoff/lock on failure)
```

---

## Testing (TDD red-green per CLAUDE.md)

**`tests/auth/notion.test.ts`** — mock fetch, assert:
- `getLoginOptions` parses response correctly
- `sendTemporaryPassword` posts correct body shape
- `loginWithEmail` extracts cookies from `Set-Cookie` header
- 401 from `loginWithEmail` throws `NotionAuthError('wrong_password')`
- No DB row inserted on partial failure

**`tests/proxy/notion/patch.test.ts`** — assert:
- `buildPatchRequest` produces valid NDJSON with `patch-start`, patches, `done`
- Empty `messages[]` → at least one `agent-instruction-state` patch
- 2 messages → produces 2 `agent-inference` records under same `agent-turn-full-record-map`
- `conversation_id` is generated as UUIDv4 if not provided
- `omitConversationId: true` → no UUID embedded in patches

**`tests/proxy/notion/extract.test.ts`** — assert:
- `parseNdjsonResponse` yields `TextDelta` for each `o: "x"` patch against content path
- Final `{"type": "done"}` line yields `done: true`
- Multi-record streams correctly separate deltas per inference record
- Malformed JSON line skipped with warning (not throw)

**`tests/proxy/notion.test.ts`** — integration tests:
- 401 → account disabled, NO failover attempted
- 429 → backoff set, failover attempted
- 5xx → exp backoff, max 3 attempts
- Conversation routing: `conversation_id` present + healthy → uses that account
- Conversation routing: `conversation_id` present + unhealthy → migrates, sets `X-Notion-Conversation-Migrated`

**`tests/selection/notion.test.ts`** — sticky/round-robin/skip rules (mirrors spec v1).

**Fixtures:**
- `tests/fixtures/notion/sample-stream.har` (already exists, has 12 AI + auth entries)
- `tests/fixtures/notion/login.har` (subset: 3 login entries only) — for auth tests
- `tests/fixtures/notion/chat.ndjson` (extracted NDJSON response from sample-stream.har) — for extract tests

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Notion ToS prohibits third-party AI chat clients | Document experimental in `docs/notion/README.md`, require user acknowledgment on CLI |
| Endpoint / patch format drift | Pin `notion-client-version`, alert on 4xx error spike, model seed re-runnable |
| JSON-Patch parser bugs silently lose content | Integration tests assert exact text content extraction, not just "non-empty response" |
| Cookie theft → account compromise | SQLCipher encrypts cookies at rest, never log `token_v2`, redact in error messages |
| Subscription gating (402) | `getAIUsageEligibility` called on account-add, reject account if `isEligible: false` |
| Conversation state divergence across accounts | Each account has its own Notion server-side state; failover creates new conversation on new account (graceful break) |

---

## Out of Scope (YAGNI)

- Function/tool calling (`agent-tool-result` records in capture)
- Image/file uploads (`agent-tool-result: "callFunction"` with image tools)
- Multi-workspace routing
- WebSocket streaming (NDJSON is sufficient for v1)
- Conversation history sync (each request is fresh patch doc)
- Publishing an official Notion SDK
- Rate limit tracking / quota display

---

## Implementation Order

1. DB migration (Task 1) — independent
2. Auth module + CLI (Tasks 2-3) — no upstream dependency
3. Patch emitter (Task 6) — pure transform, testable
4. NDJSON extractor (Task 7) — pure transform, testable
5. Proxy integration (Task 8) — wires 3 + 4
6. Selection + routing (Tasks 4-5) — wires 1 + 8
7. Models manifest (Task 10)
8. Integration tests (Task 9)
9. Docs (Task 11)
10. Final verification (Task 12)

Each step: red test → green impl → commit (conventional commits, ~300 LOC max per commit).