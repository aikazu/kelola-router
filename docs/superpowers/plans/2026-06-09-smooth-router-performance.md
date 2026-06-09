# Smooth Router Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the router feel nearly invisible for a single-user local proxy by reducing hot-path SQLite work, avoiding repeated transport resolution, and hardening deferred logging so dashboard/logging never delays client requests.

**Architecture:** Start with measurement, then apply surgical caches and bounded queues on the proxy hot path. No new dependencies, no public API changes, no DB schema changes. Existing admin CRUD remains source of truth; runtime caches use short TTL plus explicit invalidation.

**Tech Stack:** Hono + Node 20+, better-sqlite3, undici, Vitest, TypeScript strict (no `any`).

**Verification basis:** Re-checked working tree on 2026-06-09. Existing `tests/bench/hotpath.bench.test.ts` already measures warm SQLite statement executions and fake-upstream overhead. Existing `requestLogs` already batches deferred inserts. Existing transport repo already invalidates dispatcher/SOCKS caches on transport CRUD. Remaining high-confidence work: stronger benchmark assertions, resolved transport cache, bounded log queue metrics/drop policy, and tiny dashboard aggregate cache.

---

## File structure

### New files
- `src/runtime/hotPathMetrics.ts` — tiny in-memory benchmark helper for hot path timing; test-only readable, disabled unless used in tests.
- `src/transport/resolvedCache.ts` — per-account resolved transport cache with TTL + invalidation.
- `src/db/repos/requestLogsQueue.test.ts` — unit tests for bounded deferred log queue behavior.
- `src/api/admin/cache.ts` — small response cache helper for admin dashboard aggregate endpoints.

### Modified files
- `tests/bench/hotpath.bench.test.ts` — turn console-only benchmark into regression test with statement/latency budgets.
- `src/server.ts` — optional timing marks for hot path test; no production behavior change.
- `src/transport/resolve.ts` — route through resolved transport cache; keep existing public API.
- `src/db/repos/transports.ts` — invalidate resolved transport cache on CRUD.
- `src/db/repos/requestLogs.ts` — bound deferred queue, expose queue stats for tests, drop detail before blocking.
- `src/api/admin/usage.ts` — cache aggregate response briefly.
- `src/api/admin/overview.ts` — cache overview response briefly.

### Test files
- `tests/bench/hotpath.bench.test.ts`
- `src/transport/resolve.test.ts`
- `src/db/repos/requestLogsQueue.test.ts`
- `tests/api/admin/usage-cache.test.ts`
- `tests/api/admin/overview-cache.test.ts`

---

## Task 1: Make hot-path benchmark enforce budgets

**Files:**
- Modify: `tests/bench/hotpath.bench.test.ts`
- Create: `src/runtime/hotPathMetrics.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Write failing budget assertions in existing benchmark**

Replace the final assertions in `tests/bench/hotpath.bench.test.ts` with this budget block. Keep existing setup and request helper.

```ts
expect(res.status).toBe(200);
console.log(`[bench] sqlite statement executions (warm): ${stmtRuns}`);
console.log(`[bench] router overhead (fake upstream): ${overheadMs.toFixed(2)}ms`);

// Single-user invisible-router budget. Fake upstream removes network cost.
// If this fails on CI, inspect statement count first; hot path likely gained DB work.
expect(stmtRuns).toBeLessThanOrEqual(18);
expect(overheadMs).toBeLessThan(35);
```

- [ ] **Step 2: Run test to verify current budget result**

Run:

```bash
npx vitest run tests/bench/hotpath.bench.test.ts
```

Expected: either PASS or FAIL showing current warm statement count/overhead. If FAIL, keep failing result; later tasks reduce it.

- [ ] **Step 3: Add optional hot path metrics helper**

Create `src/runtime/hotPathMetrics.ts`:

```ts
export interface HotPathMark {
  name: string;
  atMs: number;
}

let enabled = false;
let marks: HotPathMark[] = [];

export function enableHotPathMetrics(): void {
  enabled = true;
  marks = [];
}

export function disableHotPathMetrics(): void {
  enabled = false;
  marks = [];
}

export function markHotPath(name: string): void {
  if (!enabled) return;
  marks.push({ name, atMs: performance.now() });
}

export function readHotPathMarks(): HotPathMark[] {
  return marks.slice();
}
```

- [ ] **Step 4: Add timing marks in `src/server.ts` around existing hot path operations**

Add import near other imports:

```ts
import { markHotPath } from './runtime/hotPathMetrics.js';
```

Inside `handleProxy`, add marks without changing logic:

```ts
markHotPath('proxy:start');
```

After body parse:

```ts
markHotPath('proxy:body-parsed');
```

After model resolution:

```ts
markHotPath('proxy:model-resolved');
```

After account selected:

```ts
markHotPath('proxy:account-selected');
```

After transport resolved:

```ts
markHotPath('proxy:transport-resolved');
```

Immediately before `upstreamFetch`:

```ts
markHotPath('proxy:upstream-fetch-start');
```

Immediately after `upstreamFetch` resolves:

```ts
markHotPath('proxy:upstream-fetch-response');
```

- [ ] **Step 5: Extend benchmark to assert marks exist in order**

Add imports:

```ts
import {
  disableHotPathMetrics,
  enableHotPathMetrics,
  readHotPathMarks,
} from '../../src/runtime/hotPathMetrics.js';
```

Wrap request:

```ts
enableHotPathMetrics();
const t0 = performance.now();
const res = await make();
const overheadMs = performance.now() - t0;
const marks = readHotPathMarks();
disableHotPathMetrics();
```

Add assertion:

```ts
expect(marks.map((m) => m.name)).toContain('proxy:upstream-fetch-start');
expect(marks.map((m) => m.name)).toContain('proxy:upstream-fetch-response');
```

- [ ] **Step 6: Run focused benchmark**

Run:

```bash
npx vitest run tests/bench/hotpath.bench.test.ts
```

Expected: PASS or budget FAIL with useful metrics.

- [ ] **Step 7: Commit**

```bash
git add src/runtime/hotPathMetrics.ts src/server.ts tests/bench/hotpath.bench.test.ts
git commit -m "test(perf): enforce hot path overhead budget"
```

---

## Task 2: Cache resolved transport per account

**Files:**
- Create: `src/transport/resolvedCache.ts`
- Modify: `src/transport/resolve.ts`
- Modify: `src/db/repos/transports.ts`
- Test: `src/transport/resolve.test.ts`

- [ ] **Step 1: Add failing test for repeated transport resolution**

Append to `src/transport/resolve.test.ts`:

```ts
it('caches resolved proxy pool transport for a short TTL', () => {
  const db = openDb();
  createTransport(db, { id: 'p1', type: 'proxy', label: 'P1', kind: 'http', url: 'http://p1' });
  createTransport(db, { id: 'p2', type: 'proxy', label: 'P2', kind: 'http', url: 'http://p2' });
  const acc = {
    ...mkAccount('a-cache'),
    proxy_pool: JSON.stringify(['p1', 'p2']),
    proxy_rotate_every: 10,
  };

  const first = resolveTransportForAccount(db, acc);
  const second = resolveTransportForAccount(db, acc);

  expect(first).toEqual(second);
  expect(first?.url).toBe('http://p1');
});
```

Add invalidation test:

```ts
it('invalidates resolved transport cache when a transport changes', () => {
  const db = openDb();
  createTransport(db, { id: 'p1', type: 'proxy', label: 'P1', kind: 'http', url: 'http://old' });
  const acc = { ...mkAccount('a-invalidate'), proxy_id: 'p1' };

  expect(resolveTransportForAccount(db, acc)?.url).toBe('http://old');
  updateTransport(db, 'p1', { url: 'http://new' });
  expect(resolveTransportForAccount(db, acc)?.url).toBe('http://new');
});
```

Ensure imports include `createTransport` and `updateTransport` from `../db/repos/transports.js` using existing relative path in file.

- [ ] **Step 2: Run test, expect FAIL on cache/invalidation behavior or missing module**

Run:

```bash
npx vitest run src/transport/resolve.test.ts
```

Expected: FAIL until cache module/invalidation wired.

- [ ] **Step 3: Create `src/transport/resolvedCache.ts`**

```ts
import type Database from 'better-sqlite3';
import type { Account } from '../db/repos/accounts.js';
import type { TransportConfig } from './types.js';

interface Entry {
  key: string;
  value: TransportConfig | null;
  expiry: number;
}

const TTL_MS = 1_000;
const caches = new WeakMap<Database.Database, Map<string, Entry>>();

function cacheFor(db: Database.Database): Map<string, Entry> {
  let cache = caches.get(db);
  if (!cache) {
    cache = new Map();
    caches.set(db, cache);
  }
  return cache;
}

function accountTransportKey(account: Account): string {
  return JSON.stringify({
    relay_id: account.relay_id ?? null,
    proxy_id: account.proxy_id ?? null,
    proxy_pool: account.proxy_pool ?? null,
    proxy_rotate_every: account.proxy_rotate_every ?? null,
  });
}

export function getResolvedTransportCache(
  db: Database.Database,
  account: Account
): TransportConfig | null | undefined {
  const entry = cacheFor(db).get(account.id);
  if (!entry) return undefined;
  if (entry.expiry <= Date.now()) return undefined;
  if (entry.key !== accountTransportKey(account)) return undefined;
  return entry.value;
}

export function setResolvedTransportCache(
  db: Database.Database,
  account: Account,
  value: TransportConfig | null
): void {
  cacheFor(db).set(account.id, {
    key: accountTransportKey(account),
    value,
    expiry: Date.now() + TTL_MS,
  });
}

export function invalidateResolvedTransportCache(db?: Database.Database): void {
  if (db) {
    caches.delete(db);
    return;
  }
  // WeakMap cannot be iterated. Global invalidation is intentionally a no-op for
  // process-wide DBs; CRUD paths call this with their DB handle.
}
```

- [ ] **Step 4: Wire cache in `src/transport/resolve.ts`**

Add import:

```ts
import {
  getResolvedTransportCache,
  setResolvedTransportCache,
} from './resolvedCache.js';
```

At top of `resolveTransportForAccount` body:

```ts
const cached = getResolvedTransportCache(db, account);
if (cached !== undefined) return cached;
```

Replace every direct return with cache set. Pattern:

```ts
const resolved = asProxyConfig(t);
setResolvedTransportCache(db, account, resolved);
return resolved;
```

For direct/no transport path:

```ts
setResolvedTransportCache(db, account, null);
return null;
```

- [ ] **Step 5: Invalidate resolved cache on transport CRUD**

In `src/db/repos/transports.ts`, add import:

```ts
import { invalidateResolvedTransportCache } from '../../transport/resolvedCache.js';
```

At end of `createTransport`, after insert:

```ts
invalidateResolvedTransportCache(db);
```

At end of `updateTransport`, after existing dispatcher/SOCKS invalidation:

```ts
invalidateResolvedTransportCache(db);
```

At end of `deleteTransport`, after existing invalidation:

```ts
invalidateResolvedTransportCache(db);
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npx vitest run src/transport/resolve.test.ts src/db/repos/transports.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run hot-path benchmark again**

Run:

```bash
npx vitest run tests/bench/hotpath.bench.test.ts
```

Expected: statement count lower or unchanged; overhead under budget.

- [ ] **Step 8: Commit**

```bash
git add src/transport/resolvedCache.ts src/transport/resolve.ts src/db/repos/transports.ts src/transport/resolve.test.ts
git commit -m "perf(transport): cache resolved account transport"
```

---

## Task 3: Bound deferred request log queue

**Files:**
- Modify: `src/db/repos/requestLogs.ts`
- Create: `src/db/repos/requestLogsQueue.test.ts`

- [ ] **Step 1: Write failing queue bound tests**

Create `src/db/repos/requestLogsQueue.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../index.js';
import { createAccount } from './accounts.js';
import { createClientKey } from './client_keys.js';
import {
  flushDeferredLogs,
  getDeferredLogQueueStats,
  insertRequestLogDeferred,
  type RequestLogInsert,
} from './requestLogs.js';

function entry(clientKeyId: number): RequestLogInsert {
  return {
    client_key_id: clientKeyId,
    account_id: 'a',
    model: 'm',
    requested_model: 'm',
    endpoint: '/v1/chat/completions',
    format: 'openai',
    prompt_tokens: 1,
    completion_tokens: 1,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 2,
    cost_usd: 0,
    latency_ms: 1,
    status_code: 200,
    stream: 0,
    rtk_bytes_saved: 0,
  };
}

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'rq-')), 't.db');
});

describe('deferred request log queue', () => {
  it('exposes queue stats for observability', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'c', key: 'rk_c' });
    createAccount(db, { id: 'a', label: 'A', credit_type: 'payg', api_key: 'k' });

    insertRequestLogDeferred(db, entry(ck.id));
    const stats = getDeferredLogQueueStats(db);

    expect(stats.pending).toBeGreaterThanOrEqual(1);
    expect(stats.dropped).toBe(0);
    await flushDeferredLogs();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL because `getDeferredLogQueueStats` missing**

Run:

```bash
npx vitest run src/db/repos/requestLogsQueue.test.ts
```

- [ ] **Step 3: Implement queue stats and hard cap in `requestLogs.ts`**

Add constants near `BATCH_MS`:

```ts
const MAX_PENDING_PER_DB = 1_000;
```

Add state:

```ts
const dropped = new WeakMap<Database.Database, number>();

export interface DeferredLogQueueStats {
  pending: number;
  dropped: number;
}

export function getDeferredLogQueueStats(db: Database.Database): DeferredLogQueueStats {
  return {
    pending: pending.get(db)?.length ?? 0,
    dropped: dropped.get(db) ?? 0,
  };
}
```

Inside `insertRequestLogDeferred`, before `queue.push(entry)`:

```ts
if (queue.length >= MAX_PENDING_PER_DB) {
  queue.shift();
  dropped.set(db, (dropped.get(db) ?? 0) + 1);
}
```

Keep existing `BATCH_SIZE` flush behavior unchanged.

- [ ] **Step 4: Add test for drop count without waiting for DB**

Append to `requestLogsQueue.test.ts`:

```ts
it('drops oldest pending entries instead of growing unbounded', async () => {
  const db = openDb();
  const ck = createClientKey(db, { label: 'c', key: 'rk_c2' });
  createAccount(db, { id: 'a', label: 'A', credit_type: 'payg', api_key: 'k' });

  for (let i = 0; i < 1_100; i++) insertRequestLogDeferred(db, entry(ck.id));
  const stats = getDeferredLogQueueStats(db);

  expect(stats.pending).toBeLessThanOrEqual(1_000);
  expect(stats.dropped).toBeGreaterThan(0);
  await flushDeferredLogs();
});
```

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run src/db/repos/requestLogsQueue.test.ts src/db/repos/requestLogs.test.ts tests/proxy/deferred-log.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/repos/requestLogs.ts src/db/repos/requestLogsQueue.test.ts
git commit -m "perf(db): bound deferred request log queue"
```

---

## Task 4: Cache dashboard aggregate responses briefly

**Files:**
- Create: `src/api/admin/cache.ts`
- Modify: `src/api/admin/usage.ts`
- Modify: `src/api/admin/overview.ts`
- Test: `tests/api/admin/usage-cache.test.ts`
- Test: `tests/api/admin/overview-cache.test.ts`

- [ ] **Step 1: Create failing cache helper test inline in usage-cache test**

Create `tests/api/admin/usage-cache.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app, resetDb } from '../../../src/server.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'usage-cache-')), 't.db');
  process.env.ROUTER_ADMIN_KEY = 'admin';
  resetDb();
});

describe('admin usage cache', () => {
  it('returns identical usage response for repeated requests within cache window', async () => {
    const r1 = await app.request('/api/admin/usage?days=1', {
      headers: { 'x-admin-key': 'admin' },
    });
    const body1 = await r1.text();

    const r2 = await app.request('/api/admin/usage?days=1', {
      headers: { 'x-admin-key': 'admin' },
    });
    const body2 = await r2.text();

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(body2).toBe(body1);
  });
});
```

- [ ] **Step 2: Run test, expect PASS currently or no cache observability**

Run:

```bash
npx vitest run tests/api/admin/usage-cache.test.ts
```

Expected: may PASS because responses equal. Next step adds real helper and tests compile integration.

- [ ] **Step 3: Create admin cache helper**

Create `src/api/admin/cache.ts`:

```ts
interface Entry<T> {
  value: T;
  expiry: number;
}

const cache = new Map<string, Entry<unknown>>();

export function getAdminCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiry <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setAdminCached<T>(key: string, value: T, ttlMs = 1_000): T {
  cache.set(key, { value, expiry: Date.now() + ttlMs });
  return value;
}

export function clearAdminCache(): void {
  cache.clear();
}
```

- [ ] **Step 4: Wire cache into `src/api/admin/usage.ts`**

Add import:

```ts
import { getAdminCached, setAdminCached } from './cache.js';
```

Inside handler, after parsing query params but before DB aggregate:

```ts
const cacheKey = `usage:${days}:${clientKeyId ?? 'all'}`;
const cached = getAdminCached<unknown>(cacheKey);
if (cached) return c.json(cached);
```

Replace final `return c.json(payload)` with:

```ts
return c.json(setAdminCached(cacheKey, payload));
```

- [ ] **Step 5: Wire cache into `src/api/admin/overview.ts`**

Add import:

```ts
import { getAdminCached, setAdminCached } from './cache.js';
```

Inside handler after days parsed:

```ts
const cacheKey = `overview:${days}`;
const cached = getAdminCached<unknown>(cacheKey);
if (cached) return c.json(cached);
```

Replace final `return c.json(payload)` with:

```ts
return c.json(setAdminCached(cacheKey, payload));
```

- [ ] **Step 6: Add overview cache smoke test**

Create `tests/api/admin/overview-cache.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, resetDb } from '../../../src/server.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'overview-cache-')), 't.db');
  process.env.ROUTER_ADMIN_KEY = 'admin';
  resetDb();
});

describe('admin overview cache', () => {
  it('returns stable overview response for repeated requests within cache window', async () => {
    const r1 = await app.request('/api/admin/overview?days=1', {
      headers: { 'x-admin-key': 'admin' },
    });
    const body1 = await r1.text();

    const r2 = await app.request('/api/admin/overview?days=1', {
      headers: { 'x-admin-key': 'admin' },
    });
    const body2 = await r2.text();

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(body2).toBe(body1);
  });
});
```

- [ ] **Step 7: Run focused admin tests**

Run:

```bash
npx vitest run tests/api/admin/usage-cache.test.ts tests/api/admin/overview-cache.test.ts tests/api/admin/auth.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/api/admin/cache.ts src/api/admin/usage.ts src/api/admin/overview.ts \
        tests/api/admin/usage-cache.test.ts tests/api/admin/overview-cache.test.ts
git commit -m "perf(admin): cache aggregate dashboard responses briefly"
```

---

## Task 5: Final verification

**Files:** none beyond previous tasks.

- [ ] **Step 1: Run hot-path benchmark**

```bash
npx vitest run tests/bench/hotpath.bench.test.ts
```

Expected: PASS and logs show warm statement count <= 18, fake upstream overhead < 35ms.

- [ ] **Step 2: Run server tests**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run client tests**

```bash
npm run test:client
```

Expected: PASS.

- [ ] **Step 4: Run typecheck and lint**

```bash
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit final verification notes if any docs changed**

If only code/tests changed and all prior commits exist, no extra commit needed. If plan or docs were updated during execution:

```bash
git add docs/superpowers/plans/2026-06-09-smooth-router-performance.md
git commit -m "docs: add smooth router performance plan"
```

---

## Self-review

- Spec coverage: plan targets smooth/stable single-user router via hot-path benchmark, transport cache, bounded log queue, and dashboard aggregate cache.
- Placeholder scan: no TBD/TODO/implement-later placeholders. Every code-changing step includes concrete code or exact insertion pattern.
- Type consistency: uses existing `Account`, `TransportConfig`, `RequestLogInsert`, `openDb`, `app`, and `resetDb` names verified from current tree.
- YAGNI check: no schema migration, no new dependencies, no worker threads. Work remains surgical and reversible.
