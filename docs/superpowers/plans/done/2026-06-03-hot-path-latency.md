# Hot-Path Latency Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the per-request work the router does on top of raw MiniMax latency, keeping request tracking 100% intact and all observable behavior identical.

**Architecture:** Targeted optimizations inside the existing `handleProxy` pipeline and a few `src/db/repos/*` modules. No API, route, format, or schema change. Each task is TDD: red test → minimal change → green → commit. Spec: `docs/superpowers/specs/2026-06-03-hot-path-latency-design.md`.

**Tech Stack:** Node 20+, TypeScript (strict, no `any`), Hono, better-sqlite3, Vitest.

---

## Notes for the implementer (read first)

- **Test isolation:** every test sets `process.env.ROUTER_DB_PATH = join(mkdtempSync(tmpdir()+sep), "t.db")` in `beforeEach`, then `resetDb()` (from `src/server.ts`) for integration tests touching the Hono app. Use a fresh db handle per test for a clean settings/per-db cache.
- **Seeding models in tests:** there is NO `seedModels` export. The existing suite seeds with `upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3' })` from `src/db/repos/models.js`. Use that pattern everywhere a model is needed. (The `scripts/seed-models.ts` file is the CLI seeder, not a test helper.)
- **All builtin models are thinking-capable** (M3 + M2.x are all in `ADAPTIVE_THINKING_MODELS`, `src/providers/alias.ts`). There is no non-thinking builtin. So `resolveModel().bodyTransform` injects `thinking: { type: 'adaptive' }` unless the client already sent `thinking`. For the fast-path equivalence test (Task 7), the client body MUST already include `thinking` (and, for M3, `max_completion_tokens` or `max_tokens`) so the transform is a genuine no-op.
- **Settings cache:** `getSetting` caches per-db for 1s (`src/db/repos/settings.ts`). When changing a setting mid-test, open a fresh db or wait out the TTL.
- **Upstream mock:** `vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(...)))` — use `mockImplementation` (not `mockResolvedValueOnce`) when fetch is called more than once, because `Response` bodies are single-read.
- **CSRF:** integration POSTs to `/admin/*` must set `Origin` matching `Host` or omit `Origin`. `/v1/*` is unaffected.
- **Commands:** single test file `npx vitest run path/to/foo.test.ts`; single test name `npx vitest run -t "name"`; full server suite `npm test`; types `npm run typecheck`; lint `npm run lint`.
- **`better-sqlite3` returns `undefined` for missing rows** — repos coerce to `null` with `?? null`.
- Original Step 1 (custom prepared-statement cache) was **dropped**: better-sqlite3 already caches prepared statements by SQL internally. Task numbering below skips it intentionally.

---

## Task 0: Baseline benchmark harness

**Files:**
- Create: `tests/bench/hotpath.bench.test.ts`

Goal: an evidence artifact that counts SQLite statements executed and measures router overhead per proxied request against an instant fake upstream. Run before and after the optimization tasks; it is NOT a correctness gate (no hard asserts on numbers), it logs them.

- [ ] **Step 1: Write the harness test**

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { app, resetDb } from '../../src/server.js';
import { createAccount } from '../../src/db/repos/accounts.js';
import { createClientKey, genClientKey } from '../../src/db/repos/client_keys.js';
import { openDb } from '../../src/db/index.js';
import { upsertModel } from '../../src/db/repos/models.js';

let key: string;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'bench') + sep), 't.db');
  resetDb();
  const db = openDb();
  upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3' });
  createAccount(db, { id: 'acc_1', label: 'a', credit_type: 'payg', api_key: 'mm_x' });
  key = genClientKey();
  createClientKey(db, { label: 'app', key });
  db.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('measures statements + overhead per request', async () => {
  // Count SQLite statements by wrapping Database.prototype.prepare.
  const realPrepare = Database.prototype.prepare;
  let stmtRuns = 0;
  vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (this: any, sql: string) {
    const stmt = realPrepare.call(this, sql);
    for (const m of ['run', 'get', 'all'] as const) {
      const orig = (stmt as any)[m].bind(stmt);
      (stmt as any)[m] = (...args: any[]) => {
        stmtRuns++;
        return orig(...args);
      };
    }
    return stmt;
  });

  vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ id: 'x', choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
  );

  const make = () =>
    app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] }),
    });

  await make(); // warm caches
  stmtRuns = 0;
  const t0 = performance.now();
  const res = await make();
  const overheadMs = performance.now() - t0;
  expect(res.status).toBe(200);
  // Allow log flush to settle (deferred insert task adds async write).
  await new Promise((r) => setTimeout(r, 50));

  console.log(`[bench] sqlite statement executions (warm): ${stmtRuns}`);
  console.log(`[bench] router overhead (fake upstream): ${overheadMs.toFixed(2)}ms`);
  expect(stmtRuns).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run it, record the baseline numbers**

Run: `npx vitest run tests/bench/hotpath.bench.test.ts`
Expected: PASS. Copy the two `[bench]` log lines into the PR / commit body as the BEFORE baseline.

> `MiniMax-M3` is seeded via `upsertModel` above (the suite-wide pattern). If the proxy returns 400 `unknown model`, the upsert didn't run on the same db path — confirm `ROUTER_DB_PATH` is set before `openDb()`.

- [ ] **Step 3: Commit**

```bash
git add tests/bench/hotpath.bench.test.ts
git commit -m "test(bench): add hot-path baseline harness (statement count + overhead)"
```

---

## Task 2: Batch settings read

**Files:**
- Modify: `src/db/repos/settings.ts`
- Test: `src/db/repos/settings.test.ts` (append) or new `src/db/repos/settings-batch.test.ts`
- Modify: `src/server.ts` (call once at top of `handleProxy`)

`getAllSettings(db)` loads every settings row in one query and warms the per-db cache, so the 6 `getSetting` calls per request hit the cache.

- [ ] **Step 1: Write the failing test**

Create `src/db/repos/settings-batch.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { openDb } from '../index.js';
import { getAllSettings, getSetting, setSetting } from './settings.js';

let db: ReturnType<typeof openDb>;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'set') + sep), 't.db');
  db = openDb();
});

it('returns all settings as an object', () => {
  setSetting(db, 'rtk', { enabled: true });
  setSetting(db, 'caveman', { level: 'full' });
  const all = getAllSettings(db);
  expect(all.rtk).toEqual({ enabled: true });
  expect(all.caveman).toEqual({ level: 'full' });
});

it('warms the per-db cache so subsequent getSetting needs no new query', () => {
  setSetting(db, 'minimax', { upstreamFormat: 'auto' });
  getAllSettings(db); // warms cache
  // Tamper the row directly; cached getSetting should still return the warmed value within TTL.
  db.prepare("UPDATE settings SET value = ? WHERE key = 'minimax'").run(JSON.stringify({ upstreamFormat: 'openai' }));
  expect(getSetting(db, 'minimax')).toEqual({ upstreamFormat: 'auto' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/repos/settings-batch.test.ts`
Expected: FAIL — `getAllSettings is not a function`.

- [ ] **Step 3: Implement `getAllSettings`**

In `src/db/repos/settings.ts`, add after `getSetting`:

```ts
export function getAllSettings(db: Database.Database): Record<string, unknown> {
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string }[];
  const c = getCache(db);
  const expiry = Date.now() + TTL_MS;
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    const value = JSON.parse(row.value);
    c.set(row.key, { value, expiry });
    out[row.key] = value;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/repos/settings-batch.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into the proxy**

In `src/server.ts`, inside `handleProxy`, right after `const db = c.get('db');` (currently line ~115), add:

```ts
  getAllSettings(db); // warm per-db settings cache: one query instead of 6 lookups
```

And add `getAllSettings` to the existing import from `./db/repos/settings.js`:

```ts
import { getAllSettings, getSetting, setSetting } from './db/repos/settings.js';
```

- [ ] **Step 6: Run the full server suite**

Run: `npm test`
Expected: PASS (no regressions). Then `npm run typecheck` → no errors.

- [ ] **Step 7: Commit**

```bash
git add src/db/repos/settings.ts src/db/repos/settings-batch.test.ts src/server.ts
git commit -m "perf(settings): batch-load settings into per-db cache on hot path"
```

---

## Task 3: Skip no-op account write on success

**Files:**
- Modify: `src/server.ts` (the success branch `updateAccount(... reset ...)`, currently lines ~239-244)
- Test: new `tests/proxy/account-noop-write.test.ts`

Only reset the account when it is actually dirty. A clean account → zero writes.

- [ ] **Step 1: Write the failing test**

Create `tests/proxy/account-noop-write.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { app, resetDb } from '../../src/server.js';
import { openDb } from '../../src/db/index.js';
import { createAccount } from '../../src/db/repos/accounts.js';
import { createClientKey, genClientKey } from '../../src/db/repos/client_keys.js';
import { upsertModel } from '../../src/db/repos/models.js';

let key: string;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'noop') + sep), 't.db');
  resetDb();
  const db = openDb();
  upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3' });
  createAccount(db, { id: 'acc_1', label: 'a', credit_type: 'payg', api_key: 'mm_x' });
  key = genClientKey();
  createClientKey(db, { label: 'app', key });
  db.close();
});

afterEach(() => vi.restoreAllMocks());

it('does not UPDATE accounts when the account is already clean', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } }))
  );

  // Spy on UPDATE accounts statements.
  const realPrepare = Database.prototype.prepare;
  let accountUpdates = 0;
  vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (this: any, sql: string) {
    const stmt = realPrepare.call(this, sql);
    if (/UPDATE accounts/i.test(sql)) {
      const origRun = (stmt as any).run.bind(stmt);
      (stmt as any).run = (...args: any[]) => {
        accountUpdates++;
        return origRun(...args);
      };
    }
    return stmt;
  });

  const res = await app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] }),
  });
  expect(res.status).toBe(200);
  await new Promise((r) => setTimeout(r, 50));
  expect(accountUpdates).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/proxy/account-noop-write.test.ts`
Expected: FAIL — `accountUpdates` is 1 (current code resets every success).

- [ ] **Step 3: Implement the guard**

In `src/server.ts`, replace the unconditional success reset (currently):

```ts
    updateAccount(db, account.id, {
      rate_limited_until: null,
      backoff_level: 0,
      last_error: null,
      status: 'active',
    });
```

with:

```ts
    if (acc.backoff_level !== 0 || acc.status !== 'active' || acc.rate_limited_until !== null || acc.last_error !== null) {
      updateAccount(db, account.id, {
        rate_limited_until: null,
        backoff_level: 0,
        last_error: null,
        status: 'active',
      });
    }
```

(`acc` is the full account row already loaded above via `allAccounts.find(...)`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/proxy/account-noop-write.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: PASS. (Confirms a dirty account still gets reset — covered by existing error/recovery tests.)

- [ ] **Step 6: Commit**

```bash
git add tests/proxy/account-noop-write.test.ts src/server.ts
git commit -m "perf(accounts): skip success reset write when account already clean"
```

---

## Task 4: Throttle expired-lock cleanup

**Files:**
- Modify: `src/accounts/locks.ts` (`clearExpiredModelLocks`)
- Test: `src/accounts/locks.test.ts` (append) or new `src/accounts/locks-throttle.test.ts`

Run the `DELETE` at most once per 30s using a module-level last-run timestamp. Lock correctness is unaffected because `isModelLockActive` checks expiry inline.

- [ ] **Step 1: Write the failing test**

Create `src/accounts/locks-throttle.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, expect, it, vi } from 'vitest';
import { openDb } from '../db/index.js';
import { clearExpiredModelLocks, _resetLockCleanupThrottle } from './locks.js';

let db: ReturnType<typeof openDb>;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'lock') + sep), 't.db');
  db = openDb();
  _resetLockCleanupThrottle();
});

it('runs the DELETE at most once within the throttle window', () => {
  const realPrepare = Database.prototype.prepare;
  let deletes = 0;
  vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (this: any, sql: string) {
    const stmt = realPrepare.call(this, sql);
    if (/DELETE FROM account_model_locks/i.test(sql)) {
      const origRun = (stmt as any).run.bind(stmt);
      (stmt as any).run = (...args: any[]) => {
        deletes++;
        return origRun(...args);
      };
    }
    return stmt;
  });

  clearExpiredModelLocks(db);
  clearExpiredModelLocks(db);
  clearExpiredModelLocks(db);
  expect(deletes).toBe(1);
  vi.restoreAllMocks();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/accounts/locks-throttle.test.ts`
Expected: FAIL — `_resetLockCleanupThrottle` not exported AND `deletes` is 3.

- [ ] **Step 3: Implement the throttle**

In `src/accounts/locks.ts`, replace `clearExpiredModelLocks` with:

```ts
const CLEANUP_THROTTLE_MS = 30_000;
let lastCleanupAt = 0;

export function clearExpiredModelLocks(db: Database.Database): void {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_THROTTLE_MS) return;
  lastCleanupAt = now;
  db.prepare(`DELETE FROM account_model_locks WHERE locked_until < ?`).run(new Date(now).toISOString());
}

/** Test-only: reset the throttle so each test starts fresh. */
export function _resetLockCleanupThrottle(): void {
  lastCleanupAt = 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/accounts/locks-throttle.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: PASS. If any existing locks test relied on `clearExpiredModelLocks` deleting immediately on every call, call `_resetLockCleanupThrottle()` in its `beforeEach`.

- [ ] **Step 6: Commit**

```bash
git add src/accounts/locks.ts src/accounts/locks-throttle.test.ts
git commit -m "perf(locks): throttle expired-lock cleanup to once per 30s"
```

---

## Task 5: Client-key lookup cache

**Files:**
- Modify: `src/db/repos/client_keys.ts` (cache in `getClientKeyByKey`; invalidate on disable/delete)
- Modify: `src/server.ts` admin handlers OR rely on repo-level invalidation (repo invalidation is enough)
- Test: new `src/db/repos/client_keys-cache.test.ts`

Cache bearer→ClientKey per-db for 5s; invalidate on `disableClientKey`/`deleteClientKey`.

- [ ] **Step 1: Write the failing test**

Create `src/db/repos/client_keys-cache.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, expect, it, vi } from 'vitest';
import { openDb } from '../index.js';
import { createClientKey, deleteClientKey, getClientKeyByKey, genClientKey } from './client_keys.js';

let db: ReturnType<typeof openDb>;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ck') + sep), 't.db');
  db = openDb();
});

it('serves repeated lookups from cache (no second SELECT within TTL)', () => {
  const key = genClientKey();
  createClientKey(db, { label: 'app', key });
  getClientKeyByKey(db, key); // primes cache

  const realPrepare = Database.prototype.prepare;
  let selects = 0;
  vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (this: any, sql: string) {
    const stmt = realPrepare.call(this, sql);
    if (/SELECT \* FROM client_keys WHERE key/i.test(sql)) {
      const origGet = (stmt as any).get.bind(stmt);
      (stmt as any).get = (...args: any[]) => {
        selects++;
        return origGet(...args);
      };
    }
    return stmt;
  });

  expect(getClientKeyByKey(db, key)?.key).toBe(key);
  expect(selects).toBe(0);
  vi.restoreAllMocks();
});

it('invalidates the cache on delete', () => {
  const key = genClientKey();
  const created = createClientKey(db, { label: 'app', key });
  expect(getClientKeyByKey(db, key)?.key).toBe(key); // primes cache
  deleteClientKey(db, created.id);
  expect(getClientKeyByKey(db, key)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/repos/client_keys-cache.test.ts`
Expected: FAIL — first test sees `selects === 1` (no cache yet); second may already pass.

- [ ] **Step 3: Implement the cache**

In `src/db/repos/client_keys.ts`, add at top (after imports):

```ts
const CK_TTL_MS = 5_000;
const ckCaches = new WeakMap<Database.Database, Map<string, { value: ClientKey | null; expiry: number }>>();

function ckCache(db: Database.Database): Map<string, { value: ClientKey | null; expiry: number }> {
  let c = ckCaches.get(db);
  if (!c) {
    c = new Map();
    ckCaches.set(db, c);
  }
  return c;
}

export function clearClientKeyCache(db: Database.Database): void {
  ckCaches.delete(db);
}
```

Replace `getClientKeyByKey` with:

```ts
export function getClientKeyByKey(db: Database.Database, key: string): ClientKey | null {
  const c = ckCache(db);
  const hit = c.get(key);
  if (hit && hit.expiry > Date.now()) return hit.value;
  const row =
    (db.prepare(`SELECT * FROM client_keys WHERE key = ? AND enabled = 1`).get(key) as
      | ClientKey
      | undefined) ?? null;
  c.set(key, { value: row, expiry: Date.now() + CK_TTL_MS });
  return row;
}
```

Add cache invalidation to the three mutations — `disableClientKey`, `enableClientKey`, `deleteClientKey` — by calling `clearClientKeyCache(db)` at the end of each:

```ts
export function disableClientKey(db: Database.Database, id: number): void {
  db.prepare(`UPDATE client_keys SET enabled = 0 WHERE id = ?`).run(id);
  clearClientKeyCache(db);
}

export function enableClientKey(db: Database.Database, id: number): void {
  db.prepare(`UPDATE client_keys SET enabled = 1 WHERE id = ?`).run(id);
  clearClientKeyCache(db);
}

export function deleteClientKey(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM client_keys WHERE id = ?`).run(id);
  clearClientKeyCache(db);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/repos/client_keys-cache.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/repos/client_keys.ts src/db/repos/client_keys-cache.test.ts
git commit -m "perf(client-keys): cache bearer lookup with 5s TTL + invalidate on mutation"
```

---

## Task 6: Defer request-log insert off the response path

**Files:**
- Modify: `src/db/repos/requestLogs.ts` (add a deferred insert wrapper + test flush hook)
- Modify: `src/server.ts` (use the deferred wrapper in both non-stream and stream paths)
- Test: new `tests/proxy/deferred-log.test.ts`

The log row must still be written in full; only its timing moves off the critical path. A flush hook keeps tests deterministic.

- [ ] **Step 1: Write the failing test**

Create `tests/proxy/deferred-log.test.ts`:

```ts
import { expect, it } from 'vitest';
import { insertRequestLogDeferred, flushDeferredLogs } from '../../src/db/repos/requestLogs.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { openDb } from '../../src/db/index.js';

it('writes the log row after a flush', async () => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'dlog') + sep), 't.db');
  const db = openDb();
  insertRequestLogDeferred(db, {
    client_key_id: null,
    account_id: 'acc_1',
    model: 'MiniMax-M3',
    endpoint: '/v1/chat/completions',
    format: 'openai',
    prompt_tokens: 1,
    completion_tokens: 1,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 2,
    cost_usd: 0,
    latency_ms: 5,
    status_code: 200,
    stream: 0,
    rtk_bytes_saved: 0,
  });
  const before = db.prepare('SELECT COUNT(*) n FROM request_logs').get() as { n: number };
  await flushDeferredLogs();
  const after = db.prepare('SELECT COUNT(*) n FROM request_logs').get() as { n: number };
  expect(after.n).toBe(before.n + 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/proxy/deferred-log.test.ts`
Expected: FAIL — `insertRequestLogDeferred` / `flushDeferredLogs` not exported.

- [ ] **Step 3: Implement the deferred wrapper**

In `src/db/repos/requestLogs.ts`, add after `insertRequestLog`:

```ts
const pending = new Set<Promise<void>>();

/**
 * Queue a request-log insert to run after the current task, off the response
 * critical path. The row is still written in full. Use flushDeferredLogs() in
 * tests to await completion deterministically.
 */
export function insertRequestLogDeferred(db: Database.Database, log: RequestLogInsert): void {
  const p = new Promise<void>((resolve) => {
    queueMicrotask(() => {
      try {
        insertRequestLog(db, log);
      } catch {
        /* logging must never break the proxy */
      }
      resolve();
    });
  });
  pending.add(p);
  p.finally(() => pending.delete(p));
}

/** Await all queued deferred inserts (test determinism / graceful shutdown). */
export async function flushDeferredLogs(): Promise<void> {
  await Promise.all([...pending]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/proxy/deferred-log.test.ts`
Expected: PASS.

- [ ] **Step 5: Use the deferred wrapper in the proxy**

In `src/server.ts`:

1. Update the import from `./db/repos/requestLogs.js`:

```ts
import { insertRequestLog, insertRequestLogDeferred } from './db/repos/requestLogs.js';
```

2. In the NON-stream path, replace the `insertRequestLog(db, {...})` call (currently ~line 322) with `insertRequestLogDeferred(db, {...})` — same object literal, only the function name changes.

3. In the STREAM path, inside the `pipeWithUsage` `onUsage` callback, replace `insertRequestLog(db, {...})` (currently ~line 263) with `insertRequestLogDeferred(db, {...})` — same object literal.

> Existing integration tests that assert a log row exists immediately after the request may now race the deferred insert. For each such test, `import { flushDeferredLogs } from '../../src/db/repos/requestLogs.js'` and `await flushDeferredLogs()` after the request and before querying `request_logs`. Search the suite: `grep -rl "request_logs" tests/ src/` and add the flush where a row is asserted synchronously.

- [ ] **Step 6: Run the full suite, fix any racing assertions**

Run: `npm test`
Expected: PASS. If a log-assertion test fails intermittently, add `await flushDeferredLogs()` before its query (per the note above). Re-run until green. Then `npm run typecheck`.

- [ ] **Step 7: Commit**

```bash
git add src/db/repos/requestLogs.ts src/server.ts tests/proxy/deferred-log.test.ts
git commit -m "perf(logging): defer request-log insert off the response critical path"
```

---

## Task 7: Fast-path passthrough (skip body re-stringify)

**Files:**
- Modify: `src/server.ts` (`handleProxy` — choose the upstream body)
- Test: new `tests/proxy/fastpath-passthrough.test.ts`

When no transform is active, forward the original raw request text instead of re-serializing the parsed body. Equivalence must be provable.

- [ ] **Step 1: Write the equivalence test**

Create `tests/proxy/fastpath-passthrough.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { app, resetDb } from '../../src/server.js';
import { openDb } from '../../src/db/index.js';
import { createAccount } from '../../src/db/repos/accounts.js';
import { createClientKey, genClientKey } from '../../src/db/repos/client_keys.js';
import { upsertModel } from '../../src/db/repos/models.js';
import { setSetting } from '../../src/db/repos/settings.js';

let key: string;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'fp') + sep), 't.db');
  resetDb();
  const db = openDb();
  upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3' });
  // All transforms OFF.
  setSetting(db, 'caveman', { level: 'off' });
  setSetting(db, 'caching', { autoBreakpoints: false });
  setSetting(db, 'rtk', { enabled: false });
  setSetting(db, 'minimax', { upstreamFormat: 'openai' });
  createAccount(db, { id: 'acc_1', label: 'a', credit_type: 'payg', api_key: 'mm_x' });
  key = genClientKey();
  createClientKey(db, { label: 'app', key });
  db.close();
});

afterEach(() => vi.restoreAllMocks());

it('forwards a body equivalent to the client request when no transform applies', async () => {
  let sentBody = '';
  vi.spyOn(globalThis, 'fetch').mockImplementation((_url, opts: any) => {
    sentBody = opts.body as string;
    return Promise.resolve(new Response(JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  });

  // All builtin models are thinking-capable, so make bodyTransform a no-op by
  // pre-setting the exact fields it would otherwise inject: thinking,
  // max_completion_tokens (M3 default guard), and reasoning_split.
  const clientBody = {
    model: 'MiniMax-M3',
    messages: [{ role: 'user', content: 'hello world' }],
    temperature: 0.5,
    thinking: { type: 'adaptive' },
    max_completion_tokens: 131072,
    reasoning_split: true,
  };
  const res = await app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(clientBody),
  });
  expect(res.status).toBe(200);
  // Body forwarded upstream must be semantically identical to what the client sent.
  expect(JSON.parse(sentBody)).toEqual(clientBody);
});
```

> The fields above (`thinking`, `max_completion_tokens`, `reasoning_split`) are exactly what `resolveModel().bodyTransform` would inject for M3, so pre-setting them makes the transform a no-op and the fast path engages. Also confirm `bodyAddsOpenAIStreamUsage` is a no-op for non-stream requests (`stream` unset) — it only adds `stream_options` when `stream === true`, so `bodyDirty` stays false here.

- [ ] **Step 2: Run test to verify it currently passes BUT via re-stringify**

Run: `npx vitest run tests/proxy/fastpath-passthrough.test.ts`
Expected: PASS already (re-stringify is semantically equal). This test is the equivalence guard; it must stay green after the optimization. Note it passing now.

- [ ] **Step 3: Implement the fast path**

In `src/server.ts` `handleProxy`, track whether any transform mutated the body, then choose the upstream payload. You will edit the existing pipeline in place — substeps b–e replace existing blocks, they don't add parallel copies. After all edits there must be exactly one augment block, one rtk block, one cross-format block, and one model-resolution block.

a. Near the top where `body` is parsed, after a successful `JSON.parse`, keep `text` (already in scope). Note the current pipeline order in `handleProxy`: (1) build `settings`, (2) `await augmentRequest`, (3) rtk, (4) compute `upstreamFormat`, (5) `bodyAddsOpenAIStreamUsage`, (6) cross-format conversion, (7) select account, (8) `resolveModel` + `body.model = ...` + `bodyTransform` inside a try/catch. Keep that order; only thread `bodyDirty` through it.

b. Determine no-transform conditions. Replace the augment block to record whether it changed anything. Minimal version — add a `bodyDirty` boolean:

```ts
  let bodyDirty = false;

  const cavemanOn = !!settings.caveman?.level && settings.caveman.level !== 'off';
  const cachingOn = !!settings.caching?.autoBreakpoints;
  if (cavemanOn || cachingOn) {
    await augmentRequest(body, settings);
    bodyDirty = true;
  }

  const rtkSetting = getSetting(db, 'rtk') as { enabled: boolean } | null;
  if (rtkSetting?.enabled) {
    const stats = compressMessages(body, true);
    const rtkLog = formatRtkLog(stats);
    if (rtkLog) console.log(rtkLog);
    bodyDirty = true;
  }
```

(Remove the now-duplicated original `await augmentRequest(...)` and rtk block above — there must be exactly one of each.)

c. **OpenAI stream-usage injection — leave EXACTLY as today.** Important behavioral fact: `bodyAddsOpenAIStreamUsage(body)` returns a *new object* and the current code (`src/server.ts` ~line 144) ignores the return value, so it does **not** mutate `body` — today's upstream body never actually gains `stream_options`. To avoid a regression, do NOT change this call and do NOT mark `bodyDirty` from it. Keep the existing line untouched:

```ts
  if (upstreamFormat === 'openai') {
    bodyAddsOpenAIStreamUsage(body); // unchanged: no-op on body, preserves current behavior
  }
```

Do NOT modify `bodyAddsOpenAIStreamUsage` in `transform.ts`. (Fixing the ignored-return bug is out of scope — changing it now WOULD change the upstream payload and break the "no regression" guarantee. Note it for a separate ticket.)

d. Cross-format conversion DOES mutate the body, so it forces `bodyDirty`:

```ts
  if (format !== upstreamFormat) {
    // ... existing Object.assign(body, bodyOpenAIToAnthropic(body)) etc ...
    bodyDirty = true;
  }
```

When `format === upstreamFormat` (the common case), the body is untouched here.

e. Model resolution mutates `body.model` (alias → upstream) and `bodyTransform` may inject thinking fields. Both must mark dirty. Inside the existing `try { resolved = resolveModel(...); body.model = resolved.upstreamModel; resolved.bodyTransform(body); } catch ...`, replace the two mutation lines with the wrapped version (keep the surrounding try/catch and the `requestedModel` line intact):

```ts
  const origModel = body.model;
  const beforeKeys = JSON.stringify([body.thinking, body.max_completion_tokens, body.reasoning_split]);
  body.model = resolved.upstreamModel;
  resolved.bodyTransform(body);
  const afterKeys = JSON.stringify([body.thinking, body.max_completion_tokens, body.reasoning_split]);
  if (body.model !== origModel || beforeKeys !== afterKeys) bodyDirty = true;
```

This catches the alias-rewrite case: if the client sent an alias name, `body.model` changes, so the raw text no longer matches and the fast path correctly falls back to re-stringify.

f. Choose the upstream payload — pass raw text when clean, else the parsed body. `upstreamFetch` serializes whatever it gets, so pass the already-serialized text via a tiny branch. Change the `upstreamFetch` call site:

```ts
    const upstreamBody = bodyDirty ? body : (text || '{}');
    const resp = await upstreamFetch(url, upstreamBody, headers, transport);
```

g. `upstreamFetch` must forward a string as-is rather than double-stringifying. In `src/providers/upstreamFetch.ts`, change the body line to:

```ts
      body: typeof body === 'string' ? body : JSON.stringify(body),
```

- [ ] **Step 4: Run the equivalence test**

Run: `npx vitest run tests/proxy/fastpath-passthrough.test.ts`
Expected: PASS — forwarded body still equals client body, now without re-stringify.

- [ ] **Step 5: Run the full suite**

Run: `npm test` then `npm run typecheck` then `npm run lint`
Expected: PASS. Pay attention to existing transform/format tests — they exercise the `bodyDirty` branches.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts src/providers/upstreamFetch.ts src/providers/format/transform.ts tests/proxy/fastpath-passthrough.test.ts
git commit -m "perf(proxy): fast-path passthrough of raw body when no transform applies"
```

---

## Task 8: Re-run benchmark, record results

**Files:**
- None (uses Task 0 harness)

- [ ] **Step 1: Re-run the harness**

Run: `npx vitest run tests/bench/hotpath.bench.test.ts`
Expected: PASS. Record the two `[bench]` lines as the AFTER numbers.

- [ ] **Step 2: Compare and record**

Statement count should be strictly lower than baseline; overhead should be lower or equal. If not, investigate which task didn't take effect.

- [ ] **Step 3: Full final gate**

Run: `npm test && npm run test:client && npm run typecheck && npm run lint`
Expected: all PASS.

- [ ] **Step 4: Commit the evidence**

```bash
git commit --allow-empty -m "perf: record hot-path benchmark before/after (stmts N->M, overhead X->Y ms)"
```

---

## Self-review notes

- Spec coverage: Step 1 dropped with rationale (documented in spec + plan header). Steps 2–8 each map to a task. All spec components covered.
- No placeholders: every code step shows full code; benchmark numbers are recorded at runtime, not pre-filled.
- Type consistency: `getAllSettings`, `clearClientKeyCache`, `insertRequestLogDeferred`/`flushDeferredLogs`, `_resetLockCleanupThrottle`, and the `bodyAddsOpenAIStreamUsage: boolean` change are used consistently across tasks.
- Model-name assumptions (`MiniMax-M3`, `MiniMax-Text-01`) are flagged with fallback instructions in case the seed set differs.
