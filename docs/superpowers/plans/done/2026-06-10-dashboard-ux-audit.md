# Dashboard UX Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 15 UX issues (A–O) across all dashboard pages — visibility, scalability, bulk ops, selection strategy, alias shadowing.

**Architecture:** Backend-first (new endpoints + refactors), then frontend page-by-page. Each task is self-contained: test → impl → commit. Server uses Hono + better-sqlite3; client is Preact SPA with @tanstack/react-query.

**Tech Stack:** TypeScript strict, Hono, better-sqlite3 (WAL), Preact, @tanstack/react-query, Vitest, CSS (no framework)

---

## File Map

### Backend (new/modified)
| File | Responsibility |
|------|---------------|
| `src/db/repos/aliases.ts` | Remove AliasConflictError guard (O) |
| `src/accounts/selection.ts` | Refactor to support 3 strategies (D) |
| `src/accounts/types.ts` | Add SelectionMode type (D) |
| `src/db/repos/settings.ts` | Selection mode setting key (D) |
| `src/api/admin/models.ts` | Add `POST /admin/models/bulk-toggle` (H) |
| `src/api/admin/clientKeys.ts` | Add `PATCH /admin/client-keys/:id` label (I) |
| `src/api/admin/usage.ts` | Join accountLabel in response (F+G) |
| `src/api/admin/overview.ts` | Join accountLabel in recent (M) |
| `src/api/admin/transports.ts` | Add usageCount to list response (L) |
| `src/server.ts` | Wire real selection reason to console emit (K) |
| `src/console/types.ts` | Extend FlowReason type (K) |

### Frontend (new/modified)
| File | Responsibility |
|------|---------------|
| `client/src/pages/Accounts.tsx` | Transport column badge (A) |
| `client/src/pages/Quota.tsx` | Compact table redesign + refresh animation (B+N) |
| `client/src/pages/Transports.tsx` | Bulk import modal + "Used by" column (C+L) |
| `client/src/pages/Settings.tsx` | Selection strategy card (D) |
| `client/src/pages/Usage.tsx` | Account column + filter (F+G) |
| `client/src/pages/Models.tsx` | Bulk toggle checkbox toolbar (H) |
| `client/src/pages/ClientKeys.tsx` | Inline edit label (I) |
| `client/src/pages/Console.tsx` | Filter bar (J) |
| `client/src/pages/Overview.tsx` | Account column in recent (M) |
| `client/src/pages/Aliases.tsx` | Shadowing warning in create modal (O) |
| `client/src/styles/components.css` | Quota table + refresh spin styles (B+N) |

---

## Task 1: Remove Alias Conflict Guard (O backend)

**Files:**
- Modify: `src/db/repos/aliases.ts`
- Modify: `src/api/admin/aliases.ts`
- Test: `src/db/repos/aliases.test.ts` (or existing test file)

- [ ] **Step 1: Write test — alias with same name as model should succeed**

```typescript
// In the alias test file, add:
it('allows alias name matching an existing model name (shadowing)', () => {
  // Seed a model named 'claude-opus-4-8'
  upsertModel(db, { name: 'claude-opus-4-8', upstream_model: 'claude-opus-4-8' });
  upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3' });

  // Should NOT throw — alias shadows the model
  const alias = upsertAlias(db, {
    aliasName: 'claude-opus-4-8',
    upstreamModel: 'MiniMax-M3',
  });
  expect(alias.aliasName).toBe('claude-opus-4-8');
  expect(alias.upstreamModel).toBe('MiniMax-M3');
});

it('resolveAlias returns alias target when name matches a model', () => {
  upsertModel(db, { name: 'claude-opus-4-8', upstream_model: 'claude-opus-4-8' });
  upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3' });
  upsertAlias(db, { aliasName: 'claude-opus-4-8', upstreamModel: 'MiniMax-M3' });
  clearAliasCache();

  const resolved = resolveAlias(db, 'claude-opus-4-8');
  expect(resolved).toBe('MiniMax-M3');
});

it('models with suffixes remain unaffected by shadowing alias', () => {
  upsertModel(db, { name: 'claude-opus-4-8', upstream_model: 'claude-opus-4-8' });
  upsertModel(db, { name: 'claude-opus-4-8-thinking', upstream_model: 'claude-opus-4-8-thinking' });
  upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3' });
  upsertAlias(db, { aliasName: 'claude-opus-4-8', upstreamModel: 'MiniMax-M3' });
  clearAliasCache();

  // Suffix model NOT shadowed
  const resolved = resolveAlias(db, 'claude-opus-4-8-thinking');
  expect(resolved).toBe('claude-opus-4-8-thinking');
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run src/db/repos/aliases.test.ts -t "shadowing"`
Expected: FAIL with `AliasConflictError`

- [ ] **Step 3: Remove the guard in upsertAlias**

In `src/db/repos/aliases.ts`, remove these lines from `upsertAlias()`:
```typescript
// DELETE THIS BLOCK:
// Reject if alias name collides with a real model name
if (getModel(db, name)) {
  throw new AliasConflictError(name);
}
```

Also add a new helper to check if an alias shadows a model:
```typescript
export function isAliasShadowing(db: Database.Database, aliasName: string): boolean {
  return getModel(db, aliasName) !== null;
}
```

- [ ] **Step 4: Update admin API to return shadowing info instead of 409**

In `src/api/admin/aliases.ts`, in the POST/PUT handler, remove the `AliasConflictError` catch that returns 409. Instead, add `shadowsModel: boolean` to the response DTO:

```typescript
function rowToDto(r: ModelAlias, db?: Database.Database) {
  return {
    aliasName: r.aliasName,
    upstreamModel: r.upstreamModel,
    label: r.label,
    source: r.source,
    createdAt: r.createdAt,
    shadowsModel: db ? isAliasShadowing(db, r.aliasName) : false,
  };
}
```

- [ ] **Step 5: Run tests — verify passing**

Run: `npx vitest run src/db/repos/aliases.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/db/repos/aliases.ts src/api/admin/aliases.ts src/db/repos/aliases.test.ts
git commit -m "feat(alias): allow shadowing built-in model names (item O)"
```

---

## Task 2: Account Selection Strategy (D backend)

**Files:**
- Modify: `src/accounts/selection.ts`
- Modify: `src/accounts/types.ts` (or create if needed)
- Modify: `src/db/repos/settings.ts`
- Modify: `src/server.ts`
- Modify: `src/console/types.ts`
- Test: `src/accounts/selection.test.ts`

- [ ] **Step 1: Define SelectionMode type**

In `src/accounts/types.ts` (create if missing, or add to existing):
```typescript
export type SelectionMode = 'lowest-backoff' | 'round-robin' | 'sticky';
export type SelectionReason = 'lowest-backoff' | 'round-robin' | 'sticky' | 'fallback';
```

- [ ] **Step 2: Write failing tests for round-robin and sticky**

```typescript
// src/accounts/selection.test.ts
import { selectAccount } from './selection.js';
import type { AccountState } from './types.js';

function makeState(id: string, backoff = 0): AccountState {
  return { id, label: id, backoffLevel: backoff, enabled: true, rateLimitedUntil: null, status: 'active' } as AccountState;
}

describe('selectAccount', () => {
  const accounts = [makeState('a', 0), makeState('b', 0), makeState('c', 0)];

  it('lowest-backoff: picks lowest backoff', () => {
    const mixed = [makeState('a', 2), makeState('b', 0), makeState('c', 1)];
    const { account, reason } = selectAccount(mixed, { mode: 'lowest-backoff' });
    expect(account!.id).toBe('b');
    expect(reason).toBe('lowest-backoff');
  });

  it('round-robin: cycles through accounts', () => {
    const r1 = selectAccount(accounts, { mode: 'round-robin', cursor: 0 });
    expect(r1.account!.id).toBe('a');
    expect(r1.nextCursor).toBe(1);

    const r2 = selectAccount(accounts, { mode: 'round-robin', cursor: 1 });
    expect(r2.account!.id).toBe('b');

    const r3 = selectAccount(accounts, { mode: 'round-robin', cursor: 2 });
    expect(r3.account!.id).toBe('c');

    // Wraps
    const r4 = selectAccount(accounts, { mode: 'round-robin', cursor: 3 });
    expect(r4.account!.id).toBe('a');
  });

  it('sticky: pins to client_key, falls back if unavailable', () => {
    const r1 = selectAccount(accounts, { mode: 'sticky', clientKeyId: 7, stickyMap: new Map() });
    expect(r1.account).not.toBeNull();
    expect(r1.reason).toBe('sticky');

    // Same clientKeyId → same account
    const map = new Map([[7, 'b']]);
    const r2 = selectAccount(accounts, { mode: 'sticky', clientKeyId: 7, stickyMap: map });
    expect(r2.account!.id).toBe('b');
  });

  it('sticky: fallback when pinned account unavailable', () => {
    const map = new Map([[7, 'x-gone']]);  // account doesn't exist
    const r = selectAccount(accounts, { mode: 'sticky', clientKeyId: 7, stickyMap: map });
    expect(r.account).not.toBeNull();
    expect(r.reason).toBe('fallback');
  });
});
```

- [ ] **Step 3: Run test — verify fails**

Run: `npx vitest run src/accounts/selection.test.ts`
Expected: FAIL — selectAccount doesn't accept opts yet

- [ ] **Step 4: Refactor selectAccount**

```typescript
// src/accounts/selection.ts
import { filterAvailableAccounts } from './state.js';
import type { AccountState, SelectionMode, SelectionReason } from './types.js';

export interface SelectionOpts {
  mode: SelectionMode;
  cursor?: number;          // for round-robin
  clientKeyId?: number;     // for sticky
  stickyMap?: Map<number, string>; // clientKeyId → accountId
}

export interface SelectionResult {
  account: AccountState | null;
  reason: SelectionReason;
  nextCursor?: number;
}

export function selectAccount(
  accounts: AccountState[],
  opts: SelectionOpts = { mode: 'lowest-backoff' }
): SelectionResult {
  const available = filterAvailableAccounts(accounts);
  if (available.length === 0) return { account: null, reason: 'fallback' };

  if (opts.mode === 'round-robin') {
    const idx = (opts.cursor ?? 0) % available.length;
    return {
      account: available[idx]!,
      reason: 'round-robin',
      nextCursor: idx + 1,
    };
  }

  if (opts.mode === 'sticky' && opts.clientKeyId != null && opts.stickyMap) {
    const pinned = opts.stickyMap.get(opts.clientKeyId);
    if (pinned) {
      const found = available.find((a) => a.id === pinned);
      if (found) return { account: found, reason: 'sticky' };
    }
    // Fallback: pick lowest-backoff and pin it
    const pick = available.sort((a, b) => a.backoffLevel - b.backoffLevel)[0]!;
    opts.stickyMap.set(opts.clientKeyId, pick.id);
    return { account: pick, reason: opts.stickyMap.has(opts.clientKeyId) ? 'fallback' : 'sticky' };
  }

  // Default: lowest-backoff
  const sorted = available.sort((a, b) => a.backoffLevel - b.backoffLevel);
  return { account: sorted[0]!, reason: 'lowest-backoff' };
}
```

- [ ] **Step 5: Update FlowReason type**

In `src/console/types.ts`:
```typescript
export type FlowReason = 'lowest-backoff' | 'round-robin' | 'sticky' | 'fallback';
```

- [ ] **Step 6: Wire into server.ts**

In `src/server.ts`, replace the two `selectAccount(accountStates)` calls with:
```typescript
import { getSetting } from './db/repos/settings.js';
import type { SelectionMode } from './accounts/types.js';

// At module level:
let rrCursor = 0;
const stickyMap = new Map<number, string>();

// In handleProxy / handleKiroProxy:
const mode = getSetting<SelectionMode>(db, 'selection.mode') ?? 'lowest-backoff';
const { account: acc, reason, nextCursor } = selectAccount(accountStates, {
  mode,
  cursor: rrCursor,
  clientKeyId: clientKey?.id,
  stickyMap,
});
if (nextCursor != null) rrCursor = nextCursor;

// Replace hardcoded 'round-robin':
consoleBus.emit(buildAccount(reqId, new Date().toISOString(), acc.label, reason));
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/accounts/selection.test.ts`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add src/accounts/selection.ts src/accounts/types.ts src/console/types.ts src/server.ts src/accounts/selection.test.ts
git commit -m "feat(accounts): configurable selection strategy — lowest-backoff/round-robin/sticky (item D+K)"
```

---

## Task 3: Bulk Model Toggle + Client Key Label PATCH (H+I backend)

**Files:**
- Modify: `src/api/admin/models.ts`
- Modify: `src/api/admin/clientKeys.ts`
- Modify: `src/db/repos/models.ts`
- Test: `tests/api/models-bulk.test.ts`
- Test: `tests/api/client-keys-patch.test.ts`

- [ ] **Step 1: Write test — bulk toggle models**

```typescript
// tests/api/models-bulk.test.ts
it('POST /admin/models/bulk-toggle enables/disables multiple models', async () => {
  // Seed 3 models
  seedModels(db);
  const res = await app.request('/api/admin/models/bulk-toggle', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ names: ['MiniMax-M3', 'MiniMax-M2.7'], enabled: false }),
  });
  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.updated).toBe(2);

  // Verify disabled
  const m = getModel(db, 'MiniMax-M3');
  expect(m!.enabled).toBe(0);
});
```

- [ ] **Step 2: Write test — PATCH client key label**

```typescript
// tests/api/client-keys-patch.test.ts
it('PATCH /admin/client-keys/:id updates label', async () => {
  // Create a key first
  const key = createClientKey(db, { label: 'old-name' });
  const res = await app.request(`/api/admin/client-keys/${key.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'new-name' }),
  });
  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.label).toBe('new-name');
});
```

- [ ] **Step 3: Run tests — verify fail**

Run: `npx vitest run tests/api/models-bulk.test.ts tests/api/client-keys-patch.test.ts`
Expected: FAIL — endpoints don't exist

- [ ] **Step 4: Implement bulk toggle**

In `src/db/repos/models.ts`:
```typescript
export function bulkToggleModels(db: Database.Database, names: string[], enabled: boolean): number {
  const placeholders = names.map(() => '?').join(',');
  const r = db.prepare(
    `UPDATE models SET enabled = ? WHERE name IN (${placeholders})`
  ).run(enabled ? 1 : 0, ...names);
  return r.changes;
}
```

In `src/api/admin/models.ts`, add route:
```typescript
modelRoutes.post('/bulk-toggle', async (c) => {
  const db = getDb(c);
  const { names, enabled } = await c.req.json<{ names: string[]; enabled: boolean }>();
  if (!Array.isArray(names) || typeof enabled !== 'boolean') {
    return c.json({ error: 'invalid_body', message: 'names: string[], enabled: boolean required' }, 400);
  }
  const updated = bulkToggleModels(db, names, enabled);
  return c.json({ updated });
});
```

- [ ] **Step 5: Implement client key PATCH label**

In `src/db/repos/clientKeys.ts` (add helper if missing):
```typescript
export function updateClientKeyLabel(db: Database.Database, id: number, label: string): void {
  db.prepare(`UPDATE client_keys SET label = ? WHERE id = ?`).run(label, id);
}
```

In `src/api/admin/clientKeys.ts`:
```typescript
clientKeyRoutes.patch('/:id', async (c) => {
  const db = getDb(c);
  const id = Number(c.req.param('id'));
  const { label } = await c.req.json<{ label: string }>();
  if (!label || typeof label !== 'string') {
    return c.json({ error: 'invalid_body', message: 'label required' }, 400);
  }
  updateClientKeyLabel(db, id, label.trim());
  const key = getClientKey(db, id);
  if (!key) return c.json({ error: 'not_found' }, 404);
  return c.json({ id: key.id, label: key.label });
});
```

- [ ] **Step 6: Run tests — verify pass**

Run: `npx vitest run tests/api/models-bulk.test.ts tests/api/client-keys-patch.test.ts`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/db/repos/models.ts src/api/admin/models.ts src/db/repos/clientKeys.ts src/api/admin/clientKeys.ts tests/api/
git commit -m "feat(api): bulk model toggle + client key label PATCH (items H+I)"
```

---

## Task 4: Usage/Overview accountLabel + Transport usageCount (F+G+L+M backend)

**Files:**
- Modify: `src/api/admin/usage.ts`
- Modify: `src/api/admin/overview.ts`
- Modify: `src/api/admin/transports.ts`
- Test: `tests/api/usage-account.test.ts`

- [ ] **Step 1: Write test — usage response includes accountLabel**

```typescript
it('GET /api/admin/usage returns accountLabel in rows', async () => {
  // Seed account + request log
  createAccount(db, { id: 'acc-1', label: 'MyAcc', credit_type: 'payg', api_key: 'k' });
  // Insert a request log with account_id = 'acc-1'
  insertRequestLog(db, { account_id: 'acc-1', /* ... */ });

  const res = await app.request('/api/admin/usage?days=1');
  const data = await res.json();
  expect(data.page.rows[0].accountLabel).toBe('MyAcc');
});
```

- [ ] **Step 2: Implement — join accounts in usage query**

In `src/api/admin/usage.ts`, modify the SQL query:
```sql
SELECT r.*, a.label as account_label
FROM request_logs r
LEFT JOIN accounts a ON a.id = r.account_id
WHERE ...
```

Map to response: `accountLabel: row.account_label ?? null`

- [ ] **Step 3: Implement — overview recent includes accountLabel**

In `src/api/admin/overview.ts`, modify the recent query:
```sql
SELECT r.id, r.created_at, r.model, r.status_code, r.cost_usd, r.latency_ms,
       r.client_key_id, r.account_id, a.label as account_label
FROM request_logs r
LEFT JOIN accounts a ON a.id = r.account_id
ORDER BY r.created_at DESC LIMIT 20
```

Map: `accountLabel: row.account_label ?? null`

- [ ] **Step 4: Implement — transport usageCount**

In `src/api/admin/transports.ts`, after fetching transports list, compute usage:
```typescript
// For each transport, count accounts referencing it
const usageCounts = new Map<string, number>();
const accounts = listAccounts(db);
for (const t of transports) {
  let count = 0;
  for (const a of accounts) {
    if (a.proxy_id === t.id || a.relay_id === t.id) { count++; continue; }
    const pool: string[] = a.proxy_pool ? JSON.parse(a.proxy_pool) : [];
    if (pool.includes(t.id)) count++;
  }
  usageCounts.set(t.id, count);
}
// Add to response DTO: usageCount: usageCounts.get(t.id) ?? 0
```

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/api/admin/usage.ts src/api/admin/overview.ts src/api/admin/transports.ts tests/
git commit -m "feat(api): accountLabel in usage/overview + transport usageCount (items F+G+L+M)"
```

---

## Task 5: Frontend — Accounts Transport Column (A)

**Files:**
- Modify: `client/src/pages/Accounts.tsx`

- [ ] **Step 1: Add "Transport" column header after "Backoff"**

In the `<thead>`, add between Backoff and Last error:
```tsx
<th>Transport</th>
```

- [ ] **Step 2: Add transport badge cell in each row**

```tsx
<td>
  {(() => {
    if (a.relayId) {
      const relay = transports.find((t) => t.id === a.relayId);
      return <Badge variant="active">☁ {relay?.label ?? 'relay'}</Badge>;
    }
    if (a.proxyPool && a.proxyPool.length > 0) {
      return <Badge variant="info">🔀 Pool({a.proxyPool.length})</Badge>;
    }
    if (a.proxyId) {
      const proxy = transports.find((t) => t.id === a.proxyId);
      return <Badge variant="info">🔀 {proxy?.label ?? 'proxy'}</Badge>;
    }
    return <Badge variant="muted">Direct</Badge>;
  })()}
</td>
```

- [ ] **Step 3: Verify in browser**

Run: `npm run dev`
Check: Accounts table shows Transport column with correct badges per account.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Accounts.tsx
git commit -m "feat(ui): show transport badge in accounts table (item A)"
```

---

## Task 6: Frontend — Quota Compact Table + Refresh Animation (B+N)

**Files:**
- Modify: `client/src/pages/Quota.tsx`
- Modify: `client/src/styles/components.css`

- [ ] **Step 1: Add refresh spin animation CSS**

In `client/src/styles/components.css`:
```css
.refresh-spin {
  display: inline-block;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.quota-flash {
  animation: flash-border 0.6s ease-out;
}
@keyframes flash-border {
  0% { box-shadow: 0 0 0 2px var(--signal); }
  100% { box-shadow: 0 0 0 0px transparent; }
}
```

- [ ] **Step 2: Redesign Quota page — compact table layout**

Replace the `quotas.map(q => <Card>...)` with a single table:

```tsx
const [expanded, setExpanded] = useState<Set<string>>(new Set());
const toggleExpand = (id: string) => setExpanded((s) => {
  const next = new Set(s);
  next.has(id) ? next.delete(id) : next.add(id);
  return next;
});

// In render:
<Card class={flashClass}>
  <table class="tbl">
    <thead>
      <tr>
        <th></th>
        <th>Account</th>
        <th>Type</th>
        <th>Health</th>
        <th>5h remaining</th>
        <th>Weekly</th>
        <th>Resets in</th>
      </tr>
    </thead>
    <tbody>
      {quotas.map((q) => {
        const worst = worstPercent(q.windows);
        const fiveH = q.windows.find((w) => w.windowType === '5h');
        const weekly = q.windows.find((w) => w.windowType === 'weekly');
        const reset = fiveH?.remainsTime ?? null;
        const isOpen = expanded.has(q.accountId);
        return (
          <>
            <tr key={q.accountId} onClick={() => toggleExpand(q.accountId)} style={{ cursor: 'pointer' }}>
              <td>{isOpen ? '▾' : '▸'}</td>
              <td style={{ fontWeight: 500 }}>{q.label}</td>
              <td><Badge variant={q.creditType === 'token-plan' ? 'warn' : 'active'}>{q.creditType}</Badge></td>
              <td>
                <div class="quota-bar-track" style={{ width: 60 }}>
                  <div class={`quota-bar-fill${worst < 20 ? ' warn' : ''}`} style={{ width: `${worst}%` }} />
                </div>
                <span class={`quota-pct${worst < 20 ? ' warn' : ''}`} style={{ fontSize: 13 }}>{worst}%</span>
              </td>
              <td>{fiveH ? `${pctOf(fiveH)}%` : '—'}</td>
              <td>{weekly ? `${pctOf(weekly)}%` : '—'}</td>
              <td class="mono" style={{ fontSize: 11 }}>{reset != null ? forwardDuration(reset) : '—'}</td>
            </tr>
            {isOpen && (
              <tr key={`${q.accountId}-detail`}>
                <td colSpan={7} style={{ padding: '8px 16px', background: 'var(--surface-2)' }}>
                  {groupByModel(q.windows).map(([model, wins]) => (
                    <ModelBlock key={model} windows={wins} delay={0} />
                  ))}
                </td>
              </tr>
            )}
          </>
        );
      })}
    </tbody>
  </table>
</Card>
```

- [ ] **Step 3: Add worstPercent helper + refresh animation**

```tsx
function worstPercent(windows: QuotaWindow[]): number {
  if (windows.length === 0) return 100;
  return Math.min(...windows.map(pctOf));
}

// Refresh button with spin:
const { isFetching } = useQuery(/* existing */);
// In TopBar actions:
<button
  class="btn btn-ghost btn-sm"
  onClick={() => refetch()}
  aria-label="Refresh quota"
  disabled={isFetching}
>
  <span class={isFetching ? 'refresh-spin' : ''}>↻</span> Refresh
</button>
```

- [ ] **Step 4: Verify in browser**

Compact table renders. Click row → expands detail. Refresh spins. Flash on success.

- [ ] **Step 5: Run client tests**

Run: `npm run test:client`
Expected: PASS (no quota-specific tests, but no regressions)

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/Quota.tsx client/src/styles/components.css
git commit -m "feat(ui): compact quota table + refresh spin animation (items B+N)"
```

---

## Task 7: Frontend — Transports Bulk Import + "Used by" (C+L)

**Files:**
- Modify: `client/src/pages/Transports.tsx`

- [ ] **Step 1: Add "Bulk import" button in TopBar**

```tsx
actions={
  <div style={{ display: 'flex', gap: 8 }}>
    <Button onClick={() => setBulkOpen(true)}>Bulk import</Button>
    <Button onClick={() => setOpen(true)}>+ Add transport</Button>
  </div>
}
```

- [ ] **Step 2: Add bulk import state + modal**

```tsx
const [bulkOpen, setBulkOpen] = useState(false);
const [bulkText, setBulkText] = useState('');
const [bulkKind, setBulkKind] = useState<'http' | 'socks5'>('http');
const [bulkPrefix, setBulkPrefix] = useState('proxy');
const [bulkProgress, setBulkProgress] = useState<{ total: number; done: number; errors: number } | null>(null);

function parseBulkLines(text: string): Array<{ label: string; url: string }> {
  return text.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((line, i) => {
      const parts = line.split(':');
      let url: string;
      if (parts.length === 4) {
        // ip:port:user:pass
        const [ip, port, user, pass] = parts;
        url = `${bulkKind}://${user}:${pass}@${ip}:${port}`;
      } else if (parts.length === 2) {
        // ip:port
        url = `${bulkKind}://${parts[0]}:${parts[1]}`;
      } else if (line.includes('@')) {
        // user:pass@ip:port
        url = `${bulkKind}://${line}`;
      } else {
        url = line; // raw URL
      }
      return { label: `${bulkPrefix}-${i + 1}`, url };
    });
}

const parsed = bulkOpen ? parseBulkLines(bulkText) : [];
```

- [ ] **Step 3: Bulk import modal UI**

```tsx
<Modal open={bulkOpen} onClose={() => { setBulkOpen(false); setBulkProgress(null); }} title="Bulk import proxies" width={520}>
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <label>
      Protocol
      <select value={bulkKind} onChange={(e) => setBulkKind((e.target as HTMLSelectElement).value as 'http' | 'socks5')} class="input">
        <option value="http">HTTP</option>
        <option value="socks5">SOCKS5</option>
      </select>
    </label>
    <label>
      Label prefix
      <input value={bulkPrefix} onInput={(e) => setBulkPrefix((e.target as HTMLInputElement).value)} class="input" placeholder="proxy" />
    </label>
    <label>
      Proxy list (one per line)
      <textarea
        value={bulkText}
        onInput={(e) => setBulkText((e.target as HTMLTextAreaElement).value)}
        class="input"
        style={{ minHeight: 140, fontFamily: 'var(--font-mono)' }}
        placeholder={'ip:port:user:pass\nip:port:user:pass\n# comments ignored'}
      />
    </label>
    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
      Formats: <code>ip:port:user:pass</code> · <code>ip:port</code> · <code>user:pass@ip:port</code>
    </span>
    {parsed.length > 0 && <Badge variant="active">{parsed.length} proxies detected</Badge>}
    {bulkProgress && (
      <div style={{ fontSize: 12 }}>
        Progress: {bulkProgress.done}/{bulkProgress.total}
        {bulkProgress.errors > 0 && <span style={{ color: 'var(--alert)' }}> ({bulkProgress.errors} failed)</span>}
      </div>
    )}
    <Button
      disabled={parsed.length === 0 || bulkProgress !== null}
      onClick={async () => {
        setBulkProgress({ total: parsed.length, done: 0, errors: 0 });
        let done = 0, errors = 0;
        for (const p of parsed) {
          try {
            await apiFetch('/api/admin/transports', { method: 'POST', json: { label: p.label, type: 'proxy', kind: bulkKind, url: p.url } });
          } catch { errors++; }
          done++;
          setBulkProgress({ total: parsed.length, done, errors });
        }
        qc.invalidateQueries({ queryKey: ['transports'] });
        toast.success(`${done - errors}/${parsed.length} imported${errors ? `, ${errors} failed` : ''}`);
        setBulkOpen(false);
        setBulkProgress(null);
        setBulkText('');
      }}
    >
      Import all
    </Button>
  </div>
</Modal>
```

- [ ] **Step 4: Add "Used by" column in transports table**

Add `<th>Used by</th>` and in each row:
```tsx
<td>
  {t.usageCount > 0
    ? <span style={{ fontWeight: 500 }}>{t.usageCount} account{t.usageCount > 1 ? 's' : ''}</span>
    : <span class="card-sub">—</span>
  }
</td>
```

Update the interface: `usageCount: number` and trust the backend now returns it.

- [ ] **Step 5: Verify in browser**

Bulk import modal parses correctly, imports, shows progress. "Used by" column shows counts.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/Transports.tsx
git commit -m "feat(ui): bulk proxy import + 'used by' column (items C+L)"
```

---

## Task 8: Frontend — Settings Selection Strategy Card (D)

**Files:**
- Modify: `client/src/pages/Settings.tsx`

- [ ] **Step 1: Add selection strategy card**

After the MiniMax provider card:
```tsx
const selectionMut = useMutation({
  mutationFn: (mode: string) => apiFetch('/api/admin/settings', { method: 'PATCH', json: { key: 'selection.mode', value: mode } }),
  onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast.success('Selection mode updated'); },
  onError: (e: Error) => toast.error(e.message),
});

// In render:
<Card title="Account selection" sub="How the router picks upstream accounts for each request.">
  <select
    value={data.selection?.mode ?? 'lowest-backoff'}
    onChange={(e) => selectionMut.mutate((e.target as HTMLSelectElement).value)}
    class="input"
    disabled={selectionMut.isPending}
  >
    <option value="lowest-backoff">Lowest backoff (default — healthiest account wins)</option>
    <option value="round-robin">Round-robin (cycle through all available)</option>
    <option value="sticky">Sticky (pin per client key, fallback if unavailable)</option>
  </select>
  <span style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8, display: 'block' }}>
    Lowest-backoff: picks the account with fewest errors. Round-robin: evenly distributes load.
    Sticky: each client key stays on one account until it errors.
  </span>
</Card>
```

- [ ] **Step 2: Add `selection` to SettingsData interface**

```typescript
interface SettingsData {
  caveman: { level: string };
  caching: { autoBreakpoints: boolean };
  rtk: { enabled: boolean };
  minimax: { upstreamFormat?: string };
  selection: { mode: string } | null;
  version: string | null;
}
```

- [ ] **Step 3: Verify in browser + commit**

```bash
git add client/src/pages/Settings.tsx
git commit -m "feat(ui): account selection strategy card in settings (item D)"
```

---

## Task 9: Frontend — Usage Account Column + Filter (F+G)

**Files:**
- Modify: `client/src/pages/Usage.tsx`

- [ ] **Step 1: Add account filter dropdown**

In the filter bar area, add:
```tsx
const { data: accounts = [] } = useQuery({
  queryKey: ['accounts'],
  queryFn: () => apiFetch<Array<{ id: string; label: string }>>('/api/admin/accounts'),
});
const [accountFilter, setAccountFilter] = useState<string>('');

// In the filter row:
<select
  value={accountFilter}
  onChange={(e) => { setAccountFilter((e.target as HTMLSelectElement).value); setPage(1); }}
>
  <option value="">All accounts</option>
  {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
</select>
```

Wire `accountFilter` into the query params: `if (accountFilter) p.set('account_id', accountFilter);`

- [ ] **Step 2: Add "Account" column in table**

After the "Model" `<th>`:
```tsx
<th>Account</th>
```

In each row:
```tsx
<td>{l.accountLabel ?? '—'}</td>
```

Update `UsageLog` interface: `accountLabel: string | null;`

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/Usage.tsx
git commit -m "feat(ui): account column + filter in usage (items F+G)"
```

---

## Task 10: Frontend — Models Bulk Toggle (H)

**Files:**
- Modify: `client/src/pages/Models.tsx`

- [ ] **Step 1: Add checkbox state + bulk toolbar**

```tsx
const [selected, setSelected] = useState<Set<string>>(new Set());
const toggleSelect = (name: string) => setSelected((s) => {
  const next = new Set(s);
  next.has(name) ? next.delete(name) : next.add(name);
  return next;
});
const selectAll = () => setSelected(new Set(filtered.map((m) => m.name)));
const clearSelection = () => setSelected(new Set());

const bulkMut = useMutation({
  mutationFn: (enabled: boolean) =>
    apiFetch('/api/admin/models/bulk-toggle', { method: 'POST', json: { names: [...selected], enabled } }),
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['models'] });
    toast.success(`${selected.size} models updated`);
    clearSelection();
  },
  onError: (e: Error) => toast.error(e.message),
});
```

- [ ] **Step 2: Add checkbox column + floating toolbar**

In thead:
```tsx
<th style={{ width: 32 }}>
  <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={() => selected.size === filtered.length ? clearSelection() : selectAll()} />
</th>
```

In each row:
```tsx
<td><input type="checkbox" checked={selected.has(m.name)} onChange={() => toggleSelect(m.name)} /></td>
```

Floating toolbar (above table when selection > 0):
```tsx
{selected.size > 0 && (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, marginBottom: 8 }}>
    <span style={{ fontSize: 13 }}>{selected.size} selected</span>
    <Button size="sm" onClick={() => bulkMut.mutate(true)}>Enable all</Button>
    <Button size="sm" variant="danger" onClick={() => bulkMut.mutate(false)}>Disable all</Button>
    <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/Models.tsx
git commit -m "feat(ui): bulk enable/disable models with checkbox toolbar (item H)"
```

---

## Task 11: Frontend — Client Keys Inline Edit (I)

**Files:**
- Modify: `client/src/pages/ClientKeys.tsx`

- [ ] **Step 1: Add inline edit state + mutation**

```tsx
const [editingLabel, setEditingLabel] = useState<number | null>(null);
const [editValue, setEditValue] = useState('');

const labelMut = useMutation({
  mutationFn: ({ id, label }: { id: number; label: string }) =>
    apiFetch(`/api/admin/client-keys/${id}`, { method: 'PATCH', json: { label } }),
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['client-keys'] });
    setEditingLabel(null);
    toast.success('Label updated');
  },
  onError: (e: Error) => toast.error(e.message),
});
```

- [ ] **Step 2: Replace label cell with editable version**

```tsx
<td onDblClick={() => { setEditingLabel(k.id); setEditValue(k.label); }}>
  {editingLabel === k.id ? (
    <input
      value={editValue}
      onInput={(e) => setEditValue((e.target as HTMLInputElement).value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') labelMut.mutate({ id: k.id, label: editValue });
        if (e.key === 'Escape') setEditingLabel(null);
      }}
      onBlur={() => setEditingLabel(null)}
      class="input"
      style={{ padding: '2px 6px', fontSize: 13 }}
      autoFocus
    />
  ) : (
    <span style={{ cursor: 'text' }} title="Double-click to edit">{k.label}</span>
  )}
</td>
```

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/ClientKeys.tsx
git commit -m "feat(ui): inline edit label for client keys (item I)"
```

---

## Task 12: Frontend — Console Filter Bar (J)

**Files:**
- Modify: `client/src/pages/Console.tsx`

- [ ] **Step 1: Add filter state**

```tsx
const [filterModel, setFilterModel] = useState('');
const [filterStatus, setFilterStatus] = useState<'all' | 'success' | 'error'>('all');
const [filterAccount, setFilterAccount] = useState('');
```

- [ ] **Step 2: Add filter bar UI below TopBar**

```tsx
<div style={{ display: 'flex', gap: 8, padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
  <input
    type="text"
    placeholder="Filter model…"
    value={filterModel}
    onInput={(e) => setFilterModel((e.target as HTMLInputElement).value)}
    class="input"
    style={{ maxWidth: 160, padding: '4px 8px', fontSize: 12 }}
  />
  <input
    type="text"
    placeholder="Filter account…"
    value={filterAccount}
    onInput={(e) => setFilterAccount((e.target as HTMLInputElement).value)}
    class="input"
    style={{ maxWidth: 140, padding: '4px 8px', fontSize: 12 }}
  />
  <select
    value={filterStatus}
    onChange={(e) => setFilterStatus((e.target as HTMLSelectElement).value as 'all' | 'success' | 'error')}
    style={{ padding: '4px 8px', fontSize: 12 }}
  >
    <option value="all">All status</option>
    <option value="success">Success</option>
    <option value="error">Errors</option>
  </select>
  {(filterModel || filterAccount || filterStatus !== 'all') && (
    <span style={{ fontSize: 11, color: 'var(--text-3)', alignSelf: 'center' }}>
      {filteredEvents.length} events shown
    </span>
  )}
</div>
```

- [ ] **Step 3: Apply filter to events before rendering**

```tsx
const filteredEvents = useMemo(() => {
  if (!filterModel && !filterAccount && filterStatus === 'all') return events;
  return events.filter((e) => {
    if (filterModel && e.phase === 'start' && !e.model?.toLowerCase().includes(filterModel.toLowerCase())) return false;
    if (filterAccount && e.phase === 'account' && !e.accountLabel?.toLowerCase().includes(filterAccount.toLowerCase())) return false;
    if (filterStatus === 'success' && e.phase === 'done' && e.status >= 400) return false;
    if (filterStatus === 'error' && e.phase === 'done' && e.status < 400) return false;
    return true;
  });
}, [events, filterModel, filterAccount, filterStatus]);

// Pass filteredEvents to ConsoleBlocks:
<ConsoleBlocks events={filteredEvents} />
```

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Console.tsx
git commit -m "feat(ui): console filter bar — model/account/status (item J)"
```

---

## Task 13: Frontend — Overview Account Column (M)

**Files:**
- Modify: `client/src/pages/Overview.tsx`

- [ ] **Step 1: Add Account column to recent table**

In the "Recent requests" table thead, after Model:
```tsx
<th>Account</th>
```

In tbody:
```tsx
<td>{r.accountLabel ?? '—'}</td>
```

Update the interface:
```typescript
recent: Array<{
  // ... existing fields
  accountLabel: string | null;
}>;
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/Overview.tsx
git commit -m "feat(ui): account column in overview recent table (item M)"
```

---

## Task 14: Frontend — Alias Shadowing Indicators (O)

**Files:**
- Modify: `client/src/pages/Aliases.tsx`
- Modify: `client/src/pages/Models.tsx`

- [ ] **Step 1: Aliases page — show shadow warning in create/edit modal**

In `AliasModal`, after the alias name input, add:
```tsx
{name && models.some((m) => m.name === name) && (
  <span style={{ fontSize: 11, color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: 4 }}>
    ⚡ This alias will shadow built-in model "{name}". Requests for this name route to the alias target.
  </span>
)}
```

- [ ] **Step 2: Models page — show "shadowed" badge**

Fetch aliases list:
```tsx
const { data: aliases = [] } = useQuery({
  queryKey: ['aliases'],
  queryFn: () => apiFetch<{ aliases: Array<{ aliasName: string }> }>('/api/admin/aliases').then((r) => r.aliases),
});
const shadowedNames = new Set(aliases.filter((a) => filtered.some((m) => m.name === a.aliasName)).map((a) => a.aliasName));
```

In each model row, after the name:
```tsx
<td class="mono">
  {m.name}
  {shadowedNames.has(m.name) && <Badge variant="muted" style={{ marginLeft: 6, fontSize: 9 }}>⚡ shadowed</Badge>}
</td>
```

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/Aliases.tsx client/src/pages/Models.tsx
git commit -m "feat(ui): alias shadowing indicators on models + alias create (item O)"
```

---

## Task 15: Final — Typecheck + Lint + Full Test Run

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 2: Lint**

Run: `npm run lint:fix`
Expected: clean

- [ ] **Step 3: Full test suite**

Run: `npm test && npm run test:client`
Expected: ALL PASS

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`
Walk each page: Accounts → Transport badge visible. Quota → compact table, click expand, refresh spins. Transports → Bulk import works, "Used by" shows. Settings → Selection strategy dropdown. Usage → Account column + filter. Models → bulk checkbox. Console → filter bar works. Overview → account in recent. Aliases → shadow warning on matching model name.

- [ ] **Step 5: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: lint + typecheck pass after UX audit implementation"
```
