# Error Codes

How the router decides whether to backoff / lock / block on a given error. Source: `src/accounts/errorRules.ts`. Two layers: (1) MiniMax `base_resp.status_code` (in the JSON body), then (2) HTTP status + error text matching.

## Priority 1 — `Retry-After` header (HTTP 429)

If `429` and `Retry-After` is set, use it as `cooldownMs`. No backoff level change.

## Priority 2 — MiniMax `base_resp.status_code` (semantic)

| Code | Meaning | Decision |
|---|---|---|
| `2056` / `2061` | Window reset (quota window rolled over) | `cooldownMs = windowResetMs` (from response field) |
| `1002` | Rate limit | exponential backoff (`getQuotaCooldown(level+1)`) |
| `1008` | Balance / quota exhausted | permanent lock (no cooldown — set `status='error'`) |
| `1039` | Token limit (per-model) | per-model lock (insert into `account_model_locks`) |
| `2013` | Invalid parameter (bad request) | permanent lock |
| `1004` | Auth failure (handled by account-level error state) | fallback, no cooldown |
| `1001` | Upstream timeout | `cooldownMs = 10_000` (10s) |
| `1027` | Output content error (likely transient guard) | exponential backoff |
| `1013` | Internal server error | `cooldownMs = 5000` (5s) |

## Priority 3 — Text matching on error body

If no `base_resp` match, the lowercased error text is matched against these `ERROR_RULES`:

| Pattern / Status | Decision |
|---|---|
| text contains `rate limit` | exponential backoff |
| text contains `rate growth` | exponential backoff |
| text contains `window exhausted` | fallback, `cooldownMs = 0` |
| HTTP `429` (no `Retry-After`) | exponential backoff |
| HTTP `401` | fallback, `cooldownMs = 0` (also sets `account.status='error'`) |
| HTTP `400` | fallback, `cooldownMs = 0` (param error — won't help to retry) |
| HTTP `500` | `cooldownMs = 5000` |
| HTTP `502` | `cooldownMs = 5000` |
| HTTP `503` | `cooldownMs = 5000` |
| HTTP `504` | `cooldownMs = 5000` |

## Default

If nothing matches: `cooldownMs = 5000` (5s), `source: 'default'`.

## Backoff level

Exponential: `getQuotaCooldown(level)` doubles up to `BACKOFF_MAX_LEVEL` (5). Resets to 0 on next successful request. See `src/accounts/backoff.ts` for the exact curve.

## Decision flow

```
error response
   │
   ├─ 429 + Retry-After?  → cooldownMs = Retry-After * 1000
   ├─ 2056/2061 + windowResetMs?  → cooldownMs = windowResetMs
   ├─ base_resp code match?  → use the table above
   ├─ error text contains match?  → use the table above
   ├─ HTTP status match?  → use the table above
   └─ none  → cooldownMs = 5000 (default)
```

Regenerate when `errorRules.ts` adds codes or HTTP statuses. Source: `src/accounts/errorRules.ts`.
