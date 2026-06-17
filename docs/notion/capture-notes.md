# Notion Desktop Capture Notes

**Source HAR:** `capture.har` (1098 Notion API entries)
**Notion desktop version:** 23.13.20260617.1538 (`notion-client-version` header)
**Account:** attila@kcmon.id (user_id: 382d872b-594c-81ff-b89c-00021216a6b0)
**Capture date:** 2026-06-17

## TL;DR — Protocol is NOT OpenAI-style

Notion AI chat uses a **sync-style CRDT protocol**, not a chat-completion API:

- **Request body**: newline-delimited JSON-patch operations (JSON-Patch RFC 6902 over a record map)
- **Response**: `application/x-ndjson` stream (NOT SSE)
- **Conversation model**: shared record-map with `agent-instruction-state`, `agent-turn-full-record-map`, `agent-inference`, `agent-tool-result` records
- **Auth**: 3-step login (getLoginOptions → sendTemporaryPassword → loginWithEmail), no OTP
- **Authentication token**: cookie session, NOT Authorization header

This is fundamentally different from OpenAI/Anthropic chat completion APIs. The router integration must either:
(a) Replay this CRDT protocol faithfully, OR
(b) Wrap it as OpenAI-style on the client-facing side while internally translating

## Authentication

### Step 1: Get Login Options
- URL: `POST https://app.notion.com/api/v3/getLoginOptions`
- Headers: `notion-client-version`, `content-type: application/json`, cookie session
- Request body:
```json
{
  "email": "attila@kcmon.id",
  "requireWorkTypeEmail": false
}
```
- Response:
```json
{
  "hasAccount": true,
  "samlSignIn": "unavailable",
  "passwordSignIn": false,
  "mustReverify": false,
  "loginOptionsToken": "v02:login_options:..."
}
```
- Field paths:
  - `loginOptionsToken` → must be passed to step 2
  - `hasAccount` → indicates whether login flow continues

### Step 2: Send Temporary Password
- URL: `POST https://app.notion.com/api/v3/sendTemporaryPassword`
- Headers: same
- Request body:
```json
{
  "email": "attila@kcmon.id",
  "disableLoginLink": false,
  "native": true,
  "isSignup": false,
  "shouldHidePasscode": false,
  "loginOptionsToken": "v02:login_options:...",
  "deviceId": "<uuid>",
  "loginRouteOrigin": "login"
}
```
- Response:
```json
{
  "csrfState": "v02:temp_password:..."
}
```
- Side effect: sends the temporary password to user's email (NOT a 6-digit code)

### Step 3: Login with Email
- URL: `POST https://app.notion.com/api/v3/loginWithEmail`
- Request body:
```json
{
  "state": "v02:temp_password:...",
  "password": "<6-char temp password from email>",
  "appSource": "notion",
  "loginRouteOrigin": "login"
}
```
- Response:
```json
{
  "isNewSignup": false,
  "userId": "382d872b-594c-81ff-b89c-00021216a6b0"
}
```
- Note: response does NOT contain token directly — the token is set as a `Set-Cookie` response header (`file_token` / `token` cookie)

### Cookie-based session
- Auth state lives in cookies (e.g., `notion_user_id`, `token_v2`, `file_token`)
- All subsequent requests to `app.notion.com/api/v3/*` send cookies via browser/Electron
- NO `Authorization: Bearer` header is used — this is cookie auth, not token auth

### Token Refresh
- Not observed in capture (no 401 → refresh sequence)
- Notion sessions appear to persist long-lived (likely weeks)
- Refresh endpoint: NOT FOUND

## AI Chat

### Endpoint
- URL: `POST https://app.notion.com/api/v3/runInferenceTranscript`
- Headers:
  - `notion-client-version: 23.13.20260617.1538`
  - `content-type: application/json`
  - cookie session (no Authorization header)
- Response Content-Type: `application/x-ndjson`

### Request Body Format

Body is newline-delimited JSON-patch operations. First record establishes an `agent-instruction-state`, subsequent patches add records to a `s` (state) array. Example abbreviated:

```
{"type":"patch-start","data":{"s":[{"id":"<uuid>","type":"agent-instruction-state","owner":"regular","root":{"type":"none"},"sources":[],"selectedSkillPageIds":[],"trackedInstructionTreePages":[]}]},"version":1}
{"type":"patch","v":[{"o":"a","p":"/s/-","v":{"id":"<uuid>","type":"agent-turn-full-record-map"}}]}
{"type":"patch","v":[{"o":"a","p":"/s/-","v":{"id":"<uuid>","type":"agent-tool-result","toolName":"callFunction",...}}]}
... (more patches adding messages, sources, etc.)
{"type":"patch","v":[{"o":"a","p":"/s/-","v":{"id":"<uuid>","type":"agent-inference","value":[{"type":"text","content":"Hello!"}],"traceId":"<uuid>","startedAt":<unix-ms>}}]}
{"type":"done"}
```

Patch op codes seen:
- `o: "a"` = array append at path `p`
- `o: "x"` = patch value at path `p` with `v`

### Response Format

NDJSON stream of same patch operations plus a final `{"type":"done"}`. Each line is a complete JSON object.

Example response lines (concatenated, real capture):
```
{"type":"patch-start","data":{"s":[...]}, "version":1}
{"type":"patch","v":[{"o":"a","p":"/s/-","v":{"id":"<uuid>","type":"agent-inference","value":[{"type":"text","content":"Halo, Attila!"}],"traceId":"<uuid>","startedAt":1781725646413}}]}
{"type":"patch","v":[{"o":"x","p":"/s/1/value/0/content","v":" 👋 Senang ngobrol sama kamu. ..."}]}
{"type":"done"}
```

### Streaming Content Extraction

The text content is delivered incrementally via `o:"x"` patches against paths like `/s/<index>/value/0/content`. The router must:
1. Accumulate patches
2. Apply them to a local JSON-Patch state (json-patch library)
3. Diff against previous state to extract new text tokens
4. Forward as OpenAI `chat.completion.chunk` deltas

### Conversation IDs

UUIDs like `382966f7-8a76-81d9-a7d4-00aaa76c719b` — correspond to the `id` of the `agent-turn-full-record-map` record, OR a higher-level conversation entity. NOT a single `conversation_id` field; it's the patch document itself that represents the conversation.

### Model IDs

From `POST /api/v3/getAvailableModels` (request body `{spaceId: "<workspace-uuid>"}`):

| Internal ID (`model`) | Display (`modelMessage`) | Family |
|---|---|---|
| `oatmeal-cookie` | GPT-5.2 | openai |
| `oval-kumquat-medium` | GPT-5.4 | openai |
| `opal-quince-medium` | GPT-5.5 | openai |
| `vertex-gemini-2.5-flash` | Gemini 2.5 Flash | gemini |
| `vertex-gemini-3.5-flash` | Gemini 3.5 Flash | gemini |
| `almond-croissant-low` | Sonnet 4.6 | anthropic |
| `acai-budino` | Fable 5 (restricted, trial_not_allowed) | anthropic |

The internal ID is what goes into the patch stream's `model` field. Display name is for UI. Some models may also need a `spaceId` in the request context — router should fetch available models per-account on demand.

## Other Useful Endpoints

| URL | Method | Purpose |
|---|---|---|
| `/api/v3/getLoginOptions` | POST | Login step 1 |
| `/api/v3/sendTemporaryPassword` | POST | Login step 2 (triggers email) |
| `/api/v3/loginWithEmail` | POST | Login step 3 (returns userId + sets cookie) |
| `/api/v3/authValidate` | POST | Validate current session |
| `/api/v3/getAvailableModels` | POST | Model catalog for AI |
| `/api/v3/getAIUsageEligibility` | POST | Check AI access for account |
| `/api/v3/getAIUsageEligibilityV2` | POST | Same, newer version |
| `/api/v3/runInferenceTranscript` | POST | Main AI chat endpoint |
| `/api/v3/getInferenceTranscriptsForUser` | POST | List user's conversations |
| `/api/v3/markInferenceTranscriptSeen` | POST | Mark conversation read |
| `https://identity.notion.com/authSync` | GET | Identity sync (returns HTML — auth happens client-side via WebSocket or postMessage to iframe) |

## Identity Sync (`identity.notion.com`)

The `identity.notion.com/authSync` endpoint returns an HTML page that bootstraps an authentication iframe. Actual auth credential exchange happens via WebSocket or postMessage. The cookie set by this iframe is what gets sent on subsequent `app.notion.com` requests.

For the router integration, we can SKIP this and use the cookie directly:
1. Capture the cookie value after a successful login (via mitmproxy)
2. Store as `accounts.cookie` (encrypted at rest)
3. Send `Cookie: <value>` header on every request

This is simpler than reimplementing the WebSocket handshake.

## Error Responses

No 4xx/5xx observed in the AI chat flow during capture (all 200). Typical Notion errors observed in other contexts:
- 401 → session expired, redirect to login
- 403 → permission denied
- 402 → no AI subscription (via `getAIUsageEligibility` returning false)

## Token Lifecycle

- Sessions persist for weeks (cookies last 1 year by default per Notion's cookie config)
- No refresh endpoint observed — when cookie expires, user must re-login
- `authValidate` is called periodically to check session validity

## Integration Implications

Given the CRDT-style protocol, the router integration strategy should be:

**Option A (Faithful replay — recommended for v1):**
- Client sends OpenAI-style request to router
- Router uses captured conversation documents (UUIDs) as proxies for "conversations"
- Router replays the exact same patch sequence to Notion's runInferenceTranscript
- Router parses NDJSON response, extracts text deltas, returns as OpenAI chunks
- Pros: works, minimal Notion-side surprises
- Cons: complex parser, brittle if Notion changes patch shape

**Option B (Wrapper):**
- Router exposes OpenAI-compatible surface
- Internally, translator converts OpenAI request → Notion patch sequence
- State management: router keeps "fake conversations" that map to patch documents
- Pros: clean external surface
- Cons: stateful on router, can drift from Notion's actual document state

**Recommend A for v1** — replay as faithfully as possible. Once stable, consider B if protocol drifts.

## Open Questions

1. How does conversation persistence work? Are conversations tied to specific cookie+userId, or can a different cookie+userId resume? (Need to capture: login as user A → start conversation → login as user B → try same UUID)
2. What is the exact field schema of `getAvailableModels` response? (Need to inspect)
3. Does streaming continue after `[DONE]` in any cases?
4. What triggers `runInferenceTranscript` to emit `agent-tool-result` records (function calling)?
5. Is there a way to pass system prompts / conversation history beyond what's in the initial agent-instruction-state?