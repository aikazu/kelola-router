# State Machines

> Deep notes on account selection, backoff, and per-model locks. For the visual diagrams see `ARCHITECTURE.md` "State machines" section. For error → decision mapping see `docs/reference/error-codes.md`.

## Why this exists

The 3 state machines (selection / backoff / lock) are the most-touched-and-most-misunderstood code in the repo. Refactors here cause subtle request-routing bugs. This doc captures the invariants, the edge cases, and the "if you change X, also change Y" coupling.

## 1. Account selection (`src/accounts/selection.ts`)

### Three modes

| Mode | Storage | Behavior | Reset on… |
|---|---|---|---|
| `lowest-backoff` (default) | stateless | Sort by `backoffLevel` asc, take first | N/A |
| `round-robin` | `rrCursor` per provider (in `server.ts` module-scope) | `idx = floor(cursor / step) % available.length`. Advance `cursor += 1` per request. | process restart (intentional — no DB persistence) |
| `sticky` | `Map<clientKeyId, accountId>` in `server.ts` `stickyMap` | Pin first-selected account per `clientKeyId`. Fallback to `lowest-backoff` on miss + re-pin. | process restart |

### Invariants

1. **Mode + step** are read from per-provider settings: `settings.selection.minimax` and `settings.selection.kiro`. The legacy `selection` setting (without `.provider`) is no longer read.
2. **No candidate → 503** with `reason = mode`. The proxy returns this to the client.
3. **Sticky is per-client-key**, not per-account. The pin survives across requests for the same `clientKeyId` until the pinned account becomes unavailable (backoff/disabled).
4. **Sticky fallback** when pinned is unavailable: select via `lowest-backoff` and re-pin. The pin is updated, not cleared.
5. **Round-robin cursor** lives in `server.ts` module scope. It's a single `number` per provider, not per-`clientKeyId`. Sticky + round-robin don't combine.

### What `selectAccount` returns

```ts
type SelectionResult = {
  account: Account | null,
  reason: 'lowest-backoff' | 'round-robin' | 'sticky' | 'fallback' | 'lowest-backoff' | 'mode' | 'no-accounts',
  nextCursor?: number  // only for round-robin
}
```

The proxy handler reads `account` + `nextCursor` and writes `nextCursor` back to the ref.

### Gotchas

- Don't add new modes without also updating `src/api/admin/settings.ts` `GET/POST /selection/:provider` + the dashboard `SelectionControls` component.
- The legacy `settings.selection` key is no longer read. If a user upgrades from pre-0.13 and the old key is still in their DB, they get default behavior (lowest-backoff) silently. No migration.
- Round-robin cursor reset on restart is by design. Persisting it would add a DB write per request.

## 2. Error → backoff (`src/accounts/errorRules.ts` + `state.ts`)

### Decision flow

See [`docs/reference/error-codes.md`](../../docs/reference/error-codes.md) for the full table. This section focuses on the `applyAccountError` side effects.

### What gets persisted

`applyAccountError` mutates an `AccountState` (in-memory copy, then `updateAccount(db, ...)` to persist):
- `rateLimitedUntil` — ISO timestamp. Set when `cooldownMs > 0`. Cleared on next success.
- `backoffLevel` — `0..BACKOFF_MAX_LEVEL` (5). Increments on `backoff: true` decisions. Resets to 0 on success.
- `lastError` — JSON blob `{status, message, timestamp, baseRespCode}`. Always set on error. Truncated to 500 chars in `state.ts:42`.
- `status` — `active` / `error` / `disabled`. Set to `error` on HTTP 401. Cleared on next success.

### Invariants

1. **1008 (balance) is permanent.** `applyAccountError` does not set `cooldownMs`; the account stays `active` but its `backoffLevel` stays at max. It won't be selected by `lowest-backoff` (which sorts by level asc — but max is still selected if all are max).
2. **2013 (param) is permanent too.** Same as 1008.
3. **401 sets `status='error'`.** The dashboard surfaces this and the user must re-add the account.
4. **Cooldown is wall-clock.** `rate_limited_until > now` is what `isAccountUnavailable` checks. Server time is trusted.
5. **Backoff level persists across cooldown.** Level 3 + cooldown expired ≠ level 0. The level only resets on a successful request.

### What `isAccountUnavailable` does

```ts
function isAccountUnavailable(account: AccountState): boolean {
  if (!account.rateLimitedUntil) return false;
  return new Date(account.rateLimitedUntil).getTime() > Date.now();
}
```

`isAccountUnavailable` is the only filter used by `filterAvailableAccounts` in `state.ts`. Sticky / round-robin also go through this filter.

### Gotchas

- `backoffLevel` is incremented in `errorRules.checkFallbackError` only when the rule has `backoff: true`. Most base_resp codes return `cooldownMs` directly without bumping the level.
- The exponential curve lives in `src/accounts/backoff.ts` `getQuotaCooldown(level)`. `BACKOFF_MAX_LEVEL = 5` caps the level; further increments are no-ops (Math.min).
- `applyAccountError` is called inside the proxy handler's `catch` block. If the request itself crashes (e.g. consoleBus throws), the error path may not run — check `src/console/bus.ts` for the throwing-subscriber isolation.

## 3. Per-model lock (`src/accounts/locks.ts`)

### What it is

`(account_id, model) → locked_until`. Short-lived (seconds to minutes). Inserted when the upstream signals a per-model problem (e.g. `base_resp.status_code = 1039` "token limit").

### What `selectAccount` does with it

The proxy checks `getModelLock(accountId, model)` before each request. If active:
- Returns 429 with `error: 'model_locked'`
- Does NOT try another account (model is the failure unit, not the account)

For combo routing, the proxy moves to the NEXT model in the chain.

### TTL

Lock TTL is short — `getQuotaCooldown(level+1)` typically. Cleared by `clearExpiredModelLocks` on the next proxy tick.

### Invariants

1. **Lock is per (account, model).** Two accounts can both have the same model locked independently.
2. **No per-account lock for the model means no lock.** Don't infer "no row = no lock" without checking `locked_until > now` first.
3. **Lock bypasses `selectAccount`.** Even a healthy account is rejected if its model is locked. This is intentional — model problems are sticky.

### Gotchas

- `clearExpiredModelLocks` runs on every `selectAccount` call (or close to it). It's a cheap `DELETE WHERE locked_until < now`.
- The PK is `(account_id, model)` — re-inserting on the same pair replaces the row.
- If you add a new "lock reason" (e.g. `rate_limited`, `safety_violation`), add a column to the table + a migration. Don't store the reason in a JSON blob — the dashboard wants to filter.

## Cross-coupling

- **Selection ↔ Backoff**: a high-`backoffLevel` account is still selectable in `lowest-backoff` if it's the only one. The level sorts; it doesn't exclude.
- **Backoff ↔ Lock**: independent. An account can be in backoff (whole account) AND have per-model locks active.
- **Selection ↔ Lock**: independent in single-model mode; combined in combo mode (lock → next model).

## Gotchas (general)

- **Don't add new state fields without bumping the migration.** Account state lives in `accounts` + `account_model_locks`. New field = new migration.
- **Don't put state in the proxy handlers.** Use the existing modules.
- **Don't race the `rrCursor`.** It's a `number`, not an atom. Two concurrent requests in round-robin mode may both see the same cursor value (read-modify-write race). The router is single-tenant, so this is acceptable. If you make it multi-tenant, refactor.
- **Don't bypass `isAccountUnavailable`.** If you write a new selection helper, go through the filter.

## Cross-refs

- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — state-machine diagrams
- [`../../docs/reference/error-codes.md`](../../docs/reference/error-codes.md) — error → decision table
- [`../../docs/guides/debug-a-failed-request.md`](../../docs/guides/debug-a-failed-request.md) — debug ladder
- `src/accounts/{selection,state,locks,backoff,errorRules,types}.ts` — source of truth
