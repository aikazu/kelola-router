# 2026-06-19 Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the remaining 6 fixes from the 2026-06-19 audit spec (`docs/superpowers/specs/2026-06-19-audit-fixes-design.md`): A4 (manual POST family), A5 (quota parallel), A6 (admin cache invalidation), A7 (settings null), B1 (combo/alias symmetry), B2 (alias source update). A1/A2/A3 are already fixed in `src/db/repos/models.ts`, `src/api/admin/models.ts`, `src/api/admin/usage.ts`, `src/db/repos/requestLogs.ts`.

**Architecture:** Targeted patches per finding. TDD per task — failing test first, then minimal fix, then regression assertion. No new dependencies. No schema migration. All changes land in `src/db/repos/`, `src/api/admin/`, `src/db/repos/requestLogs.ts`, `client/src/components/settings/`. Each task produces one commit.

**Tech Stack:** Hono (admin API), valibot (input validation), better-sqlite3 (data layer), Preact + TanStack Query (dashboard), vitest + happy-dom (tests).

---

### Task 1: A4 — Manual POST `/api/admin/models` accepts and persists `family`

**Files:**
- Modify: `src/api/admin/models.ts:88-97` (the `POST /` handler)
- Test: `src/api/admin/models.test.ts`

**Context.** The manual model insert path currently omits the `family` column. New admin-created rows have `family = NULL`, which breaks `ADAPTIVE_THINKING_MODELS` matching and per-family dashboard grouping.

- [ ] **Step 1: Write the failing test**

Add to `src/api/admin/models.test.ts` (the file already tests the POST route — find the matching `describe` block):

```typescript
it('persists family on manual POST /api/admin/models', async () => {
  const db = openDb();
  const app = createAdminApp(db);
  const res = await app.request('/api/admin/models', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({
      name: 'my-custom-model',
      displayName: 'My Custom',
      provider: 'minimax',
      contextWindow: 32000,
      pricingInput: 1,
      pricingOutput: 2,
      family: 'custom',
    }),
  });
  expect(res.status).toBe(201);
  const row = getModel(db, 'my-custom-model');
  expect(row?.family).toBe('custom');
});

it('leaves family null when omitted on manual POST', async () => {
  const db = openDb();
  const app = createAdminApp(db);
  const res = await app.request('/api/admin/models', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({
      name: 'no-family-model',
      displayName: 'No Family',
      provider: 'minimax',
    }),
  });
  expect(res.status).toBe(201);
  const row = getModel(db, 'no-family-model');
  expect(row?.family).toBeNull();
});
```

(Adjust helper names — `openDb`, `createAdminApp`, `csrf`, `getModel` — to match what's already imported in the test file. Re-use the existing csrf-token fixture if one exists.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/admin/models.test.ts -t "persists family"`
Expected: FAIL — `family` column comes back `null` for the first case.

- [ ] **Step 3: Implement the fix**

In `src/api/admin/models.ts`, inside the `POST /` handler around line 88-97, add `family` to the `upsertModel` call:

```typescript
upsertModel(db, {
  name,
  upstream_model: name,
  display_name: body.displayName?.trim() || null,
  context_window: typeof body.contextWindow === 'number' ? body.contextWindow : null,
  pricing_input: typeof body.pricingInput === 'number' ? body.pricingInput : null,
  pricing_output: typeof body.pricingOutput === 'number' ? body.pricingOutput : null,
  provider: body.provider as (typeof ALLOWED_PROVIDERS)[number],
  source: 'manual',
  family: typeof body.family === 'string' && body.family.trim() ? body.family.trim() : null,
});
```

No type changes needed — `family` is already in `ModelUpsert` (`Partial<Model>`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/admin/models.test.ts`
Expected: All tests pass, including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add src/api/admin/models.ts src/api/admin/models.test.ts
git commit -m "fix(api): persist family on manual model insert"
```

---

### Task 2: A5 — Quota endpoint uses `Promise.allSettled` for per-account parallel fetch

**Files:**
- Modify: `src/api/admin/quota.ts`
- Test: `src/api/admin/quota.test.ts`

**Context.** `src/api/admin/quota.ts:21-24` `await`s `ensureAccessToken` + `fetchKiroUsage` sequentially per Kiro account. With N accounts the response time is N × round-trip. A single broken token 502s the entire endpoint, hiding healthy accounts. The fix parallelises via `Promise.allSettled` and returns a per-account result shape.

- [ ] **Step 1: Read the existing quota route to confirm structure**

Read `src/api/admin/quota.ts` end-to-end. Identify:
- The current loop structure (`for (const a of accounts) { ... await ensureAccessToken; ... await fetchKiroUsage; ... }`)
- The current response shape (what fields it returns)
- How `handleApiError` is invoked

Also read `src/providers/kiro/usage.ts` and `src/providers/kiro/auth.ts` to understand the inputs/outputs.

- [ ] **Step 2: Write the failing tests**

Add to `src/api/admin/quota.test.ts`:

```typescript
it('returns per-account results in parallel even if one account fails', async () => {
  const db = openDb();
  // Seed two Kiro accounts: one healthy, one with a refresh token that
  // ensureAccessToken will reject.
  const healthyId = createAccount(db, {
    id: 'acc_healthy',
    label: 'healthy',
    credit_type: 'token-plan',
    api_key: 'valid-refresh-token',
    base_url: null,
    provider: 'kiro',
  });
  const brokenId = createAccount(db, {
    id: 'acc_broken',
    label: 'broken',
    credit_type: 'token-plan',
    api_key: 'definitely-invalid-token',
    base_url: null,
    provider: 'kiro',
  });

  // Mock fetchKiroUsage to return a fixed shape for the healthy account
  // and reject for the broken account.
  vi.spyOn(kiroUsage, 'fetchKiroUsage').mockImplementation(async (token) => {
    if (token === 'mock-bearer-for-healthy') {
      return { windows: [{ name: 'monthly', used: 10, limit: 100 }] };
    }
    throw new Error('upstream 401');
  });
  // Mock ensureAccessToken to map accountId -> bearer.
  vi.spyOn(kiroAuth, 'ensureAccessToken').mockImplementation(async (_db, account) => {
    if (account.id === 'acc_healthy') {
      return { accessToken: 'mock-bearer-for-healthy', expiresAt: '2099-01-01' };
    }
    throw new Error('refresh failed');
  });

  const app = createAdminApp(db);
  const res = await app.request('/api/admin/quota');
  expect(res.status).toBe(200); // NOT 502
  const body = (await res.json()) as { accounts: Array<{ accountId: string; ok: boolean; windows?: unknown; error?: string }> };
  expect(body.accounts).toHaveLength(2);
  const healthy = body.accounts.find((a) => a.accountId === 'acc_healthy');
  const broken = body.accounts.find((a) => a.accountId === 'acc_broken');
  expect(healthy?.ok).toBe(true);
  expect(healthy?.windows).toBeDefined();
  expect(broken?.ok).toBe(false);
  expect(broken?.error).toMatch(/refresh failed/);
});
```

Adjust imports + helper names to match the existing test file. Mock `fetchKiroUsage` and `ensureAccessToken` from the actual modules.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/api/admin/quota.test.ts -t "per-account results"`
Expected: FAIL — current endpoint returns 502 (broken await chain) and doesn't have an `accounts[]` shape.

- [ ] **Step 4: Refactor `quota.ts` to parallel + per-account shape**

Rewrite the loop in `src/api/admin/quota.ts` to:

```typescript
const results = await Promise.allSettled(
  accounts.map(async (account) => {
    try {
      const auth = await ensureAccessToken(db, account);
      const usage = await fetchKiroUsage(auth.accessToken, {
        region,
        profileArn,
      });
      return { accountId: account.id, ok: true as const, windows: usage.windows };
    } catch (e) {
      return {
        accountId: account.id,
        ok: false as const,
        error: (e as Error).message,
      };
    }
  })
);

const accounts_result = results.map((r) =>
  r.status === 'fulfilled' ? r.value : { accountId: 'unknown', ok: false, error: r.reason?.message ?? 'unknown' }
);

return c.json({ accounts: accounts_result });
```

Preserve the existing region / profileArn lookup logic that precedes the loop.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/api/admin/quota.test.ts`
Expected: All tests pass.

- [ ] **Step 6: Update client to consume new shape**

Read `client/src/components/quota/QuotaPanel.tsx` (or wherever quota is rendered). The client likely reads `res.windows` directly. Update it to iterate `res.accounts[]` and render per-account (with error state inline). Match the existing visual style.

- [ ] **Step 7: Commit**

```bash
git add src/api/admin/quota.ts src/api/admin/quota.test.ts client/src/components/quota/QuotaPanel.tsx
git commit -m "fix(quota): parallel per-account fetch + per-account error shape"
```

---

### Task 3: A6 — Admin cache: drop TTL to 250 ms and add `bumpAdminCacheVersion`

**Files:**
- Modify: `src/api/admin/cache.ts`
- Modify: `src/db/repos/requestLogs.ts` (call `bumpAdminCacheVersion` after flush)
- Test: `src/api/admin/cache.test.ts` (new file)

**Context.** `getAdminCached` / `setAdminCached` use a 1 s TTL. Writes within that window are hidden from overview, usage, quota. Reduce TTL and add an explicit invalidation hook fired from the deferred-queue flush.

- [ ] **Step 1: Write the failing tests**

Create `src/api/admin/cache.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../db/index.js';
import { insertRequestLogDeferred } from '../db/repos/requestLogs.js';
import { bumpAdminCacheVersion, getAdminCached, setAdminCached } from './cache.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'cache-')), 't.db');
});

describe('admin cache invalidation', () => {
  it('drops TTL to 250 ms', async () => {
    const db = openDb();
    setAdminCached('k', { v: 1 });
    expect(getAdminCached<{ v: number }>('k')?.v).toBe(1);
    await new Promise((r) => setTimeout(r, 260));
    expect(getAdminCached<{ v: number }>('k')).toBeUndefined();
  });

  it('bumpAdminCacheVersion invalidates immediately', () => {
    setAdminCached('k', { v: 1 });
    expect(getAdminCached('k')).toBeDefined();
    bumpAdminCacheVersion();
    expect(getAdminCached('k')).toBeUndefined();
  });

  it('insertRequestLogDeferred bumps the cache version', () => {
    setAdminCached('k', { v: 1 });
    insertRequestLogDeferred(openDb(), {
      // minimal valid shape — see src/db/repos/requestLogs.ts RequestLogInsert
      clientKeyId: null,
      accountId: null,
      model: 'm',
      requestedModel: 'm',
      endpoint: '/v1/chat/completions',
      format: 'openai',
      promptTokens: 0,
      completionTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      latencyMs: 0,
      statusCode: 200,
      stream: 0,
    });
    expect(getAdminCached('k')).toBeUndefined();
  });
});
```

Inspect `RequestLogInsert` shape in `src/db/repos/requestLogs.ts` and adjust field names to match exactly.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/admin/cache.test.ts`
Expected: FAIL — `bumpAdminCacheVersion` doesn't exist yet.

- [ ] **Step 3: Update `src/api/admin/cache.ts`**

Replace the TTL default and add `bumpAdminCacheVersion`:

```typescript
const DEFAULT_TTL_MS = 250;

let cacheVersion = 0;

export function bumpAdminCacheVersion(): void {
  cacheVersion++;
}

export function getAdminCached<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.version !== cacheVersion) return undefined;
  if (Date.now() > entry.expiresAt) return undefined;
  return entry.value as T;
}

export function setAdminCached<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): T {
  store.set(key, { value, expiresAt: Date.now() + ttlMs, version: cacheVersion });
  return value;
}
```

Preserve the existing in-memory `store` and any types/interfaces. Add `version` to the entry shape.

- [ ] **Step 4: Hook `bumpAdminCacheVersion` into `insertRequestLogDeferred` flush**

In `src/db/repos/requestLogs.ts`, find the deferred-queue flush function (the one that drains `queue` and writes to SQLite). After the flush completes successfully, call `bumpAdminCacheVersion()` from `../../api/admin/cache.js`.

Note: `requestLogs.ts` lives in `src/db/repos/`. The cache lives in `src/api/admin/`. To avoid a circular import, expose a small hook registry or call `bumpAdminCacheVersion` lazily. The simplest approach: import the function lazily inside the flush body (`const { bumpAdminCacheVersion } = await import('../../api/admin/cache.js')`). Alternatively, move `bumpAdminCacheVersion` to a shared module like `src/db/hooks.ts` and re-export from `cache.ts`.

Recommended: extract `bumpAdminCacheVersion` to `src/db/hooks.ts`, have `cache.ts` and `requestLogs.ts` both import from there. Keep the cache state private to `cache.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/api/admin/cache.test.ts`
Expected: All 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/api/admin/cache.ts src/api/admin/cache.test.ts src/db/repos/requestLogs.ts
git commit -m "fix(cache): 250ms TTL + explicit invalidation on log write"
```

---

### Task 4: A7 — Settings endpoint returns `null` for missing keys; client merges defaults

**Files:**
- Modify: `src/api/admin/settings.ts:9-23`
- Modify: `client/src/components/settings/SettingsPanel.tsx` (or wherever the settings GET is consumed)
- Test: `src/api/admin/settings.test.ts`

**Context.** Settings GET returns default objects inline (`?? { level: 'off' }`). The client can't distinguish "user set default" from "key never written". Audit / debugging requires hitting the DB. Fix: server returns `null`, client merges defaults.

- [ ] **Step 1: Read the existing test + client panel**

Read `src/api/admin/settings.test.ts` (if it exists) and `client/src/components/settings/SettingsPanel.tsx`. Note current assertions + how `caveman`/`caching`/`rtk`/`minimax` are consumed.

- [ ] **Step 2: Write the failing test**

Add to `src/api/admin/settings.test.ts`:

```typescript
it('returns null for never-written keys', async () => {
  const db = openDb();
  const app = createAdminApp(db);
  const res = await app.request('/api/admin/settings');
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.caveman).toBeNull();
  expect(body.caching).toBeNull();
  expect(body.rtk).toBeNull();
  expect(body.minimax).toBeNull();
});
```

(Adjust the helper names to match existing test file imports.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/api/admin/settings.test.ts -t "never-written"`
Expected: FAIL — current response returns default objects, not null.

- [ ] **Step 4: Fix server**

In `src/api/admin/settings.ts`:

```typescript
settingsRoutes.get('/', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const build = getSettingT(db, 'build');
    return c.json({
      caveman: getSettingT(db, 'caveman') ?? null,
      caching: getSettingT(db, 'caching') ?? null,
      rtk: getSettingT(db, 'rtk') ?? null,
      minimax: getSettingT(db, 'minimax') ?? null,
      version: build?.version ?? null,
    });
  } catch (e) {
    return handleApiError(e);
  }
});
```

- [ ] **Step 5: Fix client**

In `client/src/components/settings/SettingsPanel.tsx` (or wherever the response is read), apply defaults client-side:

```typescript
const SETTINGS_DEFAULTS = {
  caveman: { level: 'off' },
  caching: { autoBreakpoints: true },
  rtk: { enabled: true, minCompressSize: 500, rawCap: 10485760, filters: ['smart-truncate', 'dedup-log'] },
  minimax: {},
};

const merged = { ...SETTINGS_DEFAULTS, ...(apiResponse ?? {}) };
// Then use merged.caveman etc.
```

Match the merge logic to wherever the current code consumes the values. The important invariant: behaviour for the user is identical (defaults applied), but the server now returns `null` for missing keys.

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/api/admin/settings.test.ts && cd client && npm test 2>&1 | tail -30`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/api/admin/settings.ts src/api/admin/settings.test.ts client/src/components/settings/SettingsPanel.tsx
git commit -m "fix(settings): return null for missing keys; client merges defaults"
```

---

### Task 5: B1 — Combo/alias name uniqueness enforced both directions

**Files:**
- Modify: `src/db/repos/combos.ts:36` (export `checkComboConflict` from aliases.ts direction)
- Modify: `src/db/repos/aliases.ts:47-65` (call the combo check in `upsertAlias`)
- Test: `src/db/repos/aliases.test.ts` (new case)

**Context.** `checkAliasConflict` runs on combo insert + rename but the reverse — `upsertAlias` checking if a combo owns the name — is missing. Per ADR 0008, the invariant is "names unique across the bare namespace." The reverse direction violates it.

- [ ] **Step 1: Write the failing test**

Add to `src/db/repos/aliases.test.ts`:

```typescript
it('upsertAlias rejects when a combo already owns the name', () => {
  const db = openDb();
  createCombo(db, 'shared-name', ['mm/MiniMax-M3']);
  expect(() => upsertAlias(db, { aliasName: 'shared-name', upstreamModel: 'mm/MiniMax-M3' })).toThrow(/combo|conflict|shadow/i);
});
```

(Adjust imports + match the actual error message format used in `createCombo`'s `checkAliasConflict`. Use the same wording so the assertion is meaningful.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/repos/aliases.test.ts -t "rejects when a combo"`
Expected: FAIL — current `upsertAlias` doesn't check combos, so the insert succeeds.

- [ ] **Step 3: Add `checkComboConflict` and call it from `upsertAlias`**

In `src/db/repos/combos.ts`, add (mirroring the existing `checkAliasConflict`):

```typescript
export function checkComboConflict(db: Database.Database, name: string): void {
  const row = db.prepare(`SELECT 1 FROM combos WHERE name = ? LIMIT 1`).get(name);
  if (row) {
    throw new Error(`combo name '${name}' already exists; alias cannot shadow combo`);
  }
}
```

In `src/db/repos/aliases.ts`, add the import and call:

```typescript
import { checkComboConflict } from './combos.js';

// ...inside upsertAlias, before the INSERT branch:
checkComboConflict(db, name);
```

Place the check at the top of `upsertAlias` so it fires for both insert and update paths.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/repos/aliases.test.ts`
Expected: All pass, including the new one and the existing "alias blocks combo" test.

- [ ] **Step 5: Commit**

```bash
git add src/db/repos/combos.ts src/db/repos/aliases.ts src/db/repos/aliases.test.ts
git commit -m "fix(aliases): enforce combo-name uniqueness on alias insert"
```

---

### Task 6: B2 — `upsertAlias` updates `source` on existing rows

**Files:**
- Modify: `src/db/repos/aliases.ts:51-55`
- Test: `src/db/repos/aliases.test.ts` (new case)

**Context.** `upsertAlias` UPDATE only sets `upstream_model` and `label`. A row originally inserted with `source: 'seed'` stays seed-tagged even after a user edit. Audit noise.

- [ ] **Step 1: Write the failing test**

Add to `src/db/repos/aliases.test.ts`:

```typescript
it('upsertAlias updates source on existing rows', () => {
  const db = openDb();
  upsertAlias(db, { aliasName: 'a', upstreamModel: 'mm/MiniMax-M3', source: 'seed' });
  upsertAlias(db, { aliasName: 'a', upstreamModel: 'mm/MiniMax-M3', source: 'user' });
  const row = getAlias(db, 'a');
  expect(row?.source).toBe('user');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/repos/aliases.test.ts -t "updates source"`
Expected: FAIL — current UPDATE does not include `source`.

- [ ] **Step 3: Fix `upsertAlias`**

In `src/db/repos/aliases.ts`:

```typescript
if (existing) {
  db.prepare(`
    UPDATE model_aliases
       SET upstream_model = ?, label = ?, source = ?
     WHERE alias_name = ?
  `).run(args.upstreamModel, args.label ?? null, args.source ?? 'user', name);
} else {
  // ...existing INSERT unchanged
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/repos/aliases.test.ts`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/db/repos/aliases.ts src/db/repos/aliases.test.ts
git commit -m "fix(aliases): update source on alias upsert"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run the full server test suite**

Run: `npx vitest run`
Expected: All tests pass. (Same suite that passed after A1/A2/A3 earlier.)

- [ ] **Step 2: Run client tests**

Run: `cd client && npm test 2>&1 | tail -30`
Expected: All client tests pass.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Rebuild + restart docker**

```bash
docker compose build --no-cache router
docker compose up -d
curl -s -o /dev/null -w "healthz: HTTP %{http_code}\n" http://127.0.0.1:20137/healthz
```

Expected: `healthz: HTTP 200`. New container has all 6 fixes baked in.

- [ ] **Step 5: Commit any pending changes (none expected)**

If `git status` is clean, skip. Otherwise commit any leftovers from the verification step.

---

## Self-review notes

**Spec coverage:**
- A4 (manual POST family) → Task 1 ✓
- A5 (quota parallel) → Task 2 ✓
- A6 (admin cache invalidation) → Task 3 ✓
- A7 (settings null vs {}) → Task 4 ✓
- B1 (combo/alias symmetry) → Task 5 ✓
- B2 (alias source update) → Task 6 ✓
- A1, A2, A3 — already fixed in session (no task needed; spec marks them FIXED)

**Placeholder scan:** All steps show actual code. No "TODO", "TBD", "implement later", or "similar to Task N".

**Type consistency:**
- `upsertAlias` import / signature consistent across Tasks 5 + 6
- `checkComboConflict` export name used consistently
- `bumpAdminCacheVersion` symbol consistent across cache.ts + requestLogs.ts (extracted to `src/db/hooks.ts` per Task 3 Step 4)

**Out of scope intentionally:**
- Refactoring `upsertModel` to a service class
- Admin UI changes beyond A7's default-merge
- Any new test framework / harness