# Per-Provider Account Selection + Models Refactor

**Date:** 2026-06-11  
**Status:** Approved

---

## Summary

Three changes:
1. Account selection settings (mode + step) become per-provider, replacing the single global `selection` key.
2. Accounts page splits into two provider cards (MiniMax, Kiro) each with inline selection settings.
3. Models page splits into two provider cards with manual add and per-model health check (test).

---

## 1. Backend — Selection Logic

### `SelectionOpts` — add `step`

```ts
// src/accounts/types.ts
interface SelectionOpts {
  mode: SelectionMode;
  cursor?: number;
  step?: number;       // new, default 1
  clientKeyId?: number;
  stickyMap?: Map<number, string>;
}
```

### `selectAccount` round-robin with step

```ts
// src/accounts/selection.ts
if (opts.mode === 'round-robin') {
  const cursor = opts.cursor ?? 0;
  const step = opts.step ?? 1;
  const idx = Math.floor(cursor / step) % available.length;
  return { account: available[idx]!, reason: 'round-robin', nextCursor: cursor + 1 };
}
```

`step=1` → identical to current behavior. `step=10` → same account for 10 consecutive requests before advancing.

### DB keys

Two new keys in existing `settings` table:

| Key | Default value |
|-----|--------------|
| `selection.minimax` | `{ "mode": "lowest-backoff", "step": 1 }` |
| `selection.kiro` | `{ "mode": "lowest-backoff", "step": 1 }` |

No migration file needed — `settings` table already exists. Old `selection` key stays in DB but is no longer read.

### `server.ts` — read per-provider setting

Replace all three `getSetting(db, 'selection')` reads with provider-specific keys:

```ts
// MiniMax paths (lines ~207, ~646):
const sel = getSetting<{ mode: SelectionMode; step: number }>(db, 'selection.minimax')
  ?? { mode: 'lowest-backoff', step: 1 };
// pass sel.mode + sel.step to selectAccount opts

// Kiro path (line ~975):
const sel = getSetting<{ mode: SelectionMode; step: number }>(db, 'selection.kiro')
  ?? { mode: 'lowest-backoff', step: 1 };
```

---

## 2. Backend — API Endpoints

### Selection settings (new)

```
GET  /api/admin/settings/selection/:provider
     → { mode: string, step: number }

POST /api/admin/settings/selection/:provider
     body: { mode: string, step: number }
     → 200 OK
```

`provider` validated as `minimax | kiro`. Writes key `selection.<provider>` via `setSetting`.

### Remove old endpoint

`POST /api/admin/settings/selection` — deleted.  
`selection` field removed from `GET /api/admin/settings` response.

### Model health check (new)

```
POST /api/admin/models/:id/test
     → { ok: true, latencyMs: number }
     → { ok: false, latencyMs: number, error: string }
```

Sends minimal request to upstream (1-token prompt) using an active enabled account for the model's provider. Uses existing `upstreamFetch` path. Does not log to `request_logs`.

---

## 3. Frontend — Accounts Page

### Layout change

Before: single table, all accounts mixed.

After: two `<Card>` components, one per provider.

```
┌─────────────────────────────────────────┐
│ MiniMax                    [+ Add]      │
│ Selection: [lowest-backoff ▾] Step: [1] │  ← only shown when mode=round-robin
├─────────────────────────────────────────┤
│ table: MiniMax accounts only            │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ Kiro                       [+ Add]      │
│ Selection: [round-robin    ▾] Step: [1] │
├─────────────────────────────────────────┤
│ table: Kiro accounts only               │
└─────────────────────────────────────────┘
```

- Selection mode dropdown + step input inline in card header area
- Step field visible only when `mode === 'round-robin'`
- Auto-save on change (optimistic, same pattern as other dashboard toggles)
- `+ Add` button pre-sets provider; no provider picker in modal

### Data fetching

New query per provider card:
```ts
useQuery(['selection', provider], () => apiFetch(`/api/admin/settings/selection/${provider}`))
useMutation → POST /api/admin/settings/selection/:provider
```

---

## 4. Frontend — Models Page

### Layout change

Before: single card + provider filter dropdown.

After: two `<Card>` components, one per provider. Filter dropdown removed.

Each card has:
- `Fetch from upstream` button (existing)
- `+ Add model` button (new) → modal form

### Add model modal fields

| Field | Required |
|-------|---------|
| Model name (`name`) | yes |
| Display name | no |
| Context window | no |
| Pricing input ($/M) | no |
| Pricing output ($/M) | no |

Provider pre-set from which card triggered the modal.

### Test button

Each model row gets a `Test` button:
- Click → `POST /api/admin/models/:id/test`
- Shows inline: spinner → `✓ 312ms` or `✗ timeout`
- State is local (not persisted), resets on page navigation

---

## 5. Cleanup

| Location | Action |
|----------|--------|
| `src/api/admin/settings.ts` | Remove `selection` from GET response; remove `POST /selection` route |
| `src/server.ts` lines ~207, ~646, ~975 | Replace `getSetting(db, 'selection')` with per-provider key |
| `client/src/pages/Settings.tsx` | Remove "Account selection" card entirely |

Old `selection` key in DB: not deleted from DB, not read in code. Clean enough.

---

## Out of Scope

- Per-account selection override (not needed)
- Persistent test history (health check is stateless by design)
- Provider management (add/remove providers)
