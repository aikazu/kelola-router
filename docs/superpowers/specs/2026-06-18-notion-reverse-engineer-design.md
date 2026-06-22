# Notion Desktop AI Chat (Reverse Engineer & Router Integration)

**Date:** 2026-06-18
**Status:** v3 REVISION. Request body is single JSON `{traceId, spaceId, transcript, patches}` (not NDJSON). Image input via `attachment` record (v1: Notion-hosted URLs only). 11 cookies required for AI request. See `docs/notion/wire-format.md` for full protocol + `docs/notion/capture-notes.md` for RE findings.
**Owner:** aikazu
**Related:** mirrors `src/providers/kiro/` + `src/proxy/kiro.ts` patterns

---

## Goal

Reverse engineer the AI chat endpoints of the Notion desktop client, document the protocol, and integrate Notion as a new upstream provider in `kelola-router`: 3-step temp-password login, cookie-based session auth, JSON request / NDJSON response translation to/from OpenAI chat-completion format, image input (Notion-hosted), tool calls, and conversation continuity.

**Non-goals (v1):** HTTPS/base64 image upload (v1 = Notion-hosted `attachment:` URLs only), function/tool calling (captured but implementation deferred; schema known), multi-workspace routing, image generation in response.

---

## Why

The router currently fronts MiniMax, Kiro, CodeBuddy, and Pioneer. Notion AI is a popular subscription users already pay for; routing it through the router gives them a single OpenAI-compatible surface, key isolation, usage logs, and (future) failover across multiple Notion accounts.

---

## Architecture

```
src/providers/notion/
  constants.ts            # endpoints, internal model IDs, header builders, version pin
  auth.ts                 # getLoginOptions + sendTemporaryPassword + loginWithEmail + parseCookies + ensureNotionAuth
  transform.ts            # buildNotionPayload(openaiBody, account) → JSON {traceId, spaceId, transcript, patches}
  extract.ts              # NDJSON stream parser + JSON-Patch applicator + text-delta extractor
  index.ts                # executeNotion() (entry point: cookies + headers, dispatch)
  *.test.ts
src/proxy/notion.ts       # handleNotionProxy(c, format, upstreamPath) (mirror src/proxy/kiro.ts)
src/selection/notion.ts   # sticky/round-robin + conversation routing lookup/upsert
src/models/notion/manifest.json  # model list from getAvailableModels
src/db/migrations/008-notion-provider.ts  # notion_user_id, notion_space_id cols + conversation_routing table
scripts/notion-add-account.ts   # CLI: 3-step login + cookie storage
scripts/seed-notion-models.ts   # upsert from manifest
client/src/pages/Accounts.tsx   # NotionCard
client/src/components/NotionAuthForm.tsx + useNotionAuth.ts
docs/notion/wire-format.md      # protocol reference (exists)
docs/notion/capture-notes.md    # RE findings (exists)
tests/fixtures/notion/sample-stream.har
tests/fixtures/notion/login.har
tests/proxy/notion.test.ts
tests/providers/notion/*.test.ts
```

---

## Components

### 1. Auth (`src/providers/notion/auth.ts`)

Three-step login (per `docs/notion/wire-format.md`):

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
  cookies: Record<string, string>  // 8 cookies: token_v2, file_token, notion_user_id, notion_users, notion_sync_user_id, notion_locale, NEXT_LOCALE, p_sync_session
  userId: string
}>

export async function ensureNotionAuth(
  db: Database.Database,
  account: Account,
): Promise<{ cookies: Record<string, string>; userId: string; spaceId: string }>
// Returns cached cookies from accounts.provider_data if fresh (< 1 hour old),
// otherwise triggers re-login via stored email (re-asks password via dashboard).
```

Cookies stored in `accounts.provider_data` as JSON:
```json
{
  "cookies": { "token_v2": "...", "file_token": "...", "notion_user_id": "...", ... },
  "userId": "382d872b-...",
  "deviceId": "<uuid>",
  "cookiesFetchedAt": "2026-06-18T..."
}
```

### 2. Transformer (`src/providers/notion/transform.ts`)

```ts
export function buildNotionPayload(opts: {
  openaiBody: ChatCompletionRequest
  account: Account
  internalModelId: string   // e.g. "oatmeal-cookie"
  spaceId: string            // from account.notion_space_id
  attachments?: Array<{ fileUrl: string; fileName: string; contentType: string; metadata: {...} }>
}): {
  body: string  // JSON.stringify'd body
  traceId: string
}
```

**Converts:**
- `messages[]` → multiple `agent-inference` records in `transcript[]`, one per message (system role → content folded into first user message OR kept as separate `agent-inference` with role system)
- `model` → `config.value.model` (internal ID, mapped from router alias)
- `attachments` (from `messages[].content[].type: "image_url"`) → `attachment` records prepended to `transcript[]`
- `stream` → `config.value.enableXxx` flags (always set `useWebSearch: true`, `enableAgentGenerateImage: true`)
- `tools[]` → append as `agent-tool-result` records OR `config.value.availableConnectors` (v1: leave empty)

**Output JSON structure:**
```json
{
  "traceId": "<uuid>",
  "spaceId": "<workspace-uuid>",
  "transcript": [
    { "id": "<uuid>", "type": "config", "value": {...} },
    { "id": "<uuid>", "type": "agent-instruction-state", "owner": "regular", "root": {"type": "none"}, "sources": [], "selectedSkillPageIds": [], "trackedInstructionTreePages": [] },
    { "id": "<uuid>", "type": "agent-turn-full-record-map", "value": {} },
    { "id": "<uuid>", "type": "attachment", ... },
    { "id": "<uuid>", "type": "agent-inference", "value": [{"type": "text", "content": "..."}], "traceId": "<uuid>", "startedAt": <ms> }
  ],
  "patches": []
}
```

### 3. Stream Extractor (`src/providers/notion/extract.ts`)

```ts
export interface TextDelta {
  conversationId: string  // captured from first patch-start
  delta: string
  done: boolean
  toolCall?: { id: string; name: string; arguments: string }
}

export async function* extractNotionStream(
  response: Response,
): AsyncIterable<TextDelta>
```

**Algorithm:**
1. Initialize state from first `{"type":"patch-start"}` line
2. For each subsequent line, apply patches to state using `fast-json-patch`
3. Track each `agent-inference` record's `value[0].content`
4. When content changes, emit `TextDelta { delta: <new_chars - old_chars> }`
5. For `agent-tool-result` records, emit `TextDelta { toolCall: {...} }`
6. On `{"type":"done"}`, emit `TextDelta { done: true }`

### 4. Proxy (`src/proxy/notion.ts`)

Mirrors `src/proxy/kiro.ts`:
- `handleNotionProxy(c, format, upstreamPath)`
- Reads account from `accounts` table via model lookup
- Calls `ensureNotionAuth()` for fresh cookies
- Builds request via `buildNotionPayload()`
- POSTs to `https://app.notion.com/api/v3/runInferenceTranscript` with cookies + `notion-client-version`
- Pipes response via `extractNotionStream()` → OpenAI/Anthropic SSE chunks
- Logs via `consoleBus` (`start`/`account`/`transport`/`done`/`error` events)
- Error mapping: 401 → disable + `notion_reauth_required`, 429 → backoff + failover, 5xx → exp backoff

### 5. Selection (`src/selection/notion.ts`)

```ts
export interface NotionSelectionConfig {
  mode: 'sticky' | 'round-robin'
  step: number
}

export function selectNotionAccount(cfg: NotionSelectionConfig): Account | null
```

Mirror of `src/selection/kiro.ts`. Skip backoff/locked/disabled/model-locked accounts. Sticky default.

### 6. Conversation Routing

Schema (`src/db/migrations/008-notion-provider.ts`):
```sql
CREATE TABLE conversation_routing (
  conversation_id TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  model           TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Plus `ALTER TABLE accounts ADD COLUMN notion_user_id TEXT` + `notion_space_id TEXT`.

**Lookup:** `conversation_id` extracted from request body custom field `notion_conversation_id` or `X-Notion-Conversation-Id` header. If found + account healthy → pin. If found + account unhealthy → failover (omit conversation_id from new request, force fresh conversation on new account).

**v1 simplification:** capture evidence shows each request is stateless (full transcript sent each time). No need for cross-turn conversation continuity in router. **Skip conversation_routing table for v1**. Just select a healthy account per request.

### 7. Models

`src/providers/notion/manifest.json`:
```json
{
  "provider": "notion",
  "models": [
    { "id": "oatmeal-cookie", "alias": "nt/notion-gpt-5.2", "displayName": "GPT-5.2", "family": "openai", "maxCompletionTokens": 8192, "pricing": { "input": 0, "output": 0 } },
    { "id": "oval-kumquat-medium", "alias": "nt/notion-gpt-5.4", "displayName": "GPT-5.4", "family": "openai", "maxCompletionTokens": 8192, "pricing": { "input": 0, "output": 0 } },
    { "id": "opal-quince-medium", "alias": "nt/notion-gpt-5.5", "displayName": "GPT-5.5", "family": "openai", "maxCompletionTokens": 8192, "pricing": { "input": 0, "output": 0 } },
    { "id": "vertex-gemini-2.5-flash", "alias": "nt/notion-gemini-2.5-flash", "displayName": "Gemini 2.5 Flash", "family": "gemini", "maxCompletionTokens": 8192, "pricing": { "input": 0, "output": 0 } },
    { "id": "vertex-gemini-3.5-flash", "alias": "nt/notion-gemini-3.5-flash", "displayName": "Gemini 3.5 Flash", "family": "gemini", "maxCompletionTokens": 8192, "pricing": { "input": 0, "output": 0 } },
    { "id": "almond-croissant-low", "alias": "nt/notion-sonnet-4.6", "displayName": "Sonnet 4.6", "family": "anthropic", "maxCompletionTokens": 8192, "pricing": { "input": 0, "output": 0 } }
  ]
}
```

(`acai-budino` excluded: restricted trial.)

`pricing: 0` because Notion AI is subscription-based, not per-token. Router can compute "API-equivalent" cost later.

### 8. CLI (`scripts/notion-add-account.ts`)

```
$ npm run notion-add-account -- --label personal --email attila@kcmon.id
> Checking Notion account...
> ✓ Account exists (no password required)
> Sending temporary password to attila@kcmon.id...
> Enter 6-character password from email: hdqiGs
> Fetching available models...
> ✓ Account 'personal' added (user_id=382d872b-...)
```

### 9. Dashboard

`client/src/pages/Accounts.tsx`: add `<NotionCard />` parallel to `<KiroCard />`.
`client/src/components/NotionAuthForm.tsx` + `useNotionAuth.ts`: 3-step login flow with email + password fields.

---

## Error Handling

| Notion status | Class | Action | Failover? |
|---|---|---|---|
| 200 | success | sticky, clear backoff | n/a |
| 401 | fatal | disable account, surface `notion_reauth_required` to client | NO |
| 403 | fatal | disable account | NO |
| 404 | fatal (unknown conversation/record) | return 404, suggest new conversation | NO |
| 429 | retryable | backoff 60s, model lock if `Retry-After` per-model | YES |
| 500/502/503 | retryable | exp backoff 1s→2s→4s, max 3 attempts | YES |
| network/timeout | retryable | failover immediately | YES |
| `hasAccount: false` | fatal | CLI rejects email, no DB row | n/a |
| `passwordSignIn: true` | unsupported | CLI rejects, "account requires password, not supported" | n/a |
| `getAIUsageEligibility.isEligible: false` | fatal | reject at account-add time | n/a |

---

## Data Flow: Single Request

```
Client (OpenAI format)
  → POST /v1/chat/completions w/ Bearer client_key
  → parseBody + model alias resolution (router-facing → internal ID via manifest)
  → selectAccount('notion') (sticky/round-robin)
  → checkModelLock → 429 if locked
  → augment system prompt
  → buildNotionPayload({openaiBody, account, internalModelId, spaceId, attachments})
      → returns {body: JSON, traceId}
  → upstreamFetch (cookies + notion-client-version header, NO Authorization)
      ├─ POST runInferenceTranscript with JSON body
      └─ pipeNotionStream → for each TextDelta, emit OpenAI chunk via pipeWithUsage
  → on success: insertRequestLog(cost=0, tokens, latency, account_id, model, conversation_id)
  → applyAccountError (clear on success, backoff/lock on failure)
```

---

## Testing (TDD red-green per CLAUDE.md)

**`tests/providers/notion/auth.test.ts`** (mock fetch):
- `getLoginOptions` parses response
- `sendTemporaryPassword` posts correct body
- `loginWithEmail` extracts 8 cookies from Set-Cookie header (correct domain filtering)
- `ensureNotionAuth` returns cached cookies if fresh, re-auths on 401
- No DB row inserted on partial login failure

**`tests/providers/notion/transform.test.ts`**:
- `buildNotionPayload` returns valid JSON with required top-level keys
- Empty messages → minimal transcript (just config + instruction-state + turn-map)
- 1 user message → produces 1 `agent-inference` record
- System message + user message → 2 `agent-inference` records OR folded (TBD)
- Image URL `attachment:...` → produces `attachment` record
- Model alias → correct internal ID
- `stream: true` → config has streaming-compatible flags

**`tests/providers/notion/extract.test.ts`**:
- Empty stream → no deltas
- `patch-start` → state initialized
- `patch` adds inference → content captured
- Subsequent `patch` updates content → delta emitted with diff
- `agent-tool-result` → toolCall emitted
- `done` → final TextDelta with done=true

**`tests/proxy/notion.test.ts`** (integration):
- 401 → account disabled, NO failover attempted
- 429 → backoff set, failover attempted
- 5xx → exp backoff, max 3 attempts
- Successful stream → OpenAI SSE chunks emitted in correct order

**Fixtures:**
- `tests/fixtures/notion/sample-stream.har` (exists)
- `tests/fixtures/notion/login.har` (3 login entries, extract from main capture)
- `tests/fixtures/notion/chat-request.json` (full extracted request body)
- `tests/fixtures/notion/chat-response.ndjson` (full extracted NDJSON response)

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Notion ToS prohibits third-party AI chat clients | Document experimental, require user acknowledgment on CLI |
| Endpoint / patch format drift | Pin `notion-client-version`, alert on 4xx error spike |
| Cookie theft → account compromise | SQLCipher encrypts cookies at rest, redact `token_v2` in logs |
| 3-step login breaks when user closes window | CLI re-asks password on 401, dashboard surfaces re-auth button |
| Image upload endpoint not captured | v1 only supports Notion-hosted `attachment:` URLs |
| Subscription gating (402 / `isEligible: false`) | Check at account-add time, reject account |

---

## Out of Scope (YAGNI)

- HTTPS / base64 image upload (v1: Notion-hosted URLs only)
- Function/tool calling UI in dashboard (router passes through but no model definition UI)
- Multi-workspace routing
- WebSocket streaming (NDJSON + HTTP/1.1 is sufficient for v1)
- Cross-turn conversation continuity (each request is stateless from router's view)
- Publishing an official Notion SDK

---

## Implementation Order

1. Migration + enum extension (Tasks 1-2)
2. Auth module + CLI (Tasks 3)
3. Transformer (Task 4). Pure function, easy to test.
4. Stream extractor (Task 5). Pure function, easy to test.
5. Proxy + dispatch wiring (Task 6)
6. Selection (Task 7)
7. Models manifest + seed (Task 8)
8. CLI scripts (Task 9)
9. Tool call wire-up (Task 10). Defer if needed.
10. Dashboard (Task 11)
11. Tests + docs (Tasks 12-13)

Each step: red test → green impl → commit (conventional commits, ~300 LOC max per commit).