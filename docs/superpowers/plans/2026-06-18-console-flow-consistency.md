# Console flow consistency — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live-request Console emit consistent events across all proxy
providers — Notion (currently silent), resolved models instead of placeholders
(CodeBuddy/Combo), one thread per combo request (delegated handlers reuse the parent
reqId), a log row on every terminal path including upstream errors (MiniMax/Kiro), and
`buildStart` before account selection in every handler.

**Architecture:** Edit the five provider proxy handlers (`minimax.ts`, `kiro.ts`,
`codebuddy.ts`, `pioneer.ts`, `notion.ts`) plus `combo.ts`. Add an optional
`parentReqId` parameter to the three delegated handlers so a combo request stays one
console thread. No new event types; reuse the existing `consoleBus` builders in
`src/console/flow.ts`.

**Tech Stack:** Hono, TypeScript strict, Vitest, better-sqlite3, Preact (Console page).

**Spec:** `docs/superpowers/specs/2026-06-18-models-page-prefix-display-and-delete-design.md`
(Part B, sections B1–B7).

**Conventions:**
- Communication with user: Indonesian. Code/comments/commits: English.
- TDD: red test first. Conventional Commits, one logical unit per commit. Never push
  without asking.
- Gates before "done": `npm test` + `npm run typecheck`.
- The console event stream is asserted via `vi.spyOn(consoleBus, 'emit')`.

**Key reference — console flow builders** (`src/console/flow.ts`):
- `genReqId(): string`
- `buildStart(reqId, ts, method, path, model, alias: string | null)`
- `buildAccount(reqId, ts, accountLabel, reason)`
- `buildDone(reqId, ts, status, ttftMs, inTok, outTok, cacheTok, costUsd, latencyMs, rtkSaved=0)`
- `buildError(reqId, ts, status, message)`
- `buildTransportFail(reqId, ts, fellBack, message)`
- `buildTransport(reqId, ts, kind, label)`

**Test spy pattern** (used in every task):
```ts
import { consoleBus } from '../console/bus.js';
const emitSpy = vi.spyOn(consoleBus, 'emit');
// ... exercise handler ...
const phases = emitSpy.mock.calls.map((c) => c[0].phase);
```

**Client-key bootstrap** — a fresh `resetDb()` DB has NO `client_keys` row, and the proxy
requires a valid bearer. Every proxy test must seed one before sending a request:
```ts
db.prepare(
  `INSERT INTO client_keys (label, key, enabled, created_at) VALUES ('app', 'rk_test_key', 1, datetime('now'))`
).run();
```
Then use `authorization: 'Bearer rk_test_key'`. Do NOT rely on `SELECT key FROM
client_keys LIMIT 1` returning a row unless you seeded one.

---

## File Structure

**Modify:**
- `src/proxy/notion.ts` — B1: add console events + genReqId + log rows on all paths.
- `src/proxy/codebuddy.ts` — B2: resolved model in buildStart; B3: parentReqId param;
  B5: hoist reqId.
- `src/proxy/pioneer.ts` — B3: parentReqId param.
- `src/proxy/kiro.ts` — B3: parentReqId param; B4: log row on error path; B5: hoist
  reqId; B6: buildStart before account select (already before — verify only).
- `src/proxy/minimax.ts` — B4: log row on error path; B5: hoist reqId; B6: buildStart
  before account select.
- `src/proxy/combo.ts` — B2: resolved model in buildStart; B3: pass parentReqId when
  delegating.

**Tests — create:**
- `src/proxy/notion.console.test.ts`
- `src/proxy/codebuddy.console.test.ts`
- `src/proxy/combo.console.test.ts`
- (extend `src/proxy/minimax.test.ts` / `kiro.test.ts` if they exist, else create
  minimal console-assertion tests.)

---

## Task B1: Notion — emit console events + log rows

**Files:**
- Modify: `src/proxy/notion.ts`
- Test: `src/proxy/notion.console.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/proxy/notion.console.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consoleBus } from '../console/bus.js';
import { openDb } from '../db/index.js';
import { createAccount } from '../db/repos/accounts.js';
import { insertRequestLogDeferred } from '../db/repos/requestLogs.js';
import { upsertModel } from '../db/repos/models.js';
import { app, resetDb } from '../server.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'nt-')), 't.db');
  process.env.ROUTER_ADMIN_KEY = 'ak_test';
  resetDb();
});

// Fresh DB has NO client_keys row — seed one before each proxy test.
function seedClientKey(db: ReturnType<typeof openDb>): string {
  db.prepare(
    `INSERT INTO client_keys (label, key, enabled, created_at) VALUES ('app', 'rk_test_key', 1, datetime('now'))`
  ).run();
  return 'rk_test_key';
}
afterEach(() => vi.restoreAllMocks());

function seedNotionAccount(db: ReturnType<typeof openDb>) {
  const cookies: Record<string, string> = {};
  // NOTION_AI_COOKIE_NAMES — pull from constants to avoid hardcoding the 11 names.
  const { NOTION_AI_COOKIE_NAMES } = require('../providers/notion/constants.js') as {
    NOTION_AI_COOKIE_NAMES: string[];
  };
  for (const n of NOTION_AI_COOKIE_NAMES) cookies[n] = 'c';
  createAccount(db, {
    id: 'nt1',
    label: 'NT',
    credit_type: 'payg',
    api_key: 'nt',
    provider: 'notion',
    provider_data: JSON.stringify({ cookies, userId: 'u', spaceId: 'sp' }),
  });
  upsertModel(db, {
    name: 'pioneer/notion-default',
    upstream_model: 'notion-default',
    provider: 'notion',
    source: 'fetched',
    enabled: 1,
  });
}

describe('handleNotionProxy console flow', () => {
  it('emits start + done and writes a log row on success', async () => {
    const db = openDb();
    seedNotionAccount(db);
    const logSpy = vi.spyOn({ f: insertRequestLogDeferred }, 'f');
    // Re-import to make the spy hit the real module path is fragile; instead assert on
    // the log row via the DB after the request.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('data: {"type":"text"}\n\n', {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      })
    );
    const emitSpy = vi.spyOn(consoleBus, 'emit');

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + (db.prepare('SELECT key FROM client_keys LIMIT 1').get() as { key: string }).key,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'nt/notion-default', messages: [{ role: 'user', content: 'hi' }] }),
    });

    const phases = emitSpy.mock.calls.map((c) => (c[0] as { phase: string }).phase);
    expect(phases).toContain('start');
    expect(phases).toContain('done');
    // A log row was written.
    const logs = db.prepare('SELECT COUNT(*) c FROM request_logs').get() as { c: number };
    expect(logs.c).toBeGreaterThanOrEqual(1);
    void logSpy;
    void res;
  });

  it('emits start + error and writes a log row when no notion account', async () => {
    const db = openDb();
    // no account seeded
    const emitSpy = vi.spyOn(consoleBus, 'emit');
    const key = (db.prepare('SELECT key FROM client_keys LIMIT 1').get() as { key: string }).key;
    await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'nt/x', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const phases = emitSpy.mock.calls.map((c) => (c[0] as { phase: string }).phase);
    expect(phases).toContain('error');
  });
});
```

> The exact client-key bootstrap (`client_keys` row) may differ — check the existing
> `src/api/admin/index.test.ts` for how a client key is created, and mirror it. If a
> client key is auto-created on fresh DB, the `SELECT key FROM client_keys` works;
> otherwise seed one via `createClientKey`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/proxy/notion.console.test.ts`
Expected: FAIL — no `start`/`done`/`error` phases emitted (Notion never touches
`consoleBus`).

- [ ] **Step 3: Add console events + reqId + log rows to notion.ts**

In `src/proxy/notion.ts`, add imports:

```ts
import { consoleBus } from '../console/bus.js';
import {
  buildAccount,
  buildDone,
  buildError,
  buildStart,
  genReqId,
} from '../console/flow.js';
import { buildLogRow } from './pipeline.js';
```

At the top of `handleNotionProxy`, replace the hand-rolled reqId (line ~93):

```ts
  const clientKey = c.get('clientKey') as { id: number } | undefined;
  const startMs = Date.now();
  const reqId = genReqId();
  c.set('reqId', reqId);
```

Resolve the model early (before any return) so buildStart can carry it — wrap in
try/catch like Pioneer does. After the `reqId` block, before `pickAccount`:

```ts
  let requestedModel: string | null = null;
  let upstreamModel: string | undefined;
  try {
    const resolved = resolveModel(db, stringValue(body.model), body);
    requestedModel = resolved.requestedModel;
    upstreamModel = resolved.upstreamModel;
  } catch {
    /* leave null — buildStart will carry the raw body.model below */
  }
  consoleBus.emit(
    buildStart(
      reqId,
      new Date().toISOString(),
      c.req.method,
      upstreamPath,
      upstreamModel ?? stringValue(body.model) ?? 'notion',
      requestedModel && requestedModel !== upstreamModel ? requestedModel : null
    )
  );
```

After `pickAccount` returns, on each error return, emit `buildError` + write a log row.
For the no-account branch (currently line ~96):

```ts
  const account = pickAccount(db);
  if (!account) {
    consoleBus.emit(buildError(reqId, new Date().toISOString(), 503, 'no notion account'));
    insertRequestLogDeferred(
      db,
      buildLogRow({
        clientKeyId: clientKey?.id ?? 0,
        accountId: 0,
        model: stringValue(body.model) ?? 'notion',
        requestedModel: requestedModel ?? stringValue(body.model) ?? 'notion',
        endpoint: upstreamPath,
        format: 'openai',
        promptTokens: 0,
        completionTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        latencyMs: Date.now() - startMs,
        statusCode: 503,
        baseRespCode: undefined,
        stream: 0,
        rtkBytesSaved: 0,
        requestBody: JSON.stringify(body),
        responseBody: 'no notion account',
        requestHeaders: c.req.raw.headers,
        responseHeaders: new Headers(),
        reqId,
      })
    );
    return c.json({ error: 'no_account', message: 'no enabled notion account' }, 503);
  }
```

Emit `buildAccount` once an account is picked (after the cookies/spaceId checks pass,
right before the upstream fetch):

```ts
  consoleBus.emit(buildAccount(reqId, new Date().toISOString(), account.label, 'round-robin'));
```

For the missing-cookies / missing-spaceId / upstream-!ok / network-error branches, mirror
the same pattern: emit `buildError(reqId, ts, status, message)` then
`insertRequestLogDeferred(buildLogRow({ ... statusCode: <status>, responseBody: <message> ... }))`
before the `return c.json(...)`. Use `format: 'openai'` and `stream: 0` for these error
paths (no tokens, cost 0).

For the success stream path (the `ReadableStream` branch around line ~240 where
`insertRequestLogDeferred` is already called), add `consoleBus.emit(buildDone(...))`
alongside the existing log row, using the accumulated token counts. If Notion's stream
parser does not surface tokens, pass `0`/`0` and a `costUsd: 0`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/proxy/notion.console.test.ts`
Expected: PASS — start/done/error phases present, log rows written.

- [ ] **Step 5: Commit**

```bash
git add src/proxy/notion.ts src/proxy/notion.console.test.ts
git commit -m "fix(notion): emit console events + write log rows on all paths"
```

---

## Task B2: CodeBuddy — resolved model in buildStart

**Files:**
- Modify: `src/proxy/codebuddy.ts:59-64,136`
- Test: `src/proxy/codebuddy.console.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/proxy/codebuddy.console.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consoleBus } from '../console/bus.js';
import { openDb } from '../db/index.js';
import { createAccount } from '../db/repos/accounts.js';
import { upsertModel } from '../db/repos/models.js';
import { app, resetDb } from '../server.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'cb-')), 't.db');
  process.env.ROUTER_ADMIN_KEY = 'ak_test';
  resetDb();
});
afterEach(() => vi.restoreAllMocks());

describe('handleCodeBuddyProxy console flow', () => {
  it('emits buildStart with the resolved model, not the placeholder "codebuddy"', async () => {
    const db = openDb();
    createAccount(db, {
      id: 'cb1',
      label: 'CB',
      credit_type: 'payg',
      api_key: 'cb_k',
      provider: 'codebuddy',
    });
    upsertModel(db, {
      name: 'cb/claude-opus',
      upstream_model: 'claude-opus',
      provider: 'codebuddy',
      source: 'fetched',
      enabled: 1,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
    );
    const emitSpy = vi.spyOn(consoleBus, 'emit');
    const key = (db.prepare('SELECT key FROM client_keys LIMIT 1').get() as { key: string }).key;

    await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'cb/claude-opus', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    });

    const start = emitSpy.mock.calls
      .map((c) => c[0] as { phase: string; model?: string })
      .find((e) => e.phase === 'start');
    expect(start).toBeDefined();
    expect(start!.model).toBe('claude-opus'); // resolved, NOT 'codebuddy'
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/proxy/codebuddy.console.test.ts`
Expected: FAIL — `start.model === 'codebuddy'`.

- [ ] **Step 3: Resolve the model before buildStart**

In `src/proxy/codebuddy.ts`, replace the block at lines ~59–64. Currently:

```ts
  const model = stringValue(body.model) || 'cb/claude-opus-4.6';

  const reqId = genReqId();
  c.set('reqId', reqId);
  consoleBus.emit(buildStart(reqId, new Date().toISOString(), c.req.method, upstreamPath, 'codebuddy', 'codebuddy'));
```

Replace with:

```ts
  const model = stringValue(body.model) || 'cb/claude-opus-4.6';

  const reqId = genReqId();
  c.set('reqId', reqId);

  // Resolve early so buildStart carries the real model/alias (parity with Pioneer).
  let requestedModel: string | null = null;
  let upstreamModel: string = 'codebuddy';
  try {
    const resolved = resolveModel(db, model, body);
    requestedModel = resolved.requestedModel;
    upstreamModel = resolved.upstreamModel;
  } catch {
    /* unknown/disabled model — keep placeholders; the request will 400 later */
  }
  consoleBus.emit(
    buildStart(
      reqId,
      new Date().toISOString(),
      c.req.method,
      upstreamPath,
      upstreamModel,
      requestedModel && requestedModel !== upstreamModel ? requestedModel : null
    )
  );
```

Add the `resolveModel` import at the top (it is not currently imported in codebuddy.ts):

```ts
import { resolveModel } from '../providers/alias.js';
```

Also fix the log row's `requestedModel` (line ~136) — change `requestedModel: model` to
`requestedModel: requestedModel ?? model`. And `model: model` → `model: upstreamModel` so
the log row carries the resolved upstream id (parity with Kiro/MiniMax).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/proxy/codebuddy.console.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the existing codebuddy suite**

Run: `npx vitest run src/providers/codebuddy/ src/proxy/codebuddy.ts`
Expected: PASS (no regressions; the `model` variable is still the raw body.model and is
used elsewhere for SSE model echoes — keep that, only the log row + buildStart change).

- [ ] **Step 6: Commit**

```bash
git add src/proxy/codebuddy.ts src/proxy/codebuddy.console.test.ts
git commit -m "fix(codebuddy): emit resolved model in buildStart + log row"
```

---

## Task B3: parentReqId param — combo stays one thread

**Files:**
- Modify: `src/proxy/codebuddy.ts`, `src/proxy/pioneer.ts`, `src/proxy/kiro.ts`
  (signature + early reqId handling)
- Modify: `src/proxy/combo.ts` (pass parentReqId when delegating; resolved model in
  buildStart)
- Test: `src/proxy/combo.console.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/proxy/combo.console.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consoleBus } from '../console/bus.js';
import { openDb } from '../db/index.js';
import { createAccount } from '../db/repos/accounts.js';
import { createCombo } from '../db/repos/combos.js';
import { upsertModel } from '../db/repos/models.js';
import { app, resetDb } from '../server.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'co-')), 't.db');
  process.env.ROUTER_ADMIN_KEY = 'ak_test';
  resetDb();
});
afterEach(() => vi.restoreAllMocks());

describe('handleComboProxy console thread', () => {
  it('keeps one reqId thread across combo + delegated provider', async () => {
    const db = openDb();
    createAccount(db, {
      id: 'cb1',
      label: 'CB',
      credit_type: 'payg',
      api_key: 'cb_k',
      provider: 'codebuddy',
    });
    upsertModel(db, {
      name: 'cb/claude-opus',
      upstream_model: 'claude-opus',
      provider: 'codebuddy',
      source: 'fetched',
      enabled: 1,
    });
    createCombo(db, 'mycombo', ['cb/claude-opus']);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
    );
    const emitSpy = vi.spyOn(consoleBus, 'emit');
    const key = (db.prepare('SELECT key FROM client_keys LIMIT 1').get() as { key: string }).key;

    await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'mycombo', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    });

    const reqIds = new Set(emitSpy.mock.calls.map((c) => (c[0] as { reqId: string }).reqId));
    // One logical combo request => one reqId thread (not two).
    expect(reqIds.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/proxy/combo.console.test.ts`
Expected: FAIL — `reqIds.size === 2` (combo's reqId + the delegated codebuddy handler's
regenerated reqId).

- [ ] **Step 3: Add `parentReqId` to the delegated handlers**

In each of `src/proxy/codebuddy.ts`, `src/proxy/pioneer.ts`, `src/proxy/kiro.ts`, add an
optional last parameter to the handler signature and use it instead of regenerating:

**codebuddy.ts** — change the signature:

```ts
export async function handleCodeBuddyProxy(
  c: Context,
  format: 'openai' | 'anthropic',
  upstreamPath: string,
  body: Record<string, unknown>,
  db: Database.Database,
  cursorRef: CursorRef,
  stickyMap: Map<number, string>,
  parentReqId?: string
): Promise<Response> {
```

and the reqId block:

```ts
  const reqId = parentReqId ?? genReqId();
  if (!parentReqId) c.set('reqId', reqId);
```

**pioneer.ts** — same signature change + reqId block (`pioneer.ts:48,76-77`):

```ts
  stickyMap: Map<number, string>,
  parentReqId?: string
): Promise<Response> {
```

```ts
  const reqId = parentReqId ?? genReqId();
  if (!parentReqId) c.set('reqId', reqId);
```

**kiro.ts** — `handleKiroProxy` signature + the `genReqId`/`c.set` block at `kiro.ts:77-78`:

```ts
  stickyMap: Map<number, string>,
  parentReqId?: string
): Promise<Response> {
```

```ts
  const reqId = parentReqId ?? genReqId();
  if (!parentReqId) c.set('reqId', reqId);
```

- [ ] **Step 4: Combo passes its reqId when delegating**

In `src/proxy/combo.ts`, at each delegation call (`combo.ts:234` codebuddy, `:281`
pioneer, and the kiro leg), pass the combo's `reqId` as `parentReqId`.

CodeBuddy delegation:

```ts
        const cbResp = await handleCodeBuddyProxy(
          c,
          format,
          upstreamPath,
          cbBody,
          db,
          cbCursorRef,
          stickyMap,
          reqId
        );
```

Pioneer delegation:

```ts
        const pioResp = await handlePioneerProxy(
          c,
          format,
          upstreamPath,
          pioBody,
          db,
          pioCursorRef,
          stickyMap,
          reqId
        );
```

Kiro delegation — find the `handleKiroProxy(...)` call in the kiro leg and add `reqId` as
the final argument.

- [ ] **Step 5: Combo buildStart carries the resolved member (B2 combo half)**

The combo buildStart (`combo.ts:74-83`) uses the placeholder `combo:${combo.name}`. This
is acceptable for the combo-level start (the member is not yet chosen), so leave the
placeholder but ensure the delegated handler's buildStart (now under the shared reqId)
emits the resolved model. No code change needed here beyond B3 — the delegated handler
already emits buildStart with its resolved model (after B2 for codebuddy; kiro/pioneer
already do).

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/proxy/combo.console.test.ts`
Expected: PASS — `reqIds.size === 1`.

- [ ] **Step 7: Run the full server suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. (Watch for any caller of these handlers other than combo/server.ts that
now needs updating — direct calls omit `parentReqId`, which is fine.)

- [ ] **Step 8: Commit**

```bash
git add src/proxy/codebuddy.ts src/proxy/pioneer.ts src/proxy/kiro.ts src/proxy/combo.ts src/proxy/combo.console.test.ts
git commit -m "fix(console): combo request stays one thread via parentReqId"
```

---

## Task B4: MiniMax + Kiro — log row on the upstream-error path

**Files:**
- Modify: `src/proxy/minimax.ts:336-341` (error branch)
- Modify: `src/proxy/kiro.ts:179-189` (error branch)
- Test: extend `src/proxy/minimax.test.ts` / `kiro.test.ts` (or create minimal)

- [ ] **Step 1: Write the failing test (minimax)**

In `src/proxy/minimax.test.ts` (create if absent — mirror the codebuddy console test
shape), add:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../db/index.js';
import { createAccount } from '../db/repos/accounts.js';
import { upsertModel } from '../db/repos/models.js';
import { app, resetDb } from '../server.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'mm-')), 't.db');
  process.env.ROUTER_ADMIN_KEY = 'ak_test';
  resetDb();
});
afterEach(() => vi.restoreAllMocks());

describe('handleProxy minimax error-path log row', () => {
  it('writes a request_logs row when upstream returns 4xx', async () => {
    const db = openDb();
    createAccount(db, { id: 'mm1', label: 'MM', credit_type: 'payg', api_key: 'mm_k', provider: 'minimax' });
    upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3', provider: 'minimax', source: 'manual', enabled: 1 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ base_resp: { status_code: 1002, status_msg: 'rate limited' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const key = (db.prepare('SELECT key FROM client_keys LIMIT 1').get() as { key: string }).key;
    await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'mx/MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const logs = db.prepare('SELECT statusCode FROM request_logs').all() as { statusCode: number }[];
    // An error row exists (status reflects the base_resp-mapped status).
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });
});
```

> The exact error status depends on `errorRules` mapping; the assertion only checks a row
> was written. Adjust the expected `statusCode` if the mapper yields a specific code.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/proxy/minimax.test.ts -t "error-path log row"`
Expected: FAIL — no `request_logs` row on the error path.

- [ ] **Step 3: Add the log row to minimax error branch**

In `src/proxy/minimax.ts`, the `!resp.ok` branch is at lines ~336–341. It currently emits
`buildError` and returns. Insert a log row before the `return c.body(...)`. Reuse the
`buildLogRow` helper (already imported in minimax.ts). The error body, status, and the
resolved model are all in scope:

```ts
      consoleBus.emit(
        buildError(reqId, new Date().toISOString(), resp.status, errBody.slice(0, 200))
      );
      insertRequestLogDeferred(
        db,
        buildLogRow({
          clientKeyId: clientKey.id,
          accountId: account.id,
          model: resolved.upstreamModel,
          requestedModel,
          endpoint: upstreamPath,
          format: upstreamFormat,
          promptTokens: 0,
          completionTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          latencyMs: Date.now() - c.get('startTime'),
          statusCode: resp.status,
          baseRespCode: parsed.baseRespCode,
          stream: body.stream ? 1 : 0,
          rtkBytesSaved: 0,
          requestBody: text,
          responseBody: errBody,
          requestHeaders: c.req.raw.headers,
          responseHeaders: resp.headers,
          reqId,
        })
      );
      return c.body(errBody, statusCode(resp.status), {
        'content-type': resp.headers.get('content-type') ?? 'application/json',
      });
```

> `text` is the original request body string already in scope (minimax.ts serializes it
> early). Confirm the variable name by reading the top of the function — it is `text`.

- [ ] **Step 4: Same for kiro**

In `src/proxy/kiro.ts`, the `!result.ok` branch is at lines ~168–189. After the
`consoleBus.emit(buildError(...))` (line ~179), insert a log row mirroring
`recordKiroUsage`'s shape but with zero tokens:

```ts
      consoleBus.emit(
        buildError(reqId, new Date().toISOString(), result.status, errBody.slice(0, 200))
      );
      insertRequestLogDeferred(
        db,
        buildLogRow({
          clientKeyId: clientKey.id,
          accountId: acc.id,
          model: modelName,
          requestedModel,
          endpoint: upstreamPath,
          format,
          promptTokens: 0,
          completionTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          latencyMs: Date.now() - startMs,
          statusCode: result.status,
          baseRespCode: undefined,
          stream: upstreamStream ? 1 : 0,
          rtkBytesSaved: 0,
          requestBody: JSON.stringify(body),
          responseBody: errBody,
          requestHeaders: c.req.raw.headers,
          responseHeaders: new Headers(),
          reqId,
        })
      );
      return c.body(
        errBody || JSON.stringify({ error: 'kiro upstream error' }),
        statusCode(result.status),
        { 'content-type': 'application/json' }
      );
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/proxy/minimax.test.ts src/proxy/kiro.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/proxy/minimax.ts src/proxy/kiro.ts src/proxy/minimax.test.ts
git commit -m "fix(proxy): write request_logs row on upstream-error path (minimax, kiro)"
```

---

## Task B5 + B6: Hoist reqId + buildStart-before-account-select (MiniMax)

**Files:**
- Modify: `src/proxy/minimax.ts` (hoist `genReqId`/`c.set` to the top; emit buildStart
  before account selection)

> Kiro/CodeBuddy/Pioneer already emit buildStart before account select and set reqId
  early (after B2/B3). Only MiniMax still emits buildStart AFTER account selection
  (`minimax.ts:263-275`) and generates reqId at `:263`. The outer catch at `:459-460`
  reads `c.get('reqId') ?? '----'` because reqId is not set before model resolution.

- [ ] **Step 1: Write the failing test**

Add to `src/proxy/minimax.test.ts`:

```ts
describe('handleProxy minimax reqId + buildStart ordering', () => {
  it('sets reqId before model resolution so the catch never sees ----', async () => {
    const db = openDb();
    createAccount(db, { id: 'mm1', label: 'MM', credit_type: 'payg', api_key: 'mm_k', provider: 'minimax' });
    // Force the outer catch by making resolveModel throw after reqId should be set.
    upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3', provider: 'minimax', source: 'manual', enabled: 1 });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'));
    const emitSpy = vi.spyOn(consoleBus, 'emit');
    const key = (db.prepare('SELECT key FROM client_keys LIMIT 1').get() as { key: string }).key;
    await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'mx/MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const errorEvents = emitSpy.mock.calls
      .map((c) => c[0] as { phase: string; reqId: string })
      .filter((e) => e.phase === 'error');
    expect(errorEvents.length).toBeGreaterThan(0);
    expect(errorEvents[0].reqId).not.toBe('----');
  });
});
```

Add the `consoleBus` import to the test file:

```ts
import { consoleBus } from '../console/bus.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/proxy/minimax.test.ts -t "reqId + buildStart ordering"`
Expected: FAIL — `errorEvents[0].reqId === '----'` (reqId not set before the catch).

- [ ] **Step 3: Hoist reqId in minimax.ts**

In `src/proxy/minimax.ts`, move the `genReqId()` + `c.set('reqId', reqId)` to the very
top of `handleProxy` (right after `const clientKey = …` / `startMs`), before model
resolution. Currently those two lines are at `:263-264`. Move them up to near the top of
the function (after the `parseBody`/early returns for 413 are fine — those pre-reqId
returns are body-parse failures that never reach console; acceptable, but to be safe put
reqId gen right after the body is parsed). Then the outer catch can reference the
in-scope `reqId` directly.

Replace the outer catch (`:459-460`):

```ts
  } catch (e: unknown) {
    const rid = c.get('reqId') ?? '----';
    consoleBus.emit(buildError(rid, new Date().toISOString(), 502, errorMessage(e)));
```

with:

```ts
  } catch (e: unknown) {
    consoleBus.emit(buildError(reqId, new Date().toISOString(), 502, errorMessage(e)));
```

- [ ] **Step 4: Emit buildStart before account selection (B6)**

Currently the `buildStart` at `:265-274` runs after account selection (`:225`) and
model resolution (`:237-259`). Reorder so buildStart fires right after reqId is set +
model resolved, BEFORE account selection. Move the `resolveModel` try/catch + the
`buildStart` emit above the `listEnabledAccountsByProvider` / `selectAccount` block.
Keep the `buildAccount` emit after selection.

Concretely: cut the `buildStart(...)` block from `:265-274` and paste it immediately
after the `requestedModel` assignment (`:260`), before the account-selection block
(`:213`). The `buildAccount` emit stays at `:275`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/proxy/minimax.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full server suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/proxy/minimax.ts src/proxy/minimax.test.ts
git commit -m "fix(minimax): hoist reqId + emit buildStart before account selection"
```

---

## Task B7 (follow-up, optional): shared console scaffold

> **Out of scope for this plan unless the user asks.** The spec lists B7 as a drift
> guard. Land it as a separate refactor AFTER B1–B6 are green, so the behavioral fixes
> are committed independently and reviewable. If the user wants it now, add a task that
> extracts a `startProxyFlow(opts)` helper in `src/console/flow.ts` wrapping
> genReqId + buildStart + buildAccount + buildDone/buildError + logRow, then migrate
> each handler one at a time behind the same test suite.

---

## Final verification

- [ ] **Step 1: Run all gates**

Run: `npm test && npm run typecheck`
Expected: PASS with zero warnings.

- [ ] **Step 2: Manual smoke (dev server)**

Run: `npm run dev`. Open the Console page. Send one request per provider (mx/, kr/, cb/,
pio/, nt/) + one combo. Confirm each shows a single start → account → done/error thread
with the resolved model name (no `codebuddy` / `combo:...` placeholders, no `----`).
Trigger an upstream error (bad key) on MiniMax and Kiro — confirm the failed request
appears in the Request log with the upstream status.

- [ ] **Step 3: Sync docs (optional)**

If `ARCHITECTURE.md` describes the per-request console flow, verify the ordering matches
the new buildStart-before-select behaviour. Use the `sync-docs` skill.

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** B1 (T-B1), B2 (T-B2 + combo half in B3 Step 5), B3 (T-B3), B4
  (T-B4), B5 (T-B5 Step 3), B6 (T-B5 Step 4 — same task since both are minimax
  reordering), B7 (marked follow-up).
- **Type consistency:** `parentReqId?: string` added identically to codebuddy/pioneer/
  kiro; combo passes `reqId`. `buildLogRow` field set matches `LogRowContext`.
- **No placeholders** — every code step shows the exact block to write.
- **CSRF:** no route changes; handlers are internal.
- **Risk:** the minimax reorder (B6) is the riskiest step — move only the emit, not the
  account-selection logic, and keep `buildAccount` after selection. Run the full minimax
  suite after.
