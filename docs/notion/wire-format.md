# Notion Provider: Wire Format

> Source of truth for the Notion AI chat HTTP wire format used by `src/providers/notion/`.
> Reverse-engineered from real `app.notion.com` traffic via mitmproxy against Notion desktop
> client v23.13.20260617.1538. Capture artifacts: `docs/notion/capture.har` + `capture.flow`.

Last verified: 2026-06-18 against the captures in this directory.

---

## Why this exists

Notion's AI chat is **not** a chat-completion API. The upstream endpoint `runInferenceTranscript`
exchanges CRDT-style records (config, instructions, turn maps, inferences, tool results,
attachments) over:

- **Request**: a single JSON object with a `transcript` array of records
- **Response**: NDJSON stream of `{type: "patch-start" | "patch" | "patch-end" | "done"}` ops
  that incrementally build up the response state

The router's job: translate OpenAI/Anthropic chat-completion requests into this transcript
format on ingress, apply the response patches on egress, and emit OpenAI streaming chunks.

**Accuracy matters**: this is an undocumented internal API. Fingerprinting fidelity determines
whether Notion flags the account as third-party. Mirror the exact field names and header
values captured here.

---

## Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `https://app.notion.com/api/v3/getLoginOptions` | POST | none | Login step 1 |
| `https://app.notion.com/api/v3/sendTemporaryPassword` | POST | none | Login step 2 (triggers email) |
| `https://app.notion.com/api/v3/loginWithEmail` | POST | none | Login step 3 (returns userId + sets cookies) |
| `https://app.notion.com/api/v3/authValidate` | POST | cookies | Check session validity |
| `https://app.notion.com/api/v3/getAvailableModels` | POST | cookies | Model catalog |
| `https://app.notion.com/api/v3/getAIUsageEligibility` | POST | cookies | AI subscription check |
| `https://app.notion.com/api/v3/runInferenceTranscript` | POST | cookies | Main AI chat (request: JSON, response: NDJSON) |
| `https://app.notion.com/api/v3/getInferenceTranscriptsForUser` | POST | cookies | List user's conversations |
| `https://app.notion.com/api/v3/markInferenceTranscriptSeen` | POST | cookies | Mark conversation read |

---

## Headers

### AI Chat Request Headers (verified from capture)

```
POST /api/v3/runInferenceTranscript HTTP/1.1
Host: app.notion.com
notion-client-version: 23.13.20260617.1538      # pin exactly — fingerprint signal
accept: application/x-ndjson
content-type: application/json
cookie: device_id=<uuid>;
        notion_browser_id=<uuid>;
        notion_check_cookie_consent=false;
        notion_user_id=<uuid>;
        notion_sync_user_id=<urlencoded-json>;
        NEXT_LOCALE=<locale>;
        p_sync_session=<urlencoded-json>;
        _cioid=<user-uuid>;
        notion_locale=<locale>;
        notion_users=<urlencoded-json-array>;
        token_v2=v03:<encrypted-jwt>;
        + Cloudflare (__cf_bm, _cfuvid)
content-length: <bytes>
```

**No `Authorization` header.** All auth is via the `token_v2` cookie.

### Login Headers

```
notion-client-version: 23.13.20260617.1538
content-type: application/json
```

No cookies needed for the 3 login steps.

---

## Login Flow

### Step 1: `getLoginOptions`

```
POST https://app.notion.com/api/v3/getLoginOptions
{"email":"attila@kcmon.id","requireWorkTypeEmail":false}
```

Response:
```json
{
  "hasAccount": true,
  "samlSignIn": "unavailable",
  "passwordSignIn": false,
  "mustReverify": false,
  "loginOptionsToken": "v02:login_options:<base64>"
}
```

### Step 2: `sendTemporaryPassword`

Sends a 6-character alphanumeric password to the user's email.

```
POST https://app.notion.com/api/v3/sendTemporaryPassword
{
  "email": "attila@kcmon.id",
  "disableLoginLink": false,
  "native": true,
  "isSignup": false,
  "shouldHidePasscode": false,
  "loginOptionsToken": "v02:login_options:<base64>",
  "deviceId": "<uuid>",
  "loginRouteOrigin": "login"
}
```

Response:
```json
{"csrfState": "v02:temp_password:<base64>"}
```

### Step 3: `loginWithEmail`

```
POST https://app.notion.com/api/v3/loginWithEmail
{
  "state": "v02:temp_password:<base64>",
  "password": "<6-char-from-email>",
  "appSource": "notion",
  "loginRouteOrigin": "login"
}
```

Response body: `{"isNewSignup": false, "userId": "<uuid>"}`

**Response Set-Cookie headers** (all required for subsequent requests):

| Cookie | Domain | Path | Expires | Notes |
|---|---|---|---|---|
| `token_v2` | `app.notion.com` | `/` | 1 year | Primary auth (encrypted JWT) |
| `file_token` | `.notion.com` | `/f` | 1 year | Only needed for `/f/*` URLs |
| `notion_user_id` | `app.notion.com` | `/` | 1 year | Current user UUID |
| `notion_users` | `app.notion.com` | `/` | 1 year | JSON array of user UUIDs |
| `notion_sync_user_id` | `.notion.com` | `/` | 90 days | Sync state (weakest link) |
| `notion_locale` | `app.notion.com` | `/` | 1 year | User locale |
| `NEXT_LOCALE` | `app.notion.com` | `/` | 1 year | Next.js locale |
| `p_sync_session` | `.notion.com` | `/` | 1 year | Push sync session |

Plus cookies generated by the device: `device_id`, `notion_browser_id`, `notion_check_cookie_consent`, `_cioid`.

---

## Request Body: `runInferenceTranscript`

Single JSON object:

```json
{
  "traceId": "<uuid>",
  "spaceId": "<workspace-uuid>",
  "transcript": [
    {
      "id": "<uuid>",
      "type": "config",
      "value": {
        "type": "workflow",
        "model": "<internal-id>",
        "modelFromUser": true,
        "enableAgentAutomations": true,
        "enableAgentIntegrations": true,
        "enableCustomAgents": true,
        "enableExperimentalIntegrations": false,
        "enableAgentDiffs": true,
        "enableCsvAttachmentSupport": true,
        "enableAgentGenerateImage": true,
        "useWebSearch": true,
        "isHipaa": false,
        "internetAccess": false,
        "writerMode": false,
        "availableConnectors": [],
        "searchScopes": [{"type": "everything"}]
      }
    },
    {
      "id": "<uuid>",
      "type": "agent-instruction-state",
      "owner": "regular",
      "root": {"type": "none"},
      "sources": [],
      "selectedSkillPageIds": [],
      "trackedInstructionTreePages": [],
      "currentDatetime": "2026-06-18T03:13:12.344+07:00",
      "surface": "ai_module"
    },
    {
      "id": "<uuid>",
      "type": "agent-turn-full-record-map",
      "value": {}
    },
    {
      "id": "<uuid>",
      "type": "attachment",
      "fileUrl": "attachment:<owner-uuid>:<file-uuid>.png",
      "fileName": "Screenshot 2026-06-03 141122.png",
      "contentType": "image/png",
      "metadata": {
        "width": 2999,
        "height": 1546,
        "moderation": {"status": "passed"},
        "guardrail": {"attachmentRisk": "skipped", "inferenceId": "<uuid>"},
        "fileSizeBytes": 167683,
        "aiTraceId": "<uuid>"
      }
    },
    {
      "id": "<uuid>",
      "type": "agent-inference",
      "value": [{"type": "text", "content": "user prompt here"}],
      "traceId": "<uuid>",
      "startedAt": 1781725646413,
      "previousAttemptValues": []
    }
  ],
  "patches": []
}
```

### Record Types

| Type | Purpose |
|---|---|
| `config` | Feature flags + model selection for this turn. Router must populate `value.model` with the resolved internal model ID. |
| `agent-instruction-state` | Root conversation metadata. One per request. |
| `agent-turn-full-record-map` | Parent record for the user turn. One per request. |
| `agent-inference` | A model message (user prompt OR assistant response). `value` is `[{type: "text", content: "..."}]`. |
| `agent-tool-result` | A tool call (see Tool Calls section below). |
| `attachment` | Image/file attached to the conversation. See Image Input section below. |

### Model IDs

From `POST /api/v3/getAvailableModels`:

| Internal ID | Display | Family |
|---|---|---|
| `oatmeal-cookie` | GPT-5.2 | openai |
| `oval-kumquat-medium` | GPT-5.4 | openai |
| `opal-quince-medium` | GPT-5.5 | openai |
| `vertex-gemini-2.5-flash` | Gemini 2.5 Flash | gemini |
| `vertex-gemini-3.5-flash` | Gemini 3.5 Flash | gemini |
| `almond-croissant-low` | Sonnet 4.6 | anthropic |
| `acai-budino` | Fable 5 | anthropic (restricted) |

New internal IDs may appear over time (e.g., `ambrosia-tart-high` observed in latest capture, not in `getAvailableModels`). Router should pass through any model ID in `config.value.model` without validation; let Notion reject if unsupported.

---

## Response Body: NDJSON Stream

Each line is a JSON object with one of these types:

```jsonc
// Initial state setup
{"type":"patch-start","data":{"s":[<initial-records>]}, "version":1}

// Add a record to the s array
{"type":"patch","v":[{"o":"a","p":"/s/-","v":{"id":"<uuid>","type":"agent-inference","value":[{"type":"text","content":"..."}],"traceId":"<uuid>","startedAt":<ms>}}]}

// Update a value in place (text streaming)
{"type":"patch","v":[{"o":"x","p":"/s/1/value/0/content","v":"appended text"}]}

// End of patches
{"type":"patch-end"}

// Stream complete
{"type":"done"}
```

**Patch op codes:**
- `o: "a"`: append to array at path `p`
- `o: "x"`: patch value at path `p` with `v` (used for text deltas)
- `o: "r"`: replace (rare)

### Text Extraction Algorithm

1. Apply each `patch-start` to initialize local state (object with `s: []` array)
2. Apply each `patch` op to the local state (use `fast-json-patch`)
3. Track each `agent-inference` record's `value[0].content` field
4. When a patch updates an `agent-inference.value[0].content` path, diff old vs new value
5. Emit `TextDelta { delta: <new_chars> }` for each diff
6. Final `{"type": "done"}` → emit `TextDelta { done: true }`

---

## Tool Calls

Tool calls appear as `agent-tool-result` records in the response stream:

```json
{
  "id": "<uuid>",
  "type": "agent-tool-result",
  "toolName": "callFunction",
  "toolType": "callFunction",
  "traceId": "<uuid>",
  "startedAt": 1781725627926,
  "finishedAt": 1781725627947,
  "durationMs": 21,
  "input": {
    "function": "connections.fs.readFiles",
    "args": {"files": ["modules/fs/AGENTS.md", "..."]}
  },
  "state": "applied",
  "result": {
    "output": "{\"files\":[{\"path\":\"...\"}]}",
    "headerLabel": [["Loaded tools"]]
  },
  "moduleInfo": {
    "id": "<uuid>",
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

**Modular tools observed:**

| Module | Function examples |
|---|---|
| `fs-module` | `connections.fs.readFiles` |
| `notion-module` | `connections.notion.loadUser` |
| `web-module` | (TBD) |
| `mcpServer-module` | (TBD) |
| `search-module` | (TBD) |
| `helpdocs-module` | (TBD) |
| `system-module` | (TBD) |

**OpenAI mapping:**
- `moduleInfo.type` → OpenAI tool name (e.g., `fs` → `notion_fs`)
- `input.function` → OpenAI function name (strip `connections.` prefix)
- `input.args` → OpenAI function arguments (JSON)
- `result.output` → OpenAI tool call result content

---

## Image Input

**For v1, router only supports pre-uploaded Notion file URLs.** Image upload endpoint not captured (likely uses a separate protocol outside mitmproxy scope).

When client provides OpenAI message with `content[].type: "image_url"` and the URL is already a Notion `attachment:` URL, router passes it through as an `attachment` record:

```json
{
  "id": "<uuid>",
  "type": "attachment",
  "fileUrl": "attachment:<owner-uuid>:<file-uuid>.<ext>",
  "fileName": "<filename>",
  "contentType": "image/png",
  "metadata": {
    "width": <pixels>,
    "height": <pixels>,
    "moderation": {"status": "passed"},
    "guardrail": {"attachmentRisk": "skipped", "inferenceId": "<uuid>"},
    "fileSizeBytes": <bytes>,
    "aiTraceId": "<uuid>"
  }
}
```

**For HTTPS image URLs / base64 data URLs:** router should error with a clear message that v1 only supports Notion-hosted files. Future work: implement reverse-engineered upload endpoint.

---

## Error Responses

| Status | Meaning | Router action |
|---|---|---|
| 200 | Success | Continue |
| 401 | Cookies expired | Disable account, emit `notion_reauth_required` |
| 403 | No permission for workspace | Disable account |
| 404 | Unknown record/conversation | Return 404 to client, suggest new conversation |
| 429 | Rate limited | Backoff 60s, failover if other accounts available |
| 500/502/503 | Upstream error | Exp backoff 1s→2s→4s, max 3 attempts, failover |

`getAIUsageEligibility` returning `isEligible: false` → reject account at add time.

---

## Things that are ASSUMED / not fully verified

1. **Cookie expiration detection.** No proactive refresh observed. Cookies last ~1 year (most), 90d (`notion_sync_user_id`). Router uses simple "401 → re-auth" approach.
2. **Multi-turn server-side state.** Each request contains full `transcript`. No evidence of server-side conversation persistence. Treat each request as stateless from router's view.
3. **Image upload endpoint.** Not captured in mitmproxy. For v1, only support pre-uploaded Notion file URLs.
4. **Tool call surface for non-`callFunction` modules.** `web-module`, `search-module`, etc. not exercised in captures. Router should handle unknown modules gracefully (log + pass-through).
5. **`previousAttemptValues` field semantics.** Observed on `agent-inference` records. Appears to be retry context. Router should leave empty.
6. **`config.value` flags.** ~30 feature flags observed. Router should set conservative defaults (enableAgentGenerateImage: true if model supports, useWebSearch: true, internetAccess: false).

---

## When something breaks

1. Check `notion-client-version`. It must match `23.13.20260617.1538` exactly (or whatever latest capture shows).
2. Check cookies. `token_v2` expired? Re-run `notion-add-account` CLI.
3. Check `spaceId`. Account may have lost workspace access.
4. Compare against `capture.har`. If Notion changed field names, capture again with latest desktop version.
5. Re-run `python docs/notion/parse_capture.py` to refresh `capture-notes.md`

---

## See also

- `docs/notion/capture-notes.md`: RE findings + open questions
- `docs/notion/capture.har`: raw captured traffic
- `docs/notes/kiro-cli-reverse-engineering.md`: same pattern, Kiro example