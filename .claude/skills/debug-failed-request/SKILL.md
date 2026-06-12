---
name: debug-failed-request
description: Trace a failed proxy request through account selection, transport, upstream, and error rules. Diagnostic ladder with concrete SQL queries.
when-to-use: When a user reports a failed / 4xx / 5xx proxy request, account backoff, model lock, or "nothing works since X" symptom.
---

# Debug a Failed Request

Full playbook: `docs/guides/debug-a-failed-request.md`. Read it first.

## Steps (walk in order, stop at first clue)

1. **Is the request logged?** — `SELECT id, model, status_code, error, req_id FROM request_logs ORDER BY created_at DESC LIMIT 5;`. If no row: client auth failure (check `client_keys.key` / `enabled`).
2. **Open the Console page** — dashboard `/#/admin/console`. Find the block by `reqid` (4-byte hex) or by time. Check for `error` line, `transport-fail` line.
3. **Account state** — `SELECT id, label, status, backoff_level, rate_limited_until FROM accounts ORDER BY backoff_level DESC;`. If `status='error'`: 401 upstream. If `rate_limited_until > now`: in backoff. `json_extract(last_error, '$.baseRespCode')` → match to `docs/reference/error-codes.md`.
4. **Model lock** — `SELECT * FROM account_model_locks WHERE account_id=? AND model=?;`. Clear with dashboard, `DELETE /api/admin/accounts/:id/locks/:model`, or SQL.
5. **Inspect bodies** — `SELECT request_body, response_body, error FROM request_logs WHERE id=?;`. Common: `{"error":{"base_resp":{"status_code":1002}}}` → upstream rate limit. Missing `done` in console → format conversion or upstream parse failure.
6. **Model resolution** — `SELECT * FROM model_aliases WHERE alias_name=?;` then `SELECT * FROM models WHERE name=? OR upstream_model=?;`. Check `enabled` and `provider`.
7. **Combo / fallback** — `SELECT * FROM combos WHERE name=?;`. Look for multiple `account` lines per `reqid` in the Console page.

## Test

```bash
# Smoke: trigger the failing path with curl
curl -X POST http://localhost:20137/v1/chat/completions \
  -H "Authorization: Bearer $ROUTER_CLIENT_KEY" \
  -H "content-type: application/json" \
  -d '{"model": "minimax/MiniMax-M3", "messages": [{"role":"user","content":"hi"}]}'
```

## Commit

Read-only. If a new failure mode surfaces, add it to the "Common failure modes" table in `docs/guides/debug-a-failed-request.md` and to the playbook's commit.

## See also

- `docs/guides/debug-a-failed-request.md` — full ladder with SQL samples
- `docs/reference/error-codes.md` — base_resp / HTTP → backoff decisions
- `docs/reference/db-tables.md` — `request_logs`, `account_model_locks`, `accounts`
