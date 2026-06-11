# Per-Provider Account Selection + Models Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make account-selection settings (mode + step) per-provider, split Accounts and Models dashboard pages into per-provider cards, and add manual model-add + per-model health check.

**Architecture:** Selection settings move from one global `selection` settings key to two keys (`selection.minimax`, `selection.kiro`) read at the three `selectAccount` call sites in `src/server.ts`. New admin API routes for selection settings, manual model creation, and a model health check that fires a 1-token request at the upstream. Frontend: a reusable `SelectionControls` component, Accounts page rendered as two provider cards, Models page rendered as two provider cards with add-model modal and per-row Test button.

**Tech Stack:** Hono + better-sqlite3 (server), Preact + @tanstack/react-query (client), Vitest both sides.

**Spec deviations (intentional, decided during planning):**
1. Health check route is `POST /api/admin/models/:name/test` (spec said `:id`). The `GET /api/admin/models` response has no `id` field, and all sibling routes (`/:name/enable`, `/:name/disable`) key by name.
2. Health check always returns HTTP 200 with an `ok` flag (`{ ok: false, latencyMs, error }` is still 200). `apiFetch` throws on non-2xx and would lose the latency/error payload.
3. New endpoint `POST /api/admin/models` (manual add) — spec describes the add-model modal but defines no backend route; one is required.
4. `rrCursor` stays a single module-level cursor shared by both providers (spec does not ask for per-provider cursors).

**Verification commands used throughout:**
- Server tests: `npx vitest run <path>` from repo root
- Client tests: `npx vitest run <path relative to client/>` from `client/`
- Full gates: `npm test`, `npm run test:client`, `npm run typecheck`, `npm run lint`

---

### Task 1: `step` support in `selectAccount` round-robin

**Files:**
- Modify: `src/accounts/types.ts` (interface `SelectionOpts`, line 6)
- Modify: `src/accounts/selection.ts` (round-robin branch, lines 16-20)
- Test: `src/accounts/selection.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('round-robin', ...)` block in `src/accounts/selection.test.ts` (it already defines `const accounts = [acc('a'), acc('b'), acc('c')];`):

```ts
    it('step=3 keeps the same account for 3 consecutive cursors', () => {
      const ids = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(
        (cursor) => selectAccount(accounts, { mode: 'round-robin', cursor, step: 3 }).account?.id
      );
      expect(ids).toEqual(['a', 'a', 'a', 'b', 'b', 'b', 'c', 'c', 'c']);
    });

    it('step=2 wraps around the pool', () => {
      // floor(6/2) % 3 = 0 -> back to 'a'
      const r = selectAccount(accounts, { mode: 'round-robin', cursor: 6, step: 2 });
      expect(r.account?.id).toBe('a');
      expect(r.nextCursor).toBe(7);
    });

    it('omitted step behaves as step=1 (back-compat)', () => {
      const r0 = selectAccount(accounts, { mode: 'round-robin', cursor: 0 });
      const r1 = selectAccount(accounts, { mode: 'round-robin', cursor: 1 });
      expect(r0.account?.id).toBe('a');
      expect(r1.account?.id).toBe('b');
    });
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npx vitest run src/accounts/selection.test.ts`
Expected: `step=3` and `step=2` tests FAIL (current impl ignores `step`; with step=3 it returns `a,b,c,a,...` not `a,a,a,b,...`). TypeScript may also error: `step` not in `SelectionOpts`.

- [ ] **Step 3: Add `step` to `SelectionOpts`**

In `src/accounts/types.ts`, change the interface to:

```ts
export interface SelectionOpts {
  mode: SelectionMode;
  cursor?: number;
  /** Round-robin only: stay on the same account for `step` consecutive requests. Default 1. */
  step?: number;
  clientKeyId?: number;
  stickyMap?: Map<number, string>;
}
```

- [ ] **Step 4: Implement step in `selectAccount`**

In `src/accounts/selection.ts`, replace the round-robin branch:

```ts
  if (opts.mode === 'round-robin') {
    const cursor = opts.cursor ?? 0;
    const step = opts.step ?? 1;
    const idx = Math.floor(cursor / step) % available.length;
    return { account: available[idx]!, reason: 'round-robin', nextCursor: cursor + 1 };
  }
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npx vitest run src/accounts/selection.test.ts`
Expected: ALL PASS (existing round-robin tests use step-less opts and must still pass).

- [ ] **Step 6: Commit**

```bash
git add src/accounts/types.ts src/accounts/selection.ts src/accounts/selection.test.ts
git commit -m "feat(accounts): add step to round-robin selection"
```

---

### Task 2: server.ts reads per-provider selection keys

**Files:**
- Modify: `src/server.ts` (three sites: ~line 207, ~line 646, ~line 975; plus a test-only export near line 106)
- Test: `tests/integration/selection-per-provider.test.ts` (create)

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/selection-per-provider.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { createAccount } from '../../src/db/repos/accounts.js';
import { createClientKey } from '../../src/db/repos/client_keys.js';
import { enableModel, upsertModel } from '../../src/db/repos/models.js';
import { flushDeferredLogs, recentLogs } from '../../src/db/repos/requestLogs.js';
import { clearCache, setSetting } from '../../src/db/repos/settings.js';
import { clearAliasCache } from '../../src/providers/aliasCache.js';
import { _resetSelectionCursorForTests, app, resetDb } from '../../src/server.js';

let dir: string;
let clientKey: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sel-provider-'));
  process.env.ROUTER_DB_PATH = join(dir, 't.db');
  resetDb();
  clearCache();
  _resetSelectionCursorForTests();
  const db = openDb();
  upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3' });
  enableModel(db, 'MiniMax-M3');
  createAccount(db, { id: 'acc1', label: 'a1', credit_type: 'payg', api_key: 'mm_1' });
  createAccount(db, { id: 'acc2', label: 'a2', credit_type: 'payg', api_key: 'mm_2' });
  const ck = createClientKey(db, { label: 't', key: 'ck_sel_1' });
  clientKey = ck.key;
  setSetting(db, 'transport', { relay: null, proxy: null });
  setSetting(db, 'selection.minimax', { mode: 'round-robin', step: 2 });
  clearCache();
  clearAliasCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetDb();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows WAL lock; temp dir auto-cleaned */
  }
  delete process.env.ROUTER_DB_PATH;
});

const okUpstream = () =>
  new Response(
    JSON.stringify({
      id: 'x',
      model: 'MiniMax-M3',
      choices: [{ message: { role: 'assistant', content: 'ok' }, index: 0, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { headers: { 'content-type': 'application/json' } }
  );

const fire = () =>
  app.request(
    new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${clientKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'MiniMax-M3',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
      }),
    })
  );

describe('per-provider selection settings', () => {
  it('selection.minimax round-robin step=2 groups requests in pairs', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okUpstream());

    for (let i = 0; i < 4; i++) {
      const res = await fire();
      expect(res.status).toBe(200);
    }

    await flushDeferredLogs();
    const logs = recentLogs(openDb(), { limit: 4 });
    // recentLogs returns newest first; reverse to chronological order.
    const ids = logs.map((l) => l.account_id).reverse();
    // cursors 0,1,2,3 with step=2 -> idx 0,0,1,1
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).toBe(ids[3]);
    expect(ids[0]).not.toBe(ids[2]);
  });

  it('legacy global selection key is ignored', async () => {
    const db = openDb();
    // Old key says round-robin; per-provider key absent -> default lowest-backoff.
    setSetting(db, 'selection', { mode: 'round-robin' });
    setSetting(db, 'selection.minimax', { mode: 'lowest-backoff', step: 1 });
    clearCache();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okUpstream());

    for (let i = 0; i < 3; i++) {
      const res = await fire();
      expect(res.status).toBe(200);
    }

    await flushDeferredLogs();
    const logs = recentLogs(openDb(), { limit: 3 });
    // lowest-backoff with equal backoff levels always picks the same (first) account.
    const ids = new Set(logs.map((l) => l.account_id));
    expect(ids.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run tests/integration/selection-per-provider.test.ts`
Expected: FAIL — `_resetSelectionCursorForTests` is not exported from `src/server.js` (import error), and after adding it, the step-pairing assertion fails because server still reads the old `selection` key (no step).

- [ ] **Step 3: Add the test-only cursor reset export**

In `src/server.ts`, directly below line 107 (`const stickyMap = new Map<number, string>();`), add:

```ts
/** Test-only: reset the shared round-robin cursor so step assertions are deterministic. */
export function _resetSelectionCursorForTests(): void {
  rrCursor = 0;
}
```

- [ ] **Step 4: Replace the three selection reads**

Site A — combo path, ~line 207. Replace:

```ts
  const selMode = getSetting<{ mode: SelectionMode }>(db, 'selection')?.mode ?? 'lowest-backoff';
```

with:

```ts
  const sel = getSetting<{ mode: SelectionMode; step?: number }>(db, 'selection.minimax') ?? {
    mode: 'lowest-backoff' as SelectionMode,
    step: 1,
  };
```

and ~line 224 update the `selectAccount` opts from `mode: selMode,` to:

```ts
      mode: sel.mode,
      step: sel.step ?? 1,
```

Site B — main MiniMax path, ~line 646. Replace:

```ts
  const selMode = getSetting<{ mode: SelectionMode }>(db, 'selection')?.mode ?? 'lowest-backoff';
```

with:

```ts
  const sel = getSetting<{ mode: SelectionMode; step?: number }>(db, 'selection.minimax') ?? {
    mode: 'lowest-backoff' as SelectionMode,
    step: 1,
  };
```

and in the `selectAccount` call just below, change `mode: selMode,` to:

```ts
    mode: sel.mode,
    step: sel.step ?? 1,
```

Site C — Kiro path, ~line 975. Replace:

```ts
  const kiroSelMode =
    (getSetting(db, 'selection.mode') as SelectionMode | null) ?? 'lowest-backoff';
```

with:

```ts
  const kiroSel = getSetting<{ mode: SelectionMode; step?: number }>(db, 'selection.kiro') ?? {
    mode: 'lowest-backoff' as SelectionMode,
    step: 1,
  };
```

and in the `selectAccount` call below, change `mode: kiroSelMode,` to:

```ts
    mode: kiroSel.mode,
    step: kiroSel.step ?? 1,
```

(Note: site C previously read `selection.mode` — a pre-existing bug; it never matched the `selection` key the dashboard wrote.)

- [ ] **Step 5: Run test, verify pass**

Run: `npx vitest run tests/integration/selection-per-provider.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Run full server suite + typecheck (selection reads are on the hot path)**

Run: `npm test && npm run typecheck`
Expected: PASS. If `tests/integration/proxy-kiro.test.ts` or combo tests fail, check whether they set the old `selection` key and update them to `selection.minimax` / `selection.kiro`.

- [ ] **Step 7: Commit**

```bash
git add src/server.ts tests/integration/selection-per-provider.test.ts
git commit -m "feat(server): read per-provider selection settings keys"
```

---

### Task 3: Selection settings API endpoints

**Files:**
- Modify: `src/api/admin/settings.ts`
- Test: `tests/api/admin/settings-selection.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/api/admin/settings-selection.test.ts` (mirrors the setup in `tests/api/admin/models.test.ts`):

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminApi } from '../../../src/api/admin/index.js';
import { SESSION_COOKIE } from '../../../src/auth.js';
import { setPassword } from '../../../src/auth/password.js';
import { createSession } from '../../../src/auth/session.js';
import { migrate } from '../../../src/db/migrations/index.js';
import { getSetting } from '../../../src/db/repos/settings.js';

let db: Database.Database;
let dir: string;
let app: Hono;
let cookie: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sel-api-'));
  db = new Database(join(dir, 't.db'));
  db.pragma('foreign_keys = ON');
  migrate(db);
  setPassword(db, 'testpass');
  const sess = createSession(db);
  cookie = `${SESSION_COOKIE}=${sess.id}`;
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.route('/api', adminApi());
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true });
});

const authed = () => ({ cookie, host: 'localhost:20137' });
const postHeaders = () => ({
  ...authed(),
  origin: 'http://localhost:20137',
  'content-type': 'application/json',
});

describe('selection settings per provider', () => {
  it('GET returns defaults when unset', async () => {
    const res = await app.request('/api/admin/settings/selection/minimax', { headers: authed() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: 'lowest-backoff', step: 1 });
  });

  it('POST persists and GET round-trips', async () => {
    const post = await app.request('/api/admin/settings/selection/kiro', {
      method: 'POST',
      headers: postHeaders(),
      body: JSON.stringify({ mode: 'round-robin', step: 10 }),
    });
    expect(post.status).toBe(204);
    expect(getSetting(db, 'selection.kiro')).toEqual({ mode: 'round-robin', step: 10 });

    const res = await app.request('/api/admin/settings/selection/kiro', { headers: authed() });
    expect(await res.json()).toEqual({ mode: 'round-robin', step: 10 });
  });

  it('rejects unknown provider with 400', async () => {
    const get = await app.request('/api/admin/settings/selection/openai', { headers: authed() });
    expect(get.status).toBe(400);
    const post = await app.request('/api/admin/settings/selection/openai', {
      method: 'POST',
      headers: postHeaders(),
      body: JSON.stringify({ mode: 'round-robin', step: 1 }),
    });
    expect(post.status).toBe(400);
  });

  it('rejects invalid mode with 400', async () => {
    const res = await app.request('/api/admin/settings/selection/minimax', {
      method: 'POST',
      headers: postHeaders(),
      body: JSON.stringify({ mode: 'fastest', step: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it('coerces invalid step to 1', async () => {
    await app.request('/api/admin/settings/selection/minimax', {
      method: 'POST',
      headers: postHeaders(),
      body: JSON.stringify({ mode: 'round-robin', step: -5 }),
    });
    expect(getSetting(db, 'selection.minimax')).toEqual({ mode: 'round-robin', step: 1 });
  });

  it('old POST /selection route is gone', async () => {
    const res = await app.request('/api/admin/settings/selection', {
      method: 'POST',
      headers: postHeaders(),
      body: JSON.stringify({ mode: 'round-robin' }),
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/admin/settings no longer includes selection', async () => {
    const res = await app.request('/api/admin/settings', { headers: authed() });
    const json = (await res.json()) as Record<string, unknown>;
    expect('selection' in json).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run tests/api/admin/settings-selection.test.ts`
Expected: FAIL — `GET /selection/minimax` returns 404 (route missing), old-route test FAILS (still 204), GET-settings test FAILS (`selection` still present).

- [ ] **Step 3: Implement in `src/api/admin/settings.ts`**

a. In the `GET /` handler, delete the line:

```ts
      selection: getSetting(db, 'selection') ?? { mode: 'lowest-backoff' },
```

b. Delete the line:

```ts
settingsRoutes.post('/selection', post('selection'));
```

c. Add below the remaining `settingsRoutes.post(...)` lines:

```ts
const SELECTION_PROVIDERS = ['minimax', 'kiro'] as const;
type SelectionProvider = (typeof SELECTION_PROVIDERS)[number];
const SELECTION_MODES = ['lowest-backoff', 'round-robin', 'sticky'] as const;

function isSelectionProvider(p: string): p is SelectionProvider {
  return (SELECTION_PROVIDERS as readonly string[]).includes(p);
}

settingsRoutes.get('/selection/:provider', (c) => {
  try {
    const provider = c.req.param('provider');
    if (!isSelectionProvider(provider)) {
      return c.json({ error: 'invalid_provider', message: 'Provider harus minimax atau kiro' }, 400);
    }
    const db = c.get('db') as Database.Database;
    const sel = getSetting<{ mode?: string; step?: number }>(db, `selection.${provider}`);
    return c.json({ mode: sel?.mode ?? 'lowest-backoff', step: sel?.step ?? 1 });
  } catch (e) {
    return handleApiError(e);
  }
});

settingsRoutes.post('/selection/:provider', async (c) => {
  try {
    const provider = c.req.param('provider');
    if (!isSelectionProvider(provider)) {
      return c.json({ error: 'invalid_provider', message: 'Provider harus minimax atau kiro' }, 400);
    }
    const db = c.get('db') as Database.Database;
    const body = await c.req.json<{ mode?: string; step?: number }>();
    if (!body.mode || !(SELECTION_MODES as readonly string[]).includes(body.mode)) {
      return c.json(
        { error: 'invalid_mode', message: `Mode harus salah satu: ${SELECTION_MODES.join(', ')}` },
        400
      );
    }
    const step = Number.isInteger(body.step) && (body.step as number) >= 1 ? (body.step as number) : 1;
    setSetting(db, `selection.${provider}`, { mode: body.mode, step });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
});
```

(`handleApiError`, `getSetting`, `setSetting`, `Database` are already imported in this file.)

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/api/admin/settings-selection.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Check nothing else consumed the removed field**

Run: `npx vitest run tests/api && npm run typecheck`
Expected: PASS. (Client-side `Settings.tsx` still references `selection` — that's Task 6; the client typechecks separately.)

- [ ] **Step 6: Commit**

```bash
git add src/api/admin/settings.ts tests/api/admin/settings-selection.test.ts
git commit -m "feat(api): per-provider selection settings endpoints"
```

---

### Task 4: Manual model add endpoint

**Files:**
- Modify: `src/api/admin/models.ts`
- Test: `tests/api/admin/models.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/admin/models.test.ts` (reuses existing `app`, `authed`, `cookie` fixtures; add a `postHeaders` helper if not present):

```ts
const jsonHeaders = () => ({
  ...authed(),
  origin: 'http://localhost:20137',
  'content-type': 'application/json',
});

describe('POST /api/admin/models — manual add', () => {
  it('creates a model with source=manual', async () => {
    const res = await app.request('/api/admin/models', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        name: 'custom-model-1',
        provider: 'kiro',
        displayName: 'Custom One',
        contextWindow: 128000,
        pricingInput: 1.5,
        pricingOutput: 6,
      }),
    });
    expect(res.status).toBe(201);

    const list = await app.request('/api/admin/models', { headers: authed() });
    const rows = (await list.json()) as Array<{
      name: string;
      provider: string;
      displayName: string | null;
      contextWindow: number | null;
      pricingInput: number | null;
      pricingOutput: number | null;
      source: string;
    }>;
    const row = rows.find((r) => r.name === 'custom-model-1');
    expect(row).toMatchObject({
      provider: 'kiro',
      displayName: 'Custom One',
      contextWindow: 128000,
      pricingInput: 1.5,
      pricingOutput: 6,
      source: 'manual',
    });
  });

  it('optional fields may be omitted', async () => {
    const res = await app.request('/api/admin/models', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: 'bare-model', provider: 'minimax' }),
    });
    expect(res.status).toBe(201);
  });

  it('rejects missing name', async () => {
    const res = await app.request('/api/admin/models', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ provider: 'minimax' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects unknown provider', async () => {
    const res = await app.request('/api/admin/models', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: 'x-model', provider: 'openai' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate name with 409', async () => {
    const res = await app.request('/api/admin/models', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: 'MiniMax-M3', provider: 'minimax' }),
    });
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run tests/api/admin/models.test.ts`
Expected: new describe block FAILS with 404 (route missing); pre-existing tests PASS.

- [ ] **Step 3: Implement the route**

In `src/api/admin/models.ts`, extend the repo import to include `getModel` and `upsertModel`:

```ts
import {
  bulkToggleModels,
  disableModel,
  enableModel,
  getModel,
  listModels,
  upsertModel,
} from '../../db/repos/models.js';
```

Add the route (place it above the `/:name/...` routes for readability; Hono routes by method+path so order is not load-bearing here):

```ts
modelRoutes.post('/', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const body = await c.req.json<{
      name?: string;
      provider?: string;
      displayName?: string;
      contextWindow?: number;
      pricingInput?: number;
      pricingOutput?: number;
    }>();
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      return c.json({ error: 'invalid_body', message: 'Nama model wajib diisi' }, 400);
    }
    if (body.provider !== 'minimax' && body.provider !== 'kiro') {
      return c.json({ error: 'invalid_body', message: 'Provider harus minimax atau kiro' }, 400);
    }
    const name = body.name.trim();
    if (getModel(db, name)) {
      return c.json({ error: 'conflict', message: 'Model dengan nama itu sudah ada' }, 409);
    }
    upsertModel(db, {
      name,
      upstream_model: name,
      display_name: body.displayName?.trim() || null,
      context_window: typeof body.contextWindow === 'number' ? body.contextWindow : null,
      pricing_input: typeof body.pricingInput === 'number' ? body.pricingInput : null,
      pricing_output: typeof body.pricingOutput === 'number' ? body.pricingOutput : null,
      provider: body.provider,
      source: 'manual',
    });
    return c.json({ ok: true }, 201);
  } catch (e) {
    return handleApiError(e);
  }
});
```

Note: `models.upstream_model` has a unique index; a clash on `upstream_model` with a different `name` surfaces via `handleApiError` (500). Acceptable for a single-user dashboard.

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/api/admin/models.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/admin/models.ts tests/api/admin/models.test.ts
git commit -m "feat(api): manual model add endpoint"
```

---

### Task 5: Model health check endpoint

**Files:**
- Create: `src/api/admin/modelHealth.ts`
- Modify: `src/api/admin/models.ts` (new route)
- Test: `tests/api/admin/model-health.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/api/admin/model-health.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminApi } from '../../../src/api/admin/index.js';
import { SESSION_COOKIE } from '../../../src/auth.js';
import { setPassword } from '../../../src/auth/password.js';
import { createSession } from '../../../src/auth/session.js';
import { migrate } from '../../../src/db/migrations/index.js';
import { createAccount, updateAccount } from '../../../src/db/repos/accounts.js';
import { upsertModel } from '../../../src/db/repos/models.js';

let db: Database.Database;
let dir: string;
let app: Hono;
let cookie: string;

/** AWS event-stream frame with zeroed CRCs — mirrors tests/integration/proxy-kiro.test.ts. */
function frame(eventType: string, payload: unknown): Uint8Array {
  const enc = new TextEncoder();
  const name = enc.encode(':event-type');
  const value = enc.encode(eventType);
  const headerLen = 1 + name.length + 1 + 2 + value.length;
  const header = new Uint8Array(headerLen);
  const hv = new DataView(header.buffer);
  let o = 0;
  header[o++] = name.length;
  header.set(name, o);
  o += name.length;
  header[o++] = 7; // value type 7 = string
  hv.setUint16(o, value.length);
  o += 2;
  header.set(value, o);
  const body = enc.encode(JSON.stringify(payload));
  const total = 12 + headerLen + body.length + 4;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, total);
  dv.setUint32(4, headerLen);
  buf.set(header, 12);
  buf.set(body, 12 + headerLen);
  return buf;
}

function kiroStream(frames: Uint8Array[]): Uint8Array {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const f of frames) {
    out.set(f, off);
    off += f.length;
  }
  return out;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'model-health-'));
  db = new Database(join(dir, 't.db'));
  db.pragma('foreign_keys = ON');
  migrate(db);
  upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3', provider: 'minimax' });
  upsertModel(db, { name: 'claude-sonnet-4-5', upstream_model: 'claude-sonnet-4-5', provider: 'kiro' });
  setPassword(db, 'testpass');
  const sess = createSession(db);
  cookie = `${SESSION_COOKIE}=${sess.id}`;
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.route('/api', adminApi());
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true });
  vi.restoreAllMocks();
});

const authed = () => ({ cookie, host: 'localhost:20137' });
const postHeaders = () => ({ ...authed(), origin: 'http://localhost:20137' });

const addMinimaxAccount = () =>
  createAccount(db, { id: 'mm1', label: 'mm', credit_type: 'payg', api_key: 'mm_key' });

const addKiroAccount = () => {
  createAccount(db, {
    id: 'k1',
    label: 'kiro',
    credit_type: 'payg',
    api_key: 'refresh_tok',
    provider: 'kiro',
    provider_data: JSON.stringify({ authMethod: 'social' }),
  });
  // Fresh access token so ensureAccessToken skips the refresh call.
  updateAccount(db, 'k1', {
    access_token: 'at_fresh',
    token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
  });
};

const testModel = (name: string) =>
  app.request(`/api/admin/models/${encodeURIComponent(name)}/test`, {
    method: 'POST',
    headers: postHeaders(),
  });

describe('POST /api/admin/models/:name/test', () => {
  it('minimax: ok on healthy upstream', async () => {
    addMinimaxAccount();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'pong' } }],
            base_resp: { status_code: 0, status_msg: 'ok' },
          }),
          { headers: { 'content-type': 'application/json' } }
        )
    );
    const res = await testModel('MiniMax-M3');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; latencyMs: number };
    expect(json.ok).toBe(true);
    expect(json.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('minimax: base_resp error inside HTTP 200 reports failure', async () => {
    addMinimaxAccount();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ base_resp: { status_code: 1008, status_msg: 'insufficient balance' } }), {
          headers: { 'content-type': 'application/json' },
        })
    );
    const res = await testModel('MiniMax-M3');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; error?: string };
    expect(json.ok).toBe(false);
    expect(json.error).toContain('1008');
  });

  it('minimax: HTTP error reports failure', async () => {
    addMinimaxAccount();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('upstream boom', { status: 500 })
    );
    const res = await testModel('MiniMax-M3');
    const json = (await res.json()) as { ok: boolean; error?: string };
    expect(json.ok).toBe(false);
    expect(json.error).toBeTruthy();
  });

  it('kiro: ok on healthy binary stream', async () => {
    addKiroAccount();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          kiroStream([
            frame('assistantResponseEvent', { content: 'pong' }),
            frame('messageStopEvent', {}),
          ]),
          { headers: { 'content-type': 'application/vnd.amazon.eventstream' } }
        )
    );
    const res = await testModel('claude-sonnet-4-5');
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it('fails cleanly when provider has no enabled account', async () => {
    // No accounts created.
    const res = await testModel('MiniMax-M3');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; error?: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/account/i);
  });

  it('404 for unknown model', async () => {
    const res = await testModel('nope');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run tests/api/admin/model-health.test.ts`
Expected: FAIL — all requests 404 (route missing).

- [ ] **Step 3: Create `src/api/admin/modelHealth.ts`**

```ts
import type Database from 'better-sqlite3';
import { listEnabledAccountsByProvider } from '../../db/repos/accounts.js';
import type { Model } from '../../db/repos/models.js';
import { executeKiro } from '../../providers/kiro/index.js';
import { upstreamHeaders, upstreamUrl } from '../../providers/minimax.js';
import { upstreamFetch } from '../../providers/upstreamFetch.js';
import { resolveTransportForAccount } from '../../transport/resolve.js';

export interface ModelTestResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Fire a minimal 1-turn request at the model's upstream using the first
 * enabled account of its provider. Stateless: nothing written to request_logs.
 */
export async function testModelUpstream(
  db: Database.Database,
  model: Model
): Promise<ModelTestResult> {
  const provider = model.provider === 'kiro' ? 'kiro' : 'minimax';
  const account = listEnabledAccountsByProvider(db, provider)[0];
  if (!account) {
    return { ok: false, latencyMs: 0, error: `Tidak ada account ${provider} yang aktif` };
  }

  const transport = resolveTransportForAccount(db, account);
  const started = Date.now();
  try {
    if (provider === 'kiro') {
      const result = await executeKiro({
        db,
        account,
        model: model.upstream_model,
        body: {
          model: model.upstream_model,
          messages: [{ role: 'user', content: 'ping' }],
          stream: false,
        },
        stream: false,
        transport,
      });
      const latencyMs = Date.now() - started;
      if (!result.ok) {
        return {
          ok: false,
          latencyMs,
          error: result.errorBody?.slice(0, 200) || `HTTP ${result.status}`,
        };
      }
      return { ok: true, latencyMs };
    }

    const acct = { provider: 'minimax' as const, apiKey: account.api_key, baseUrl: account.base_url };
    const url = upstreamUrl(acct, 'openai', '/v1/chat/completions');
    const headers = upstreamHeaders(acct, false, 'openai');
    const resp = await upstreamFetch(
      url,
      {
        model: model.upstream_model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      },
      headers,
      transport
    );
    const latencyMs = Date.now() - started;
    if (!resp.ok) {
      const text = await resp.text();
      return { ok: false, latencyMs, error: text.slice(0, 200) || `HTTP ${resp.status}` };
    }
    // MiniMax signals errors via base_resp inside an HTTP 200 body.
    const json = (await resp.json()) as {
      base_resp?: { status_code?: number; status_msg?: string };
    };
    if (json.base_resp && json.base_resp.status_code !== 0) {
      return {
        ok: false,
        latencyMs,
        error: `base_resp ${json.base_resp.status_code}: ${json.base_resp.status_msg ?? ''}`.trim(),
      };
    }
    return { ok: true, latencyMs };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
```

Type check note: `upstreamUrl`/`upstreamHeaders` take `MinimaxAccount` (`src/providers/minimax.ts:13,21`) — shape `{ provider, apiKey, baseUrl }`. `executeKiro` args are defined at `src/providers/kiro/index.ts:87`. If `OpenAIChatBody` rejects the literal body (e.g. requires more fields), check its definition in `src/providers/kiro/` types and add the minimal missing required fields — do not cast.

- [ ] **Step 4: Wire the route in `src/api/admin/models.ts`**

Add import:

```ts
import { testModelUpstream } from './modelHealth.js';
```

Add route:

```ts
modelRoutes.post('/:name/test', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const model = getModel(db, decodeURIComponent(c.req.param('name')));
    if (!model) return c.json({ error: 'not_found', message: 'Model tidak ditemukan' }, 404);
    const result = await testModelUpstream(db, model);
    return c.json(result);
  } catch (e) {
    return handleApiError(e);
  }
});
```

- [ ] **Step 5: Run test, verify pass**

Run: `npx vitest run tests/api/admin/model-health.test.ts`
Expected: ALL PASS. If the kiro test fails on token refresh, compare account seeding against `tests/integration/proxy-kiro.test.ts` (`access_token` + future `token_expires_at` must be set).

- [ ] **Step 6: Commit**

```bash
git add src/api/admin/modelHealth.ts src/api/admin/models.ts tests/api/admin/model-health.test.ts
git commit -m "feat(api): model health check endpoint"
```

---

### Task 6: Settings page — remove Account selection card

**Files:**
- Modify: `client/src/pages/Settings.tsx` (line 17 interface field, lines ~120-128 mutation, lines ~229-244 card)

- [ ] **Step 1: Remove the three blocks**

a. Delete from the settings interface (line 17):

```ts
  selection?: { mode: string };
```

b. Delete the whole `selectionMut` declaration (lines ~120-128):

```ts
  const selectionMut = useMutation({
    mutationFn: (mode: string) =>
      apiFetch('/api/admin/settings/selection', { method: 'POST', json: { mode } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });
```

c. Delete the whole `<Card title="Account selection" ...>...</Card>` block (lines ~229-244) including its `<select>` and helper `<span>`.

- [ ] **Step 2: Verify client builds and tests pass**

Run (from `client/`): `npx tsc --noEmit -p . && npx vitest run`
Expected: PASS, no unused-variable lint errors. Then from repo root: `npm run lint` — PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/Settings.tsx
git commit -m "refactor(client): drop global account selection card from Settings"
```

---

### Task 7: `SelectionControls` component

**Files:**
- Create: `client/src/components/SelectionControls.tsx`
- Test: `client/src/__tests__/SelectionControls.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/__tests__/SelectionControls.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { VNode } from 'preact';
import { render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectionControls } from '../components/SelectionControls';

vi.mock('../components/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

function wrap(ui: VNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SelectionControls', () => {
  it('shows step input with fetched value when mode is round-robin', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ mode: 'round-robin', step: 3 })
    );
    wrap(<SelectionControls provider="minimax" />);
    await waitFor(() => expect(screen.getByLabelText('Step')).toBeTruthy());
    expect((screen.getByLabelText('Step') as HTMLInputElement).value).toBe('3');
  });

  it('hides step input when mode is lowest-backoff', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ mode: 'lowest-backoff', step: 1 })
    );
    wrap(<SelectionControls provider="kiro" />);
    await waitFor(() => {
      const sel = screen.getByRole('combobox') as HTMLSelectElement;
      expect(sel.value).toBe('lowest-backoff');
    });
    expect(screen.queryByLabelText('Step')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run (from `client/`): `npx vitest run src/__tests__/SelectionControls.test.tsx`
Expected: FAIL — module `../components/SelectionControls` not found.

- [ ] **Step 3: Create `client/src/components/SelectionControls.tsx`**

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useToast } from './ToastProvider';

export interface SelectionSettings {
  mode: string;
  step: number;
}

/** Inline selection mode + step controls for one provider card (auto-saves). */
export function SelectionControls({ provider }: { provider: 'minimax' | 'kiro' }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({
    queryKey: ['selection', provider],
    queryFn: () => apiFetch<SelectionSettings>(`/api/admin/settings/selection/${provider}`),
  });
  const mut = useMutation({
    mutationFn: (body: SelectionSettings) =>
      apiFetch(`/api/admin/settings/selection/${provider}`, { method: 'POST', json: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['selection', provider] });
      toast.success('Saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const mode = data?.mode ?? 'lowest-backoff';
  const step = data?.step ?? 1;

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span class="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>Selection</span>
      <select
        class="input"
        value={mode}
        disabled={mut.isPending}
        onChange={(e) => mut.mutate({ mode: (e.target as HTMLSelectElement).value, step })}
      >
        <option value="lowest-backoff">Lowest backoff</option>
        <option value="round-robin">Round-robin</option>
        <option value="sticky">Sticky</option>
      </select>
      {mode === 'round-robin' && (
        <input
          class="input"
          type="number"
          min={1}
          aria-label="Step"
          style={{ width: 72 }}
          value={step}
          disabled={mut.isPending}
          onChange={(e) => {
            const v = Number((e.target as HTMLInputElement).value);
            if (Number.isInteger(v) && v >= 1) mut.mutate({ mode, step: v });
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

Run (from `client/`): `npx vitest run src/__tests__/SelectionControls.test.tsx`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/SelectionControls.tsx client/src/__tests__/SelectionControls.test.tsx
git commit -m "feat(client): SelectionControls component for per-provider selection"
```

---

### Task 8: Accounts page — split into provider cards

**Files:**
- Modify: `client/src/pages/Accounts.tsx` (render block starting at line 532; modal provider picker)

This file is 928 lines; the changes are confined to the main `return (...)` block (~line 532 onward) and the add-account modal. The table row JSX, all mutations, and the modal form bodies stay byte-identical — they only get re-parented.

- [ ] **Step 1: Import SelectionControls**

Add to imports at the top of `client/src/pages/Accounts.tsx`:

```tsx
import { SelectionControls } from '../components/SelectionControls';
```

- [ ] **Step 2: Compute per-provider lists**

Inside the `Accounts()` component body (after the `accounts` query destructure), add:

```tsx
  const minimaxAccounts = accounts.filter((a) => (a.provider ?? 'minimax') !== 'kiro');
  const kiroAccounts = accounts.filter((a) => a.provider === 'kiro');
```

- [ ] **Step 3: Extract the table into a render helper**

The current render has a single `<Card>` (line 543) containing isError/isLoading/empty guards and one `<table class="tbl">` (line 555) that maps over `accounts`. Refactor:

a. Inside the component (above `return`), define a helper that renders one provider's table. Move the existing `<div style={{ overflowX: 'auto' }}><table class="tbl">…</table></div>` block into it **unchanged except** the `<tbody>` map source changes from `accounts.map((a) => …)` to `list.map((a) => …)`:

```tsx
  const accountsTable = (list: Account[]) =>
    list.length === 0 ? (
      <p class="card-sub">No accounts for this provider yet.</p>
    ) : (
      <div style={{ overflowX: 'auto' }}>
        <table class="tbl">
          {/* thead + tbody moved verbatim from the old single-card render;
              only the tbody map source becomes `list.map((a) => ...)` */}
        </table>
      </div>
    );
```

(The comment above is a move instruction for this plan, not code to keep — the real file holds the full existing `<thead>`/`<tbody>` markup.)

b. Replace the old single `<Card>…</Card>` block with two provider cards. Keep the outer isError/isLoading guards once, above both cards:

```tsx
      {isError ? (
        <ErrorState error={error as Error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={3} cols={6} />
      ) : accounts.length === 0 ? (
        <div class="empty">
          <h3>No upstream accounts</h3>
          <p>Add a MiniMax API key or connect a Kiro (AWS) account to start proxying.</p>
        </div>
      ) : (
        <>
          <Card
            title="MiniMax"
            actions={
              <Button size="sm" onClick={() => { setProvider('minimax'); setOpen(true); }}>
                + Add
              </Button>
            }
          >
            <div style={{ marginBottom: 12 }}>
              <SelectionControls provider="minimax" />
            </div>
            {accountsTable(minimaxAccounts)}
          </Card>
          <Card
            title="Kiro"
            actions={
              <Button size="sm" onClick={() => { setProvider('kiro'); setOpen(true); }}>
                + Add
              </Button>
            }
          >
            <div style={{ marginBottom: 12 }}>
              <SelectionControls provider="kiro" />
            </div>
            {accountsTable(kiroAccounts)}
          </Card>
        </>
      )}
```

c. Remove the old global `+ Add account` button from the `<TopBar actions={...}>` (line ~537) — the per-card `+ Add` buttons replace it. Keep the TopBar itself.

- [ ] **Step 4: Remove the provider picker from the add modal**

In the add-account `<Modal>` JSX, find the provider `<select>` (the control bound to `provider` state via `setProvider` — grep `setProvider` inside the modal body). Delete that select and its label wrapper. The `provider` state variable stays (now set only by the per-card `+ Add` buttons) and continues to drive the conditional minimax-vs-kiro form fields below it.

- [ ] **Step 5: Verify**

Run (from `client/`): `npx tsc --noEmit -p . && npx vitest run`
Expected: PASS.

Manual smoke (optional but recommended): `npm run dev`, open `http://localhost:5173/#/admin/accounts` — two cards render, selection dropdown saves, step input appears only on round-robin, `+ Add` on Kiro card opens modal with Kiro fields and no provider picker.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/Accounts.tsx
git commit -m "feat(client): split Accounts page into per-provider cards with inline selection"
```

---

### Task 9: Models page — provider cards + add modal + test button

**Files:**
- Modify: `client/src/pages/Models.tsx` (243 lines — restructure render, add modal + test state)

- [ ] **Step 1: Remove the provider filter**

Delete:

```tsx
  const [providerFilter, setProviderFilter] = useState<'all' | 'minimax' | 'kiro'>('all');
```

and the `<select value={providerFilter} ...>` block in the render (the one with `All providers` / `MiniMax` / `Kiro` options). Update the `filtered` computation to drop the provider clause:

```tsx
  const filtered = models.filter(
    (m) =>
      !search ||
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.displayName?.toLowerCase().includes(search.toLowerCase())
  );
```

- [ ] **Step 2: Add add-model modal state + mutation**

Add to imports: `Modal` from `'../components/Modal'` (Button, Card, useToast, apiFetch already imported). Inside `Models()`:

```tsx
  const [addOpen, setAddOpen] = useState<null | 'minimax' | 'kiro'>(null);
  const [addForm, setAddForm] = useState({
    name: '',
    displayName: '',
    contextWindow: '',
    pricingInput: '',
    pricingOutput: '',
  });
  const addMut = useMutation({
    mutationFn: () =>
      apiFetch('/api/admin/models', {
        method: 'POST',
        json: {
          name: addForm.name.trim(),
          provider: addOpen,
          displayName: addForm.displayName.trim() || undefined,
          contextWindow: addForm.contextWindow ? Number(addForm.contextWindow) : undefined,
          pricingInput: addForm.pricingInput ? Number(addForm.pricingInput) : undefined,
          pricingOutput: addForm.pricingOutput ? Number(addForm.pricingOutput) : undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['models'] });
      toast.success('Model added');
      setAddOpen(null);
      setAddForm({ name: '', displayName: '', contextWindow: '', pricingInput: '', pricingOutput: '' });
    },
    onError: (e: Error) => toast.error(e.message),
  });
```

- [ ] **Step 3: Add health-test state + runner**

```tsx
  type TestState =
    | { state: 'loading' }
    | { state: 'ok'; ms: number }
    | { state: 'fail'; error: string };
  const [testResults, setTestResults] = useState<Record<string, TestState>>({});
  const runTest = async (name: string) => {
    setTestResults((r) => ({ ...r, [name]: { state: 'loading' } }));
    try {
      const res = await apiFetch<{ ok: boolean; latencyMs: number; error?: string }>(
        `/api/admin/models/${encodeURIComponent(name)}/test`,
        { method: 'POST' }
      );
      setTestResults((r) => ({
        ...r,
        [name]: res.ok
          ? { state: 'ok', ms: res.latencyMs }
          : { state: 'fail', error: res.error ?? 'failed' },
      }));
    } catch (e) {
      setTestResults((r) => ({ ...r, [name]: { state: 'fail', error: (e as Error).message } }));
    }
  };
```

- [ ] **Step 4: Restructure render into two provider cards**

a. Define a card renderer inside the component (above `return`). It reuses the existing table markup; move the current `<table class="tbl">…</table>` block (thead + tbody) into it, mapping over `list` instead of `filtered`:

```tsx
  const providerCard = (provider: 'minimax' | 'kiro', title: string) => {
    const list = filtered.filter((m) => m.provider === provider);
    return (
      <Card
        title={title}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="sm" onClick={() => fetchMut.mutate()} disabled={fetchMut.isPending}>
              {fetchMut.isPending ? 'Fetching…' : 'Fetch from upstream'}
            </Button>
            <Button size="sm" onClick={() => setAddOpen(provider)}>+ Add model</Button>
          </div>
        }
      >
        {list.length === 0 ? (
          <p class="card-sub">No {title} models.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table class="tbl">
              {/* thead + tbody moved verbatim from the old single-card render,
                  mapped over `list`; Provider column removed (redundant per card);
                  new Test column added — see step 4c */}
            </table>
          </div>
        )}
      </Card>
    );
  };
```

(Comment above is a move instruction for this plan — the real file holds the full markup. Keep the bulk-select checkboxes and `selected` logic as-is; `selectAll` keeps operating on `filtered` across both cards.)

b. In the main `return`, replace the single `<Card>…</Card>` with:

```tsx
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <input
          type="search"
          placeholder="Filter by name…"
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          style={{ flex: 1, minWidth: 180 }}
        />
      </div>
      {isError ? (
        <ErrorState error={error as Error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={5} cols={7} />
      ) : (
        <>
          {providerCard('minimax', 'MiniMax')}
          {providerCard('kiro', 'Kiro')}
        </>
      )}
```

Also remove the old `Fetch from upstream` button from `<TopBar actions={...}>` (it now lives in each card header), and keep the bulk-action bar (`selected.size > 0 && …`) above the two cards.

c. In the moved table markup: drop the `<th>Provider</th>` header and its `<td>` cell, and append a `<th>Test</th>` header plus this cell at the end of each row:

```tsx
                    <td>
                      {(() => {
                        const t = testResults[m.name];
                        if (t?.state === 'loading')
                          return <span class="mono" style={{ fontSize: 11 }}>…</span>;
                        if (t?.state === 'ok')
                          return (
                            <span class="mono" style={{ fontSize: 11, color: 'var(--signal)' }}>
                              ✓ {t.ms}ms
                            </span>
                          );
                        if (t?.state === 'fail')
                          return (
                            <span
                              class="mono"
                              style={{ fontSize: 11, color: 'var(--alert)' }}
                              title={t.error}
                            >
                              ✗ {t.error.slice(0, 24)}
                            </span>
                          );
                        return (
                          <Button size="sm" variant="ghost" onClick={() => runTest(m.name)}>
                            Test
                          </Button>
                        );
                      })()}
                    </td>
```

- [ ] **Step 5: Add the modal JSX**

Before the closing fragment of the main `return`, add:

```tsx
      <Modal
        open={addOpen !== null}
        onClose={() => setAddOpen(null)}
        title={`Add ${addOpen === 'kiro' ? 'Kiro' : 'MiniMax'} model`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(null)}>Cancel</Button>
            <Button
              onClick={() => addMut.mutate()}
              disabled={addMut.isPending || !addForm.name.trim()}
            >
              {addMut.isPending ? 'Adding…' : 'Add model'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label>
            Model name
            <input
              class="input"
              value={addForm.name}
              onInput={(e) => setAddForm({ ...addForm, name: (e.target as HTMLInputElement).value })}
              placeholder="exact upstream model id"
            />
          </label>
          <label>
            Display name (optional)
            <input
              class="input"
              value={addForm.displayName}
              onInput={(e) =>
                setAddForm({ ...addForm, displayName: (e.target as HTMLInputElement).value })
              }
            />
          </label>
          <label>
            Context window (optional)
            <input
              class="input"
              type="number"
              value={addForm.contextWindow}
              onInput={(e) =>
                setAddForm({ ...addForm, contextWindow: (e.target as HTMLInputElement).value })
              }
            />
          </label>
          <div style={{ display: 'flex', gap: 10 }}>
            <label style={{ flex: 1 }}>
              Pricing in $/M (optional)
              <input
                class="input"
                type="number"
                value={addForm.pricingInput}
                onInput={(e) =>
                  setAddForm({ ...addForm, pricingInput: (e.target as HTMLInputElement).value })
                }
              />
            </label>
            <label style={{ flex: 1 }}>
              Pricing out $/M (optional)
              <input
                class="input"
                type="number"
                value={addForm.pricingOutput}
                onInput={(e) =>
                  setAddForm({ ...addForm, pricingOutput: (e.target as HTMLInputElement).value })
                }
              />
            </label>
          </div>
        </div>
      </Modal>
```

- [ ] **Step 6: Verify**

Run (from `client/`): `npx tsc --noEmit -p . && npx vitest run`
Expected: PASS.

Manual smoke (optional): dashboard Models page shows two cards; Test button cycles spinner → ✓/✗; Add model creates a `source=manual` row in the right card.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/Models.tsx
git commit -m "feat(client): split Models page into provider cards with add + health test"
```

---

### Task 10: Final verification + docs

**Files:**
- Modify: `CLAUDE.md` (architecture notes)

- [ ] **Step 1: Run all gates**

```bash
npm test
npm run test:client
npm run typecheck
npm run lint
```

Expected: ALL PASS. Fix anything that fails before continuing (likely suspects: stale `selection` key reads in old tests, unused imports after page refactors).

- [ ] **Step 2: Update CLAUDE.md**

In the "Request pipeline (proxy)" section, change step 2 from:

```
2. `selectAccount` (state machine: sticky + round-robin, skips backoff/locked/disabled)
```

to:

```
2. `selectAccount` (state machine: sticky + round-robin w/ step, skips backoff/locked/disabled). Mode + step read per provider from settings keys `selection.minimax` / `selection.kiro` (legacy `selection` key no longer read).
```

In the "Dashboard" section's Pages bullet, after the Models/Aliases sentence, add:

```
Accounts and Models pages render one card per provider (MiniMax, Kiro); Accounts cards embed inline selection mode/step controls (`SelectionControls`), Models cards have manual add (`POST /api/admin/models`) and per-row health test (`POST /api/admin/models/:name/test`, stateless).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: per-provider selection + models page refactor notes"
```
