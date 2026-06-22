# Debug a Failed Request

Trace a request from client to proxy to upstream to response, find the failing stage, fix it. This is a ladder. Walk it top to bottom and stop at the first clue.

## Goal

Identify *where* a request failed (auth, account selection, upstream, format conversion, response stream) and *why* (the upstream error code, an account state, a config issue).

## Prerequisites

- Read [`ARCHITECTURE.md`](../../ARCHITECTURE.md): request pipeline + state machines
- Read [`../reference/error-codes.md`](../reference/error-codes.md): what the backoff/lock decisions mean
- Know how to query the DB: `sqlite3 ~/.local/share/kelola-router/router.db` (or use the dashboard's Request Detail page)

## Diagnostic ladder

Walk these in order. Stop at the first clue that points to a fix.

### Step 1: Confirm the request was logged

```sql
SELECT id, model, status_code, error, created_at
FROM request_logs
ORDER BY created_at DESC LIMIT 5;
```

If no row exists: the request never reached the proxy. Check client auth:
- `Authorization: Bearer <key>` header present?
- `client_keys` row exists with `enabled = 1`?
- Run: `SELECT id, label, enabled FROM client_keys WHERE key = '<bearer>';`

### Step 2: Look at the Console page

Open the dashboard `Console` page (`#/admin/console`). The failed request should be a colored block with:
- `reqid` (4-byte hex): match this to `request_logs.req_id` for cross-linking
- `account`: which account was selected
- `transport`: which relay/proxy/direct path
- `done` line with status + latency
- `error` line (if applicable) with the upstream body

If you see `error` but no `done`, the request errored before the response streamed.

If you see a `transport-fail` line, the proxy/relay was unreachable. See `docs/adr/0003-…` (or the proxy-failure console design spec) for `proxyFailureMode` semantics.

### Step 3: Check the account state

For 429 / 5xx: was the selected account healthy?

```sql
SELECT id, label, status, backoff_level, rate_limited_until, last_error
FROM accounts
ORDER BY backoff_level DESC;
```

- `status = 'error'` → 401 upstream, account is disabled
- `rate_limited_until > now` → account in backoff
- `backoff_level > 0` → exponential backoff active

Look at `last_error` (JSON):
```sql
SELECT json_extract(last_error, '$.status') AS status,
       json_extract(last_error, '$.baseRespCode') AS code,
       json_extract(last_error, '$.message') AS msg,
       json_extract(last_error, '$.timestamp') AS ts
FROM accounts
WHERE id = '<account_id>';
```

Match the `baseRespCode` to [`../reference/error-codes.md`](../reference/error-codes.md) to see what the router will do next.

### Step 4: Check the model lock

For 429 with `error: 'model_locked'`:

```sql
SELECT * FROM account_model_locks
WHERE account_id = '<id>' AND model = '<name>';
```

Lock expires automatically at `locked_until`. To clear manually (force-unlock):
- Dashboard: Accounts page → "Locks" column → "Clear"
- API: `DELETE /api/admin/accounts/<id>/locks/<model>`
- SQL: `DELETE FROM account_model_locks WHERE account_id = ? AND model = ?;`

### Step 5: Inspect the request/response bodies

For format-conversion or upstream-parsing issues:

```sql
SELECT id, model, endpoint, format, request_body, response_body, error
FROM request_logs
WHERE id = <row_id>;
```

Both bodies are stored as JSON TEXT. Common patterns:
- `response_body` is `{"error": {"base_resp": {"status_code": 1002, "status_msg": "rate limit exceeded"}}}` → upstream rate limit
- `response_body` is a streaming event that wasn't reassembled → check `format = 'openai'` vs `'anthropic'` match
- `request_body` shows a tool message that wasn't converted → check `upstreamFormat` setting

### Step 6: Trace the model resolution

If the request was routed to the wrong model:

```sql
SELECT * FROM model_aliases WHERE alias_name = '<client_sent_model>';
SELECT * FROM models WHERE name = '<resolved_model>' OR upstream_model = '<resolved_model>';
```

Check:
- Is there an alias overriding the model?
- Is the model `enabled = 0`?
- Is the `provider` column matching the account you expected?

### Step 7: Check combo / fallback chain

If the request used a combo name:

```sql
SELECT * FROM combos WHERE name = '<combo_name>';
```

The proxy iterates `combos.models` in order. If the first model is locked/errored, the next is tried. Look at the console for multiple `account` lines per `reqid`.

### Step 8: Live tail

For ongoing issues, tail the flow stream from the terminal:

```bash
# Server stdout (gated by CONSOLE_FLOW=0)
npm run dev:server | grep -E 'req_'
```

Or the dashboard Console page in another tab.

## Common failure modes

| Symptom | First check | Likely fix |
|---|---|---|
| 401 from router | Client bearer | Re-issue client key; check `enabled` |
| 503 with `reason=mode` | All accounts backoff/locked | Wait for cooldown or clear locks |
| 429 with `model_locked` | `account_model_locks` row | Clear the lock or wait |
| `base_resp.status_code = 1008` | `accounts.status` | Add balance or new account |
| `base_resp.status_code = 1039` | `account_model_locks` | Reduce context, retry |
| Stream hangs, no `done` line | Console / network | Check upstream timeout (`REQUEST_LOG_RETENTION_DAYS` is unrelated; this is a request still in flight) |
| All accounts return 401 | API key invalid/expired | Re-add account with new key |
| Format mismatch (OpenAI client ↔ Anthropic upstream) | `settings.minimax.upstreamFormat` | Set to `'openai'` or `'anthropic'` explicitly |
| Kiro: device-code flow loops | `accounts.access_token` stale | Delete + re-add account |

## Test

```bash
# Quick smoke test from the CLI
curl -X POST http://localhost:20137/v1/chat/completions \
  -H "Authorization: Bearer $ROUTER_CLIENT_KEY" \
  -H "content-type: application/json" \
  -d '{"model": "minimax/MiniMax-M3", "messages": [{"role": "user", "content": "hi"}]}'
```

Expected: 200 with `chat.completion` JSON (or 5xx with structured error body; match the status to the table above).

## Commit

This guide is read-only. No code changes. If you discover a new failure mode worth documenting, send a follow-up PR adding it to the **Common failure modes** table.

## See also

- [`../reference/error-codes.md`](../reference/error-codes.md): backoff/lock semantics
- [`../reference/db-tables.md`](../reference/db-tables.md): `request_logs`, `account_model_locks`, `accounts` schemas
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md): request pipeline + state machines
- [`../../AGENTS.md`](../../AGENTS.md): proxy pipeline overview + conventions
- [`../adr/`](../adr/): past debug investigations
