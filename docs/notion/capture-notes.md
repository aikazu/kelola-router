# Notion Desktop Capture Notes v2 — RE for Router Integration

**Capture source:** `docs/notion/capture.har` (1098 Notion API entries)
**Capture date:** 2026-06-17
**Notion desktop version:** `23.13.20260617.1538` (`notion-client-version` header)
**Account:** attila@kcmon.id (user_id: `382d872b-594c-81ff-b89c-00021216a6b0`, workspace/space: `c8b966f7-8a76-8168-bfdb-0003e92f00e8`)
**Verified against:** live mitmweb capture + extracted JSON-Patch records

---

## TL;DR — Protocol Reality

Notion AI chat is **NOT a chat-completion API**. It is a **CRDT sync protocol with state diffs**:

- **Request body**: single JSON object `{traceId, spaceId, transcript: [...records...], patches: [...]}` — the records describe the new state
- **Response**: NDJSON stream of `{type: "patch-start" | "patch" | "patch-end" | "done"}` — incremental JSON-Patch operations building up the response state
- **Auth**: cookie-based (11 cookies required for AI request), established via 3-step login
- **Conversation model**: shared record-map with `config`, `agent-instruction-state`, `agent-turn-full-record-map`, `agent-inference`, `agent-tool-result`, `attachment` records
- **Tool calls**: supported via `agent-tool-result` records (`toolName: "callFunction"`, modular tools like `fs-module`, `notion-module`, `web-module`)
- **Image input**: confirmed working — image attached as `attachment` record with `fileUrl` referencing Notion-hosted file

Router integration strategy: build request JSON from OpenAI input, send to Notion, parse NDJSON response, apply patches to local state, extract text deltas for OpenAI streaming.

---

## 1. Authentication

### 1.1 Login Flow (3 steps, NOT OTP)

Notion uses a temporary password (6 alphanumeric characters) sent to the user's email, not a 6-digit OTP code.

#### Step 1: `POST /api/v3/getLoginOptions`

```
POST https://app.notion.com/api/v3/getLoginOptions
notion-client-version: 23.13.20260617.1538
content-type: application/json

{"email":"attila@kcmon.id","requireWorkTypeEmail":false}
```

Response:
```json
{
  "hasAccount": true,
  "samlSignIn": "unavailable",
  "passwordSignIn": false,
  "mustReverify": false,
  "loginOptionsToken": "v02:login_options:..."
}
```

- `hasAccount: false` → CLI exits "no Notion account for this email"
- `passwordSignIn: true` → CLI exits "account requires password login, not supported"

#### Step 2: `POST /api/v3/sendTemporaryPassword`

```
POST https://app.notion.com/api/v3/sendTemporaryPassword
notion-client-version: 23.13.20260617.1538
content-type: application/json

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

Response:
```json
{"csrfState": "v02:temp_password:..."}
```

Side effect: sends 6-char temp password to user's email.

#### Step 3: `POST /api/v3/loginWithEmail`

```
POST https://app.notion.com/api/v3/loginWithEmail
notion-client-version: 23.13.20260617.1538
content-type: application/json

{
  "state": "v02:temp_password:...",
  "password": "<6-char from email>",
  "appSource": "notion",
  "loginRouteOrigin": "login"
}
```

Response body:
```json
{"isNewSignup": false, "userId": "382d872b-594c-81ff-b89c-00021216a6b0"}
```

**Response Set-Cookie headers** (all 7 cookies required for subsequent requests):

| Cookie | Domain | Path | Expires | HttpOnly | Secure | SameSite | Purpose |
|---|---|---|---|---|---|---|---|
| `token_v2` | `app.notion.com` | `/` | 1 year | Yes | Yes | (default) | Primary auth (JWT-like encrypted) |
| `file_token` | `.notion.com` | `/f` | 1 year | Yes | Yes | (default) | File access for `/f/*` URLs only |
| `notion_user_id` | `app.notion.com` | `/` | 1 year | No | Yes | (default) | UUID of current user |
| `notion_users` | `app.notion.com` | `/` | 1 year | No | Yes | (default) | JSON array of user UUIDs |
| `notion_sync_user_id` | `.notion.com` | `/` | 90 days | No | Yes | (default) | JSON sync state |
| `notion_locale` | `app.notion.com` | `/` | 1 year | No | Yes | (default) | User locale |
| `NEXT_LOCALE` | `app.notion.com` | `/` | 1 year | No | Yes | (default) | Next.js locale |
| `p_sync_session` | `.notion.com` | `/` | 1 year | Yes | Yes | Lax | Push sync session token |
| `device_id` | `app.notion.com` | `/` | 1 year | Yes | Yes | (default) | UUID (sent in step 2 + set on `/f/refresh`) |
| `notion_browser_id` | `app.notion.com` | `/` | (long) | No | Yes | (default) | UUID |
| `notion_check_cookie_consent` | `app.notion.com` | `/` | (session) | No | Yes | (default) | Boolean flag |

`token_v2` is JWT-like: `v03:eyJhbGciOiJkaXIiLCJraWQiOiJwcm9kdWN0aW9uOnRva2VuLXYzOjIwMjQtMTEtMDciLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..<encrypted-payload>.<sig>` — do NOT decrypt, store verbatim.

### 1.2 Cookies Required for AI Chat Requests

Headers on `POST /api/v3/runInferenceTranscript` (verified from capture, 1738 bytes):

```
cookie: device_id=...; notion_browser_id=...; notion_check_cookie_consent=false;
        onetap_nonce=...; notion_user_id=...; notion_sync_user_id=...;
        NEXT_LOCALE=...; p_sync_session=...; _cioid=...;
        notion_locale=...; notion_users=["..."]; token_v2=v03:...
        + Cloudflare cookies (__cf_bm, _cfuvid)
```

**Minimum required (without Cloudflare, which is infra not auth):** 11 cookies listed above. **`file_token` NOT sent on AI requests** — only on `/f/*` file URLs.

### 1.3 Token Lifecycle

- Sessions last 1 year (most cookies)
- `notion_sync_user_id` expires in 90 days (this is the weakest link)
- **No refresh endpoint observed** — when cookies expire, user must re-run the 3-step login
- `notion_user_id` cookie expires 1 year; when it expires, Notion desktop triggers re-login automatically (via `app.notion.com/api/v3/authValidate` polling)
- Router strategy: store all 11 cookies encrypted at rest, re-validate via `authValidate` periodically (or on 401), trigger CLI re-login on auth failure

---

## 2. AI Chat Protocol

### 2.1 Endpoint

```
POST https://app.notion.com/api/v3/runInferenceTranscript
notion-client-version: 23.13.20260617.1538
accept: application/x-ndjson
content-type: application/json
cookie: <11 cookies from §1.2>
```

Response Content-Type: `application/x-ndjson`

### 2.2 Request Body — Single JSON with `transcript` Array

**Body is a single JSON object** (NOT NDJSON on request side):

```json
{
  "traceId": "<uuid>",
  "spaceId": "<workspace-uuid>",
  "transcript": [
    { "id": "<uuid>", "type": "config", "value": { "model": "ambrosia-tart-high", "modelFromUser": true, ... } },
    { "id": "<uuid>", "type": "agent-instruction-state", "owner": "regular", "root": {"type": "none"}, "sources": [], "selectedSkillPageIds": [], "trackedInstructionTreePages": [], "currentDatetime": "...", "surface": "ai_module" },
    { "id": "<uuid>", "type": "agent-turn-full-record-map", "value": { ... } },
    { "id": "<uuid>", "type": "attachment", "fileUrl": "attachment:<owner-uuid>:<file-uuid>.png", "fileName": "...", "contentType": "image/png", "metadata": { ... } },
    { "id": "<uuid>", "type": "agent-inference", "value": [{"type": "text", "content": "user prompt"}], "traceId": "<uuid>", "startedAt": 1781725646413, "previousAttemptValues": [] }
  ],
  "patches": []
}
```

**Top-level keys:**
- `traceId` — correlates with `agent-inference.traceId` in response
- `spaceId` — workspace UUID (must match account's `notion_space_id`)
- `transcript` — array of records describing the conversation state
- `patches` — (optional) JSON-Patch ops to apply to existing state

**Record types in `transcript`:**
- `config` — feature flags + model selection
- `agent-instruction-state` — root conversation metadata
- `agent-turn-full-record-map` — parent record for a turn
- `agent-inference` — model message (user prompt OR assistant response)
- `agent-tool-result` — tool call (input + result)
- `attachment` — image/file upload

### 2.3 Response Body — NDJSON Patch Stream

Response is NDJSON of `{type, data?, v?, version?, p?}` operations building up response state. Streaming text content is via `o: "x"` patches against content paths like `/s/<index>/value/0/content`.

Example response lines (from real capture):
```
{"type":"patch-start","data":{"s":[{"id":"<uuid>","type":"agent-instruction-state",...}]},"version":1}
{"type":"patch","v":[{"o":"a","p":"/s/-","v":{"id":"<uuid>","type":"agent-inference","value":[{"type":"text","content":"Halo, Attila!"}],"traceId":"<uuid>","startedAt":1781725646413}}]}
{"type":"patch","v":[{"o":"x","p":"/s/1/value/0/content","v":" 👋 Senang ngobrol sama kamu. ..."}]}
{"type":"done"}
```

### 2.4 Streaming Content Extraction Algorithm

The router must:

1. **Accumulate** all `agent-inference` records into a state object
2. **Track each `value[0].content` field** per record
3. **On each `o: "x"` patch against a content path**, diff old vs new value
4. **Emit `TextDelta { delta: <new_chars - old_chars>, ... }`** for each diff
5. **Final `{"type": "done"}` line** → emit `TextDelta { done: true }`

Use `fast-json-patch` library for patch application + state management.

### 2.5 Conversation Identity

A "conversation" = entire patch document. Root conversation UUID = `id` of the first `agent-turn-full-record-map` record. This is what the router stores as `conversation_routing.conversation_id`.

---

## 3. Models

From `POST /api/v3/getAvailableModels` (request body `{spaceId: "<workspace-uuid>"}`):

| Router Alias | Internal ID (`model`) | Display (`modelMessage`) | Family | Notes |
|---|---|---|---|---|
| `nt/notion-gpt-5.2` | `oatmeal-cookie` | GPT-5.2 | openai | |
| `nt/notion-gpt-5.4` | `oval-kumquat-medium` | GPT-5.4 | openai | |
| `nt/notion-gpt-5.5` | `opal-quince-medium` | GPT-5.5 | openai | |
| `nt/notion-gemini-2.5-flash` | `vertex-gemini-2.5-flash` | Gemini 2.5 Flash | gemini | |
| `nt/notion-gemini-3.5-flash` | `vertex-gemini-3.5-flash` | Gemini 3.5 Flash | gemini | |
| `nt/notion-sonnet-4.6` | `almond-croissant-low` | Sonnet 4.6 | anthropic | |
| (restricted) | `acai-budino` | Fable 5 | anthropic | Trial not allowed |

**Request to Notion uses the internal ID**, not the display name.

**Capabilities per model (from `modelCardAttributes`):** Notion rates speed/intelligence/cost on 1-5 scale, but does NOT expose max-tokens, vision support, or function-calling flags in this endpoint. Capability inference from observation only.

---

## 4. Tool Calls

**Confirmed working in capture.** Tool record schema:

```json
{
  "id": "<uuid>",
  "type": "agent-tool-result",
  "toolName": "callFunction",
  "toolType": "callFunction",
  "traceId": "<uuid>",          // links to agent-inference that triggered this tool
  "startedAt": 1781725627926,   // unix ms
  "finishedAt": 1781725627947,
  "durationMs": 21,
  "input": {
    "function": "connections.fs.readFiles",
    "args": {
      "files": ["modules/fs/AGENTS.md", ...]
    }
  },
  "state": "applied",
  "result": {
    "output": "<JSON-stringified result>",
    "headerLabel": [["Loaded tools"]]
  },
  "moduleInfo": {
    "id": "bc98da72-0be3-4971-881b-6a3c951e0103",
    "name": "fs-module",
    "type": "fs"
  },
  "renderedResultArtifactPointer": {
    "table": "workflow_artifact",
    "id": "<uuid>",
    "spaceId": "<workspace-uuid>"
  },
  "threadOperations": []
}
```

**Modular tools observed in capture:**

| Module | Function examples |
|---|---|
| `fs-module` | `connections.fs.readFiles` |
| `notion-module` | (Notion page operations — names TBD) |
| `web-module` | (web fetch / search — names TBD) |
| `mcpServer-module` | (MCP server — names TBD) |
| `search-module` | (search — names TBD) |
| `helpdocs-module` | (help docs — names TBD) |
| `system-module` | (system — names TBD) |

**Router strategy:** translate `agent-tool-result` records with `toolName: "callFunction"` → OpenAI `tool_calls` chunks. Map `moduleInfo.type` → tool name in OpenAI tools array. Function name format `<module>.<action>` → OpenAI function name.

---

## 5. File Upload (images, PDFs, any content) — CONFIRMED WORKING

Captured from session where user uploaded a PDF (38738 bytes, 1 page) and asked the model to read + summarize it. Model emitted a text-only response (no file write, no page create — just a normal `agent-inference` text record).

### 5.1 Upload Flow (3 steps)

#### Step 1: Request presigned URL
```
POST https://app.notion.com/api/v3/getUploadFileUrlForAssistantChatTranscriptUpload
{
  "name": "f3fe9f90-8443-432a-92f5-efd878fb7033.pdf",
  "contentType": "application/pdf",
  "assistantChatTranscriptSessionPointer": {
    "spaceId": "<workspace-uuid>",
    "table": "thread",
    "id": "<thread-uuid>"
  },
  "contentLength": 38738,
  "createThread": true
}
```

Response:
```json
{
  "url": "attachment:<owner-uuid>:<file-uuid>.pdf",
  "signedGetUrl": "https://file.notion.com/f/f/<spaceId>/<owner-uuid>/<file-uuid>.pdf?table=thread&id=<thread-uuid>&spaceId=<spaceId>&expirationTimestamp=<ms>&signature=<sig>",
  "signedUploadPostUrl": "https://prod-files-secure.s3.us-west-2.amazonaws.com/",
  "postHeaders": [],
  "fields": {
    "Content-Type": "application/pdf",
    "x-amz-storage-class": "INTELLIGENT_TIERING",
    "tagging": "<Tagging><TagSet><Tag><Key>source</Key><Value>AssistantUserUpload</Value></Tag><Tag><Key>env</Key><Value>production</Value></Tag><Tag><Key>creator</Key><Value>notion_user:<userId>:<spaceId>:</Value></Tag></TagSet></Tagging>",
    "bucket": "prod-files-secure",
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": "ASIA.../20260617/us-west-2/s3/aws4_request",
    "X-Amz-Date": "20260617T201927Z",
    "X-Amz-Security-Token": "<aws-sts-token>",
    "key": "f/<spaceId>/<owner-uuid>/<file-uuid>",
    "policy": "<base64-policy>",
    "X-Amz-Signature": "<hex-sig>"
  }
}
```

- `createThread: true` → creates a new chat thread
- `createThread: false` → uploads to existing thread (provide `id` of existing thread)
- `X-Amz-Security-Token` is short-lived STS credential (not the Notion cookie)
- `signature` on `signedGetUrl` expires at `expirationTimestamp`

#### Step 2: Upload to S3
```
POST https://prod-files-secure.s3.us-west-2.amazonaws.com/
Content-Type: multipart/form-data; boundary=...
Body: multipart with fields from step 1 + binary file as final part
```

Response: `204 No Content` on success.

The router must:
1. Build multipart body with all `fields` from step 1 + file as last `form-data` part
2. POST to `signedUploadPostUrl`
3. Handle 204 success / 4xx-5xx error

#### Step 3: Trigger attachment processing
```
POST https://app.notion.com/api/v3/enqueueTask
{
  "task": {
    "eventName": "processAgentAttachment",
    "request": {
      "url": "attachment:<owner-uuid>:<file-uuid>.pdf",
      "spaceId": "<workspace-uuid>",
      "aiSessionPointer": {
        "spaceId": "<workspace-uuid>",
        "table": "thread",
        "id": "<thread-uuid>"
      },
      "source": "user_upload",
      "clientVersion": "23.13.20260617.1538"
    }
  }
}
```

Response: `{"taskId": "<task-id>"}`

Poll for completion:
```
POST https://app.notion.com/api/v3/getTasks
{"taskIds": ["<task-id>"]}
```

Success response includes:
```json
{
  "state": "success",
  "status": {
    "result": {
      "type": "success",
      "data": {
        "fileSizeBytes": 38738,
        "contentType": "application/pdf",
        "numPages": 1,
        "aiTraceId": "<uuid>",
        "attachmentRisk": "scanned",
        "stepMetadata": {
          "numPages": 1,
          "guardrail": {"attachmentRisk": "scanned", "inferenceId": "<uuid>"},
          "fileSizeBytes": 38738,
          "aiTraceId": "<uuid>",
          "estimatedTokens": {"anthropic": 1743, "openai": -1}
        }
      }
    }
  }
}
```

### 5.2 Use Uploaded File in Chat

After upload + processing, the file can be referenced as an `attachment` record in `transcript[]`:

```json
{
  "id": "<uuid>",
  "type": "attachment",
  "fileUrl": "attachment:<owner-uuid>:<file-uuid>.pdf",
  "fileName": "<filename>",
  "contentType": "application/pdf",
  "metadata": {
    "numPages": 1,
    "moderation": {"status": "passed"},
    "guardrail": {"attachmentRisk": "scanned", "inferenceId": "<uuid>"},
    "fileSizeBytes": 38738,
    "aiTraceId": "<uuid>",
    "estimatedTokens": {"anthropic": 1743, "openai": -1}
  }
}
```

Note PDF attachment uses `numPages` instead of `width`/`height`. Image attachments use `width`/`height`. Router must inspect `contentType` to choose which metadata fields to set.

### 5.3 Multi-file Upload

For multiple files in one chat: upload each via the 3-step flow (each creates its own task + processing), then reference all as separate `attachment` records in `transcript[]`.

### 5.4 Implementation Notes

- `createThread: true` on first upload creates a new conversation; subsequent uploads within the same chat must use `createThread: false` + existing thread `id`
- The `X-Amz-Security-Token` is separate from the Notion `token_v2` cookie — it's an AWS STS token issued by Notion for this specific upload
- Presigned URLs expire (check `expirationTimestamp` field). If expired, re-do step 1.
- `attachmentRisk: "scanned"` means the file passed Notion's content moderation (vs `"skipped"` for files smaller than scan threshold or `"flagged"` for blocked content)
- **Tool calls observed in this capture:** `connections.fs.readFiles`, `connections.fs.readDir`, `connections.notion.listUserConnections`, `connections.notion.loadUser` (all read-only). No write/create tool calls captured here.

### 5.5 Write-to-Page (UNVERIFIED — needs separate capture)

User reports GPT 5.5 can write results to a Notion page (e.g., a "Save to Notion" button or automatic write of long responses). This capture did NOT include a write tool call. Likely candidates:

- A different `connections.notion.*` function (e.g., `connections.notion.createPage`, `connections.notion.appendBlocks`)
- An out-of-band endpoint call (e.g., `POST /api/v3/saveTransactions` with block patches)
- A separate agent tool result type (not `agent-tool-result`) such as `agent-page-write`

**Action required:** dispatch a fresh capture where the user asks the model to write/save the response to a Notion page. Then update this section with the actual endpoint + payload. Until captured, **router implementation should NOT include write-to-page** — leave that as a follow-up task.

---

## 6. Error Responses

Observed in capture:
- 200 success on all chat calls in this session
- `/api/v3/logout` returns 200 with cookie expiration headers (not an error)

Not observed but expected (based on API patterns):
- 401 → cookies expired, re-login required
- 403 → no permission for workspace/space
- 429 → rate limited (Notion enforces usage limits per `getAIUsageEligibility`)
- 500/502/503 → upstream error, retryable

`POST /api/v3/getAIUsageEligibility` returns:
```json
{"isEligible": true, ...}
```
If false → account cannot use AI features (subscription issue).

---

## 7. Endpoints Inventory

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/v3/getLoginOptions` | POST | none | Login step 1 |
| `/api/v3/sendTemporaryPassword` | POST | none | Login step 2 (triggers email) |
| `/api/v3/loginWithEmail` | POST | none | Login step 3 (returns userId + sets cookies) |
| `/api/v3/logout` | POST | cookies | Clear session |
| `/api/v3/authValidate` | POST | cookies | Check session validity |
| `/api/v3/getAvailableModels` | POST | cookies | Model catalog |
| `/api/v3/getAIUsageEligibility` | POST | cookies | AI subscription check |
| `/api/v3/runInferenceTranscript` | POST | cookies | Main AI chat (NDJSON) |
| `/api/v3/getInferenceTranscriptsForUser` | POST | cookies | List user's conversations |
| `/api/v3/markInferenceTranscriptSeen` | POST | cookies | Mark conversation read |
| `/api/v3/getUserSignals` | POST | cookies | Telemetry |
| `/f/refresh` | GET | cookies | Refresh device_id cookie |
| `https://identity.notion.com/authSync` | GET | (browser) | Identity bootstrap iframe |

---

## 8. Open RE Questions (remaining work)

1. **Image upload endpoint** — Notion has internal file upload (likely uses WebSocket or separate API not in this capture). For v1, only support pre-uploaded Notion fileUrls. (deferred)
2. **Tool call input format for non-`callFunction` tools** — partial answer via `fs-module.readFiles`, `notion-module.loadUser` in capture. Need to capture `web-module.search`, etc. for complete coverage. (deferred)
3. **Cookie expiration detection** — does router need to handle `authValidate` polling, or just react to 401? Partially answered: cookies last 1 year, no proactive refresh observed. (can use simple 401→re-auth approach)
4. **Does `runInferenceTranscript` accept multi-turn via the patch document, or must router send fresh document each turn?** Capture evidence: each request contains full `transcript` array (no server-side conversation memory). Fresh document each turn.
5. **New internal model ID `ambrosia-tart-high`** observed in latest capture — NOT in `getAvailableModels` response. Possibly a test/A-B model. Router should ignore unknown model IDs in `config.value.model` and just pass through.