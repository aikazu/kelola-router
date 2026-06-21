# Human-Readable Request/Response Body in Usage

**Date:** 2026-06-21
**Status:** Design (awaiting implementation plan)
**Scope:** `client/src/pages/RequestDetail.tsx` + new `client/src/lib/decodeBody.ts`

## Goal

Make `request_body` / `response_body` / headers stored in `request_logs` human-readable when viewed from the dashboard Usage page's request detail modal. Decode is channel-specific: Anthropic SSE is split into events and reconstructed into final text; OpenAI-shaped completions are unpacked; request bodies render as a chat timeline with auto-collapsed large blocks.

## Context (verified against live DB `data/router.db`)

- 973 rows, all `format='anthropic'`, `endpoint='/v1/messages'`.
- `request_body` / `response_body` are TEXT, truncated at 100 KB by `src/proxy/capture.ts:12` (Notion SSE at 256 KB rolling, `src/proxy/notion.ts:296`).
- Non-stream success responses are OpenAI `chat.completion` shape (`choices[0].message.content` + `reasoning_content`) — relay converts format, so `format` column reflects the request protocol, NOT the response shape.
- Stream success responses are Anthropic SSE (`event: message_start`, `content_block_delta`, `message_delta`, `message_stop`).
- Error responses are plain text (`fetch failed`) or short error objects.
- `request_headers` / `response_headers` are JSON objects (`{"content-type":"application/json"}`). Coverage sparse (1/973 rows), but present.
- `error_message` and `error` columns exist (both null on the sampled success row).
- Current display: `client/src/pages/Usage.tsx:474` table; `client/src/pages/RequestDetail.tsx:45` `JsonView` does naive `JSON.parse` → 2-indent, raw fallback. No channel-specific decoding.

## Non-Goals

- No new server endpoint. No DB schema change. No change to capture logic.
- No change to the Usage list table (no inline summary column — deferred to a future phase).
- No new `/logs` page (out of scope).
- No syntax-highlighting library (pure text in `<pre>`).

## Architecture

Decoder is a set of pure functions in a new file `client/src/lib/decodeBody.ts`. The modal (`RequestDetail.tsx`) renders the decoded structure. Three layers, strictly separated:

```
DB body string + row metadata (format, endpoint, stream, status_code, content-type header)
  → detectFormat(body, meta)        → DecodedFormat
  → decodeRequestBody(body)        → RequestView
  → decodeResponseBody(body, meta) → ResponseView
  → RequestDetail.tsx renders DecodedBody → DOM (try/catch → Raw fallback)
```

All decode logic is client-side pure functions. No server code. No capture/DB change.

## Components

### `client/src/lib/decodeBody.ts` (new, pure functions)

- `detectFormat(body, meta): DecodedFormat`
  - Sniff fields: `choices[]` → `openai-completion`; `content[]` + `stop_reason` → `anthropic-message`; lines starting with `event:` → `anthropic-sse`; JSON with `error` key → `error`; else `plain-text`.
  - Hint from `meta.contentType` (`application/json` vs `text/event-stream`) and `meta.stream` to disambiguate.
- `decodeRequestBody(body): RequestView`
  - `JSON.parse` body. On failure → throws (caught by renderer → Raw fallback).
  - Returns `{ system?, tools?, messages: MessageCard[], summary: RequestSummary }`.
- `decodeResponseBody(body, meta): ResponseView`
  - Dispatches on detected format. Returns one of: `{ kind: 'nonstream', contentBlocks, finishReason, usage }` | `{ kind: 'sse', events: SseEvent[], reconstructed: ReconstructedText[], complete: boolean }` | `{ kind: 'error', type?, message, requestId? }` | `{ kind: 'plain', text }`.
- Types (discriminated unions, `strict: true`, no `any`): `DecodedFormat`, `RequestView`, `ResponseView`, `MessageCard`, `ContentBlock`, `SseEvent`, `ReconstructedText`, `RequestSummary`.

### `client/src/pages/RequestDetail.tsx` (edit existing; replace `JsonView`)

- Top-level tabs: **Request** | **Response** | **Headers**.
- **Request tab**: renders `RequestView` as a chat timeline.
  - `system` → collapsible block at top.
  - `tools[]` → collapsible; each tool shows `name` + `input_schema` pretty.
  - `messages[]` → `<MessageCard>` list (role badge + content blocks).
  - Summary strip: `N messages`, `M tools`, `has system`, `stream: yes/no`.
  - If `JSON.parse` fails: inline message "Unparseable request body, see Raw" + Raw sub-section below.
- **Response tab**: sub-tabs conditional on decoded format:
  - non-stream → `Content` | `Raw`.
  - SSE → `Reconstructed` | `Events` | `Raw`.
  - error → `Error` | `Raw`.
  - plain → `Raw` only.
- **Headers tab**: `JSON.parse` each header set → key-value table. Fallback to raw text on parse failure.
- New small components (each ≤40 lines, single responsibility): `<MessageCard>`, `<ContentBlockView>`, `<SseEventRow>`, `<CollapsibleText>`, `<HeadersTable>`.

## Decode Logic

### Request body

- `messages[]` → `MessageCard{role, blocks[]}` array.
- Message content handling:
  - String content → one `CollapsibleText` block.
  - Array content → map per block `type`:
    - `text` → `CollapsibleText` (auto-collapse >2 KB; "show more" toggle).
    - `image` (base64) → placeholder `[image, {media_type}, {N} bytes]`; never render binary.
    - `tool_use` → `name` + input JSON pretty-printed.
    - `tool_result` → `content` summary + `is_error` flag.
- `system` → string or array of text blocks, collapsible.
- `tools[]` → collapsible; per tool `name` + `input_schema`.
- `RequestSummary`: `{ messageCount, toolCount, hasSystem, stream }`.

### Response body

- `openai-completion`: `choices[0].message.content` + `reasoning_content` (if present) as text blocks; `finish_reason`; `usage`.
- `anthropic-message`: `content[]` blocks per content type (text / tool_use).
- `anthropic-sse`:
  - Parse by splitting on `\n\n`. Each event → `{event, data}`.
  - `message_start` → model + initial `usage`.
  - `content_block_start` / `content_block_delta` / `content_block_stop` → track per `index`: type + accumulated delta text.
  - `message_delta` → `stop_reason` + final `usage`.
  - `message_stop` → completion marker.
  - `ping` / `error` → render as-is.
  - Reconstruct: concatenate `content_block_delta.text` per block `index` → final text per block → `ReconstructedText[]`.
- `error`: show `error.type` / `error.message` / `request_id` if present.
- `plain-text`: render verbatim.

### Headers

- `JSON.parse` → key-value table (sorted).
- Mask sensitive values (see Security).

## Error Handling & Edge Cases

- Body `null`/empty → modal shows "No body captured" per tab; no crash.
- `JSON.parse` failure on request → Request tab shows inline message + Raw sub-section.
- `JSON.parse` failure on response → Response tab shows `Raw` only.
- Truncation suffix (`...truncated...` from capture) → detect suffix, show badge "truncated — full body not captured" above the tab. SSE reconstruction proceeds from available events.
- Incomplete SSE (stream cut before `message_stop`) → reconstructed text shown with badge "incomplete stream"; `complete: false` in `ResponseView`.
- Unknown format → `plain-text` fallback, Raw tab.
- Any decode throw → renderer `try/catch` → Raw tab. Modal never blank.
- Large body (≤100 KB) → text blocks auto-collapse; only expand on click. Prevents modal freeze.

## Security

Header values masked in the Headers tab (show prefix + `****`):
- `authorization`
- `x-api-key`
- `proxy-authorization`
- `cookie`
- `set-cookie`

Request/response bodies are NOT masked (they are the point of the feature), but they are already admin-gated (modal is under `/api/admin/*` auth + CSRF per project skill `add-admin-endpoint` / `add-dashboard-page`).

## Testing (TDD, vitest)

`client/src/lib/decodeBody.test.ts`:
- `detectFormat`: one test per branch (`openai-completion`, `anthropic-message`, `anthropic-sse`, `error`, `plain-text`) + ambiguous edge cases (e.g. SSE with `error` event).
- `decodeRequestBody`: string content; array content (text/image/tool_use/tool_result); `system` as array; `tools[]`; auto-collapse threshold boundary.
- `decodeResponseBody`:
  - non-stream OpenAI (`choices[0].message.content` + `reasoning_content`).
  - non-stream Anthropic (`content[]`).
  - SSE multi-event → events list correct AND reconstructed final text == concatenated deltas.
  - SSE partial (cut before `message_stop`) → `complete: false`, badge.
  - error object + plain `fetch failed`.
  - truncated suffix → badge.
- Fixtures from real DB rows (id=927 non-stream, id=973 stream, id=826 error) committed as test data.
- `RequestDetail.tsx`: render test per tab (Preact Testing Library) — correct tab shown, Raw fallback when decode throws.

## Open Questions

None. All clarifications resolved:
- Decode location: client-side (A).
- Response depth: Reconstructed + Events + Raw sub-tabs (C).
- Format detection: field-sniffing with content-type hint, plain fallback (C).
- Request presentation: chat timeline + auto-collapse large blocks (C).
- Display location: RequestDetail modal only (A).
