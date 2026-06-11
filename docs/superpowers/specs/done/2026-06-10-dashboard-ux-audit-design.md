# Dashboard UX Audit — Design Spec

**Date:** 2026-06-10  
**Scope:** Full UX overhaul across all dashboard pages

---

## Core Fixes (User-reported)

### A. Accounts — Transport Column

**Problem:** Proxy/relay assignment invisible. Must click Edit to see.

**Fix:** Add "Transport" column to accounts table between "Backoff" and "Last error".

Badge rendering logic:
- No transport → `Direct` (muted badge)
- `proxy_id` set → `🔀 {proxy.label}` (info badge)
- `proxy_pool` set → `🔀 Pool(N)` where N = pool member count (info badge)
- `relay_id` set → `☁ {relay.label}` (active badge)

Click badge → open edit modal pre-scrolled to transport section.

### B. Quota — Compact Table Redesign

**Problem:** One full Card per account. Doesn't scale to 10+ accounts.

**Fix:** Single table layout:
- Rows = one per account
- Columns: Account label | Credit type | Worst % (mini bar) | 5h remaining | Weekly remaining | Resets in
- Click row → expand inline detail (all model bars, same as current ModelBlock)
- Collapse all by default
- "Worst %" = the lowest remaining_percent across all windows for that account (quick health glance)

### C. Transports — Bulk Proxy Add

**Problem:** Can only add one proxy at a time.

**Fix:** Add "Bulk import" button next to "+ Add transport" on TopBar.

Opens a modal with:
- Textarea for pasting proxy list
- Format guide: `ip:port:user:pass` (one per line)
- Protocol selector (http / socks5) — applies to all imported
- Optional label prefix (default: "proxy") → generates `proxy-1`, `proxy-2`, etc.
- Preview count: "12 proxies detected"
- "Import all" button → POST each to `/api/admin/transports`
- Progress bar during import
- Summary toast: "12/12 imported" or "10/12 imported, 2 failed"

Parsing logic:
- `ip:port:user:pass` → `http://user:pass@ip:port`
- `ip:port` (no auth) → `http://ip:port`
- `user:pass@ip:port` → `http://user:pass@ip:port`
- Lines starting with `#` or empty → skip

### D. Account Selection Strategy

**Problem:** `selectAccount()` hardcoded to "lowest backoff wins". No config. Console mislabels as "round-robin".

**Fix:**

1. **New setting:** `selection.mode` with values:
   - `lowest-backoff` (default, current behavior)
   - `round-robin` (cycle through available accounts in order, skip unavailable)
   - `sticky` (pin to one account per `client_key_id`, fallback if unavailable)

2. **Settings page:** New card "Account selection" with dropdown for mode + explanation text.

3. **Backend:** Refactor `selectAccount(accounts, opts?)` to accept mode + context (client_key_id for sticky, last_used_idx for round-robin).

4. **Console fix:** Emit actual reason from selectAccount (`'lowest-backoff'` | `'round-robin'` | `'sticky'` | `'fallback'`).

---

## Bonus Fixes (Audit findings)

### F+G. Usage — Account Column + Filter

**Problem:** Can't see/filter which upstream account handled a request.

**Fix:**
- Add "Account" column after "Model" in usage table (show account label, or "—" if null)
- Add account dropdown filter in the filter bar (alongside existing client_key filter)
- Backend: usage endpoint already returns `accountId` — need to also return `accountLabel` (join accounts table)

### H. Models — Bulk Enable/Disable

**Problem:** Toggling 50 models one by one.

**Fix:**
- Add checkbox column (first col) to models table
- When ≥1 checked → show floating toolbar: "N selected — Enable all | Disable all"
- Toolbar uses batch endpoint (new: `POST /api/admin/models/bulk-toggle` with `{names: string[], enabled: boolean}`)
- "Select all filtered" checkbox in thead

### I. Client Keys — Edit Label

**Problem:** Can't rename a key after creation.

**Fix:**
- Double-click label cell → inline edit (input replaces text)
- Enter to save, Escape to cancel
- `PATCH /api/admin/client-keys/:id` with `{label: string}`

### J. Console — Filter Bar

**Problem:** Heavy traffic makes console unusable without filtering.

**Fix:**
- Add filter bar below TopBar: model text input, account dropdown, status dropdown (all/success/error)
- Filters apply client-side to the events array (SSE stays unfiltered)
- Filter state persists in component (not URL — ephemeral)
- Show "N filtered" count when active

### K. Console — Fix Misleading Reason

**Problem:** Always emits `'round-robin'` regardless of actual selection logic.

**Fix:**
- After implementing D, pass actual reason from `selectAccount` return value
- Console `buildAccount()` receives the real reason string
- No UI change needed — already renders `(reason)` in the block

### L. Transports — "Used by" Column

**Problem:** Can't see which accounts use a transport without checking each account.

**Fix:**
- Add "Used by" column to transports table
- Query: count accounts where `proxy_id = t.id OR proxy_pool LIKE '%t.id%' OR relay_id = t.id`
- Show as: "3 accounts" (clickable → navigates to Accounts page filtered? Or tooltip with labels)
- Backend: include `usageCount` in transport list response

### M. Overview — Account in Recent

**Problem:** Recent requests table doesn't show which account served.

**Fix:**
- Add "Account" column to recent requests table (between Model and Status)
- Backend already returns `accountId` — add `accountLabel` to the overview response

### N. Quota — Refresh Feedback

**Problem:** Pressing refresh does nothing visible. User confused if it worked.

**Fix:**
- Refresh button gets spinning animation class while `isFetching` is true
- Add `@keyframes spin` to the ↻ character (rotate 360deg, 0.8s linear infinite)
- When refetch completes: brief green flash on the card/table border (success signal)
- If refetch errors: brief red flash + toast
- Button text: "↻ Refresh" → shows "↻" spinning during fetch

### O. Aliases — Allow Shadowing Built-in Models

**Problem:** Creating alias `claude-opus-4-8` is rejected with `AliasConflictError` because a built-in model with that name exists. User wants aliases to be stronger than built-in names — alias should shadow the model.

**Current flow:**
- `upsertAlias()` checks `getModel(db, name)` → if found, throws `AliasConflictError`
- `resolveAlias()` already checks alias FIRST (exact match via `map.get(name)`) — if alias exists, returns target, model name never reached

**Fix:**
1. **Remove `AliasConflictError` guard** in `upsertAlias()` — allow alias names matching model names
2. Resolution already correct: alias wins on exact match only
3. **Exact match only** — alias `claude-opus-4-8` shadows ONLY `claude-opus-4-8`. Models with suffixes (`claude-opus-4-8-thinking`, `-agentic`) remain fully reachable
4. **Models page: "shadowed" badge** — models that have an alias with their exact name show `⚡ shadowed` badge (muted, indicates alias overrides this model name)
5. **Alias creation UI: info warning** — when alias name matches an existing model: "This alias shadows the built-in model. Requests for this name route to the alias target." (non-blocking info, not error)
6. **Delete alias → model auto-unblocked** — no extra logic needed, `resolveAlias` returns name as-is when no alias

---

## Implementation Order

1. **Backend first:** selection strategy setting + selectAccount refactor + bulk toggle endpoint + usage accountLabel + transport usageCount + remove AliasConflictError
2. **A:** Accounts transport column (pure frontend, data already there)
3. **B:** Quota compact table (frontend redesign)
4. **C:** Transports bulk import (frontend + uses existing POST endpoint in loop)
5. **D:** Selection strategy UI in Settings (frontend, wired to new setting)
6. **F+G:** Usage account column + filter
7. **H:** Models bulk toggle
8. **I:** Client Keys inline edit
9. **J+K:** Console filter + fix reason
10. **L:** Transports "Used by"
11. **M:** Overview account column
12. **N:** Quota refresh animation
13. **O:** Alias shadowing (backend guard removal + UI indicators)

---

## Non-goals

- No mobile responsive overhaul (single-user self-host, desktop assumed)
- No dark/light theme toggle (Obsidian Gold is the one theme)
- No drag-and-drop reordering
- No WebSocket upgrade for Console (SSE is fine)
