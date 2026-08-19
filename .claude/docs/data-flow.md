# Data Flow per Request

> Annotated trace of one request from HTTP-in to HTTP-out. For the visual diagram see `ARCHITECTURE.md` "Data flow per request" section. For the debug ladder see `docs/guides/debug-a-failed-request.md`.

## Why this exists

When a refactor touches the proxy pipeline, the agent needs to know the exact sequence + what each step emits. This doc is the step-by-step commentary on `handleProxy` (MiniMax path) with line refs.

## 0. Before `handleProxy`: middleware

- `csrfGuard` (admin only). Blocks cross-origin POSTs.
- `requireApiKey` (proxy). Checks `Authorization: Bearer <key>` against `client_keys.key`.
- `requireAdmin` (admin). Session cookie OR `x-admin-key` OR open mode.

## 1. `parseBody` + model resolution

`handleProxy(c, format, upstreamPath)` first line: `await c.req.json()` (or `parseBody()` for stream). The body is then passed to `resolveModel` in `src/providers/alias.ts`.

What `resolveModel` does:
- Lookup `model_aliases.alias_name` → `upstream_model`
- Strip `-thinking` / `-agentic` / `-thinking-agentic` suffix for kiro routing
- Return the resolved model + the original alias (stored as `requested_model` in logs)

## 2. `genReqId()`: 4-byte hex

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

## 7. `augmentRequest(body)`: caveman + cache_control

`src/proxy/augment.ts`:
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

`src/transport/resolve.ts` returns a `TransportConfig` based on account's `relay_id` / `proxy_id` / `proxy_pool`, or the global `settings.transport` fallback, or `null` for direct.

`consoleBus.emit('transport', { reqId, kind: 'relay' | 'proxy' | 'direct', label: <url> })` (only when transport is non-null).

## 10. `upstream-fetch(url, body, headers, transport)`

`src/providers/upstream-fetch.ts`:
- Builds the URL from the account's `base_url` + `upstreamPath`
- Headers: provider + format-specific (see `src/providers/headers.ts`)
- If `transport` is set, uses `proxyAwareFetch`. Otherwise global `fetch`.
- Returns a `Response` (streaming or buffered)

`consoleBus.emit('transport-fail', { reqId, message })` if the transport errors. Then fallback behavior per `proxyFailureMode`.

## 11. SSE pipe OR buffered response

If `body.stream`:
- `pipe-with-usage(stream, c)` reads the stream, forwards to the client, and extracts usage
- `extract-usage` parses the last chunk for `usage` info (OpenAI streaming) or `message_delta` (Anthropic)
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

`src/db/repos/request-logs.ts:insertRequestLogDeferred` (deferred for buffered) or `insertRequestLog` (immediate for streaming). The row has 29 columns including `request_body`, `response_body`, `request_headers`, `response_headers` (bodies are stored for debugging; see `INSERT_REQUEST_LOG_BODY_RETENTION_DAYS` in scheduler).

## 15. `applyAccountError` (on failure)

If the upstream call threw or returned a 4xx/5xx:
- `checkFallbackError(status, body, baseRespCode, backoffLevel, ...)` returns a `FallbackDecision`
- `applyAccountError` mutates the account state in the DB
- `consoleBus.emit('error', { reqId, status, body })`. Body is truncated to 200 chars.
- For Kiro: a different error class (refresh token, persona mismatch) is handled inline in `src/proxy/kiro.ts`

The proxy still returns an HTTP response. The error is logged, not thrown.

## 16. Kiro-specific path

`handleKiroProxy` is structurally similar but uses `executeKiro` instead of `upstream-fetch`. The Kiro path:
- Builds the payload via `buildKiroPayload` (CodeWhisperer `conversationState` shape)
- `executeKiro` calls `ensureAccessToken` (refresh if needed)
- Decodes the AWS event-stream binary frames
- Re-emits as OpenAI SSE (`assembler.ts`) or Anthropic SSE (`anthropic-sse.ts`)
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
- **Bodies in `request_logs` are full.** They can be megabytes for long conversations. The retention is `REQUEST_LOG_RETENTION_DAYS` (default 30) via the scheduler.

## Cross-refs

- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md): visual flow + state machines
- [`state-machines.md`](state-machines.md): selection / backoff / lock
- [`format-conversion.md`](format-conversion.md): body transform rules
- [`../../docs/reference/db-tables.md`](../../docs/reference/db-tables.md): `request_logs` schema
- [`../../docs/guides/debug-a-failed-request.md`](../../docs/guides/debug-a-failed-request.md): debug ladder
- `src/console/types.ts`: FlowEvent union
