# Playbooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create 6 step-by-step playbooks under `docs/guides/` covering the most common contributor tasks: add a provider, add an admin endpoint, add a dashboard page, add a migration, debug a failed request, ship a release.

**Architecture:** Markdown how-tos. Each playbook follows a fixed structure: Goal → Prerequisites → File map → Step-by-step (file:line references throughout) → Test → Commit. Designed so a contributor who has read AGENTS.md + MEMORY.md can execute without asking. No new code, no tests, no deps. Each playbook is independent — the plan ships them one at a time so partial value lands early.

**Tech Stack:** Plain Markdown. No new dependencies. Validation: `npm run typecheck` and `npm test` should stay green (docs only).

---

## File Structure

### Files created in this plan

| File | Purpose | Refs |
|---|---|---|
| `docs/guides/add-a-provider.md` | Wire a new upstream provider (Anthropic, Azure, …) alongside MiniMax/Kiro | `src/proxy/{minimax,kiro,combo}.ts`, `src/db/repos/accounts.ts`, `src/db/migrations/`, `src/providers/` |
| `docs/guides/add-an-admin-endpoint.md` | Add a `/api/admin/*` route | `src/api/admin/{index,middleware,accounts,transports}.ts` |
| `docs/guides/add-a-dashboard-page.md` | Add a Preact page | `client/src/pages/`, `client/src/layout/{AppShell,Sidebar,TopBar}.tsx`, `client/src/lib/api.ts` |
| `docs/guides/add-a-migration.md` | Add a new `src/db/migrations/00X-*.ts` | `src/db/migrations/{001..005,index}.ts` |
| `docs/guides/debug-a-failed-request.md` | Trace a request through the proxy | `src/proxy/`, `src/accounts/`, `src/console/`, `src/streaming/` |
| `docs/guides/ship-a-release.md` | Version bump + changelog + tag | `package.json`, `CHANGELOG.md` |

### Files NOT touched

- Source code. No edits. Playbooks are read-only references to existing structure.
- AGENTS.md / MEMORY.md updates are scheduled in Task 7 of this plan (MEMORY.md gain a "Playbooks" link block).

---

## Conventions for all 6 playbooks

1. **H1 title** with the action ("Add a Provider", etc.).
2. **One-paragraph goal** at the top.
3. **Prerequisites** as a bullet list — what the contributor should have read and what's in their environment.
4. **File map** — a tree of every file they'll touch (Create vs Modify) with a one-line purpose for each.
5. **Numbered steps**, each starting with a verb. Each step lists:
   - File path (or `**Files:**` for the step's edit scope)
   - The code to add (code block) or the action to take
   - Why this step matters (1 line)
6. **Test section** — the exact commands to run and what should be green.
7. **Commit section** — the conventional-commit subject and body template, with `Co-Authored-By` trailer.
8. **Checklist** at the end (5-8 boxes) so the contributor can tick off completion.
9. **See also** at the bottom — links to the related files in `docs/reference/` and `docs/adr/`.

---

### Task 1: Create `docs/guides/add-a-provider.md`

**Files:**
- Create: `docs/guides/add-a-provider.md`
- Reference: `src/proxy/{minimax,kiro,combo}.ts`, `src/db/repos/accounts.ts`, `src/db/migrations/`, `src/providers/`, `src/api/admin/accounts.ts`

- [x] **Step 1: Write `docs/guides/add-a-provider.md`**

Create the file with this content (exact paste):

```markdown
# Add an Upstream Provider

Add a third upstream provider alongside MiniMax and Kiro. Examples: Azure OpenAI, AWS Bedrock, a self-hosted llama.cpp gateway. The router already has a two-provider architecture (provider key on `accounts` and `models`, branch in `handleProxy`); this playbook shows the integration points.

## Goal

A new provider `foo` that:
- Has its own `provider='foo'` value on `accounts` and `models` rows
- Authenticates with `accounts.api_key` (or its own column if it needs a different credential)
- Sends requests via a dedicated module under `src/providers/foo/`
- Streams responses back as OpenAI and/or Anthropic SSE
- Surfaces errors through the existing `checkFallbackError` pipeline
- Is selectable in the dashboard and the CLI seed scripts

## Prerequisites

- Read [`ARCHITECTURE.md`](../../ARCHITECTURE.md) — module map + state machines
- Read [`CLAUDE.md`](../../CLAUDE.md) — proxy pipeline overview
- Read the existing Kiro provider as a reference implementation: `src/providers/kiro/`
- Have a working dev env: `npm run dev` + a fresh test DB

## File map

```
src/
├── providers/
│   └── foo/                       NEW
│       ├── auth.ts                ensure + refresh credentials (mirror kiro/auth.ts)
│       ├── transform.ts           build outbound body (client format → foo format)
│       ├── stream.ts              parse foo stream → OpenAI/Anthropic SSE
│       ├── upstreamFetch.ts       fetch w/ provider-specific quirks
│       └── index.ts               executeFoo (orchestrator)
├── proxy/
│   └── foo.ts                     NEW — handleFooProxy, parallel to kiro.ts
├── db/
│   ├── repos/
│   │   └── accounts.ts            EXTEND — add `foo` to the `provider` enum + helpers
│   └── migrations/
│       └── 00X-foo.ts             NEW — additive columns on `accounts` if needed
├── api/admin/
│   └── accounts.ts                EXTEND — add `POST /api/admin/accounts/foo` if foo needs its own auth flow
├── scripts/
│   ├── seed-foo-models.ts         NEW — upsert builtin foo models
│   └── add-foo-account.ts         NEW — CLI to add a foo account
└── server.ts                      EXTEND — route `/v1/*` requests for foo provider to `handleFooProxy`
```

## Steps

### 1. Add the provider enum

**File:** `src/db/repos/accounts.ts`

Find the `ProviderName` type:
```ts
export type ProviderName = 'minimax' | 'kiro';
```

Extend it:
```ts
export type ProviderName = 'minimax' | 'kiro' | 'foo';
```

Find the `provider` column default and any switch statements on `provider` and add `'foo'`. Use `grep -rEn "provider.*'minimax'|'kiro'" src/` to find all sites.

**Why:** TypeScript will refuse to compile if you forget this — a feature, not a bug.

### 2. Write a migration (only if foo needs extra columns)

**File:** `src/db/migrations/00X-foo.ts` (new)

```ts
/**
 * Migration 00X — foo provider credentials.
 * Additive only. Mirrors 002-kiro.
 */
export const migration_00X = {
  id: 6, // current user_version is 5; next is 6
  name: 'foo-provider',
  sql: `
    -- example: foo needs an org_id in addition to api_key
    ALTER TABLE accounts ADD COLUMN foo_org_id TEXT;
  `,
};
```

Then register it in `src/db/migrations/index.ts`:
```ts
import { migration_00X } from './00X-foo.js';
// ...
const ALL_MIGRATIONS = [
  migration_001,
  migration_002,
  migration_003,
  migration_004,
  migration_005,
  migration_00X,  // new
];
```

**Why:** Existing DBs must upgrade in place. Never rewrite rows in a migration.

### 3. Implement the auth module

**File:** `src/providers/foo/auth.ts` (new)

Mirror `src/providers/kiro/auth.ts`:
- `ensureAccessToken(db, account): Promise<string>` — return a valid bearer, refresh if within a 5-min buffer
- `refreshFooToken(account): Promise<{ access_token, expires_at }>`
- Persist refreshed values to `accounts.access_token` / `accounts.token_expires_at`

**Why:** Centralized credential lifecycle. `handleFooProxy` calls `ensureAccessToken` once per request, never inline.

### 4. Implement the request transform

**File:** `src/providers/foo/transform.ts` (new)

Convert an OpenAI chat-completions body to foo's wire format. The function signature should mirror `buildKiroPayload`:
```ts
export function buildFooPayload(
  openaiBody: ChatCompletionRequest,
  account: Account
): FooRequest
```

Things to handle:
- System / tool messages folded into the user turn (if foo doesn't have a system role)
- Image content blocks (if foo supports vision)
- Stop sequences, temperature, max_tokens
- Tool / function definitions (if foo has tool use)
- Stream flag — output format must include a stream indicator

**Why:** Each provider has its own quirks. Keeping the transform isolated makes it testable.

### 5. Implement the response stream

**File:** `src/providers/foo/stream.ts` (new)

If foo speaks SSE, parse it into OpenAI chunks and a buffered `chat.completion`. If foo speaks a binary protocol (like Kiro's event-stream), see `src/providers/kiro/eventstream.ts` + `assembler.ts` + `anthropicSse.ts` for the three-stage pattern: raw frames → OpenAI SSE → optional Anthropic SSE.

The exported functions should be:
```ts
export function executeFoo(
  db: Database.Database,
  account: Account,
  body: ChatCompletionRequest
): Promise<{ stream: ReadableStream, usage: Promise<Usage> }>
```

**Why:** Same shape as `executeKiro` so `handleFooProxy` can swap it in cleanly.

### 6. Write `handleFooProxy`

**File:** `src/proxy/foo.ts` (new)

Copy `src/proxy/kiro.ts` and adjust:
- Import the foo module instead of kiro
- Rename `handleKiroProxy` → `handleFooProxy`
- Keep the same consoleBus emissions: `start`, `account`, `transport`, `done`, `error`
- Use `listEnabledAccountsByProvider(db, 'foo')` (already in `accounts.ts` — confirm it supports a string param)
- Use `getSetting(db, 'selection.foo')` for selection mode
- Apply `applyAccountError` on the same error class as kiro
- Return the response in the client's original format (OpenAI or Anthropic)

**Why:** `server.ts` routes by `model.provider`; the proxy handlers are interchangeable.

### 7. Wire it into `server.ts`

**File:** `src/server.ts`

Find the place where `handleKiroProxy` is invoked (search for `provider === 'kiro'` or `kiro.ts`). Add a parallel branch:

```ts
import { handleFooProxy } from './proxy/foo.js';
// ...
if (resolved.provider === 'kiro') {
  return handleKiroProxy(c, format, upstreamPath);
}
if (resolved.provider === 'foo') {
  return handleFooProxy(c, format, upstreamPath);
}
// existing minimax + combo path
```

**Why:** The branch in `handleProxy` (or its proxy/ subdir equivalent) is the single dispatch point.

### 8. Add CLI scripts

**Files:** `scripts/seed-foo-models.ts` (new) + `scripts/add-foo-account.ts` (new)

Mirror `scripts/seed-kiro-models.ts` and `scripts/add-kiro-account.ts`. Add the new scripts to `package.json` `scripts` block:

```json
"seed-foo-models": "tsx scripts/seed-foo-models.ts",
"add-foo-account": "tsx scripts/add-foo-account.ts"
```

**Why:** The dashboard covers the happy path, but the CLI scripts are referenced in the README + docs/.

### 9. Add the dashboard

**File:** `client/src/pages/Accounts.tsx`

The Accounts page already renders one card per provider. Add a `<FooCard />` parallel to `<KiroCard />` and `<MinimaxCard />`. The `SelectionControls` component takes a `provider` prop — pass `'foo'`.

If foo needs its own auth UI (device code, manual paste, etc.), add a new `KiroDeviceFlow`-style form under `client/src/components/FooAuthForm.tsx` and a hook at `client/src/hooks/useFooAuth.ts`.

**Why:** Provider-specific UIs are isolated to one card. The rest of the dashboard (models, usage, quota) works as-is once the account exists.

### 10. Add docs

**File:** `docs/minimax-reference/` is a misnomer at this point — rename later. For now, add a `docs/foo/` directory with at minimum:
- `docs/foo/wire-format.md` — capture foo's exact request/response shape from real traffic
- `docs/foo/auth.md` — token lifecycle, refresh URL, expiry buffer
- Update [`MEMORY.md`](../../MEMORY.md) to add a link to the new guides

**Why:** The Kiro wire format was reverse-engineered (`docs/notes/kiro-cli-reverse-engineering.md`). Do the same for foo and write it down so the next contributor doesn't start from zero.

## Test

```bash
# Typecheck
npm run typecheck
cd client && npm run typecheck && cd ..

# Unit tests (your new modules ship with tests)
npm test -- foo
npx vitest run src/proxy/foo.test.ts
npx vitest run src/providers/foo/

# Integration test: end-to-end through the Hono app
npx vitest run src/proxy/foo-integration.test.ts
```

## Commit

```bash
git add src/providers/foo/ src/proxy/foo.ts src/db/migrations/00X-foo.ts \
        src/db/repos/accounts.ts src/db/migrations/index.ts src/api/admin/accounts.ts \
        src/server.ts scripts/seed-foo-models.ts scripts/add-foo-account.ts \
        package.json package-lock.json \
        client/src/pages/Accounts.tsx client/src/components/FooAuthForm.tsx \
        client/src/hooks/useFooAuth.ts docs/foo/ MEMORY.md

git commit -m "feat(foo): add foo upstream provider

Wire the foo provider into the proxy pipeline. New module
src/providers/foo/ holds auth + transform + stream; src/proxy/foo.ts
is the handler. Provider enum extended to 'foo'. Additive migration
00X-foo for any extra account columns. Dashboard Accounts page gains
a FooCard parallel to KiroCard / MiniMaxCard.

Wire format reverse-engineered from real traffic; see docs/foo/wire-format.md.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Checklist

- [ ] `ProviderName` extended to `'foo'`
- [ ] Migration `00X-foo.ts` written + registered (only if needed)
- [ ] `src/providers/foo/auth.ts` with `ensureAccessToken` + refresh
- [ ] `src/providers/foo/transform.ts` with `buildFooPayload`
- [ ] `src/providers/foo/stream.ts` with response assembly
- [ ] `src/proxy/foo.ts` with `handleFooProxy`
- [ ] `src/server.ts` dispatches to `handleFooProxy`
- [ ] `scripts/seed-foo-models.ts` + `scripts/add-foo-account.ts` + `package.json` entries
- [ ] `client/src/pages/Accounts.tsx` has a `<FooCard />`
- [ ] Unit + integration tests green
- [ ] `docs/foo/wire-format.md` + `docs/foo/auth.md`
- [ ] `MEMORY.md` updated with new links
- [ ] `npm run typecheck` green
- [ ] `cd client && npm run typecheck` green

## See also

- [`../reference/db-tables.md`](../reference/db-tables.md) — `accounts` table schema
- [`../reference/admin-api-routes.md`](../reference/admin-api-routes.md) — admin endpoint patterns
- [`../adr/`](../adr/) — past provider decisions
- [`../../CLAUDE.md`](../../CLAUDE.md) — proxy pipeline overview
```

- [x] **Step 2: Verify**

Run: `wc -l docs/guides/add-a-provider.md && head -3 docs/guides/add-a-provider.md`
Expected: ~250-275 lines, first line `# Add an Upstream Provider`.

- [x] **Step 3: Commit**

```bash
cd /home/kocomon/Projects/kelola-router
git add docs/guides/add-a-provider.md
git commit -m "docs(guides): add add-a-provider.md playbook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Create `docs/guides/add-an-admin-endpoint.md`

**Files:**
- Create: `docs/guides/add-an-admin-endpoint.md`
- Reference: `src/api/admin/{index,middleware,accounts,transports}.ts`

- [x] **Step 1: Write `docs/guides/add-an-admin-endpoint.md`**

Create the file with this content (exact paste):

```markdown
# Add an Admin API Endpoint

Add a new route under `/api/admin/*`. The router uses Hono, all routes are admin-authenticated, all mutating verbs (POST/PATCH/PUT/DELETE) pass through `csrfGuard` automatically.

## Goal

A new endpoint, e.g. `POST /api/admin/widgets/` that:
- Requires admin auth (session cookie OR `x-admin-key` header)
- Passes CSRF guard (Origin matches Host, or no Origin)
- Validates input, returns a JSON response
- Has a unit + integration test

## Prerequisites

- Read [`ARCHITECTURE.md`](../../ARCHITECTURE.md) — request flow + two-tier auth
- Read [`../reference/admin-api-routes.md`](../reference/admin-api-routes.md) — existing route inventory
- Read `src/api/admin/middleware.ts` — `requireAdminJson`, `ApiError`, `handleApiError`
- Read one existing route module as a reference: `src/api/admin/accounts.ts` (most complete pattern)

## File map

```
src/
└── api/admin/
    ├── widgets.ts            NEW — your route module
    └── index.ts              EXTEND — register the new router
src/
└── db/repos/
    └── widgets.ts            NEW (optional) — DB CRUD for your domain
tests/
└── api/admin/
    └── widgets.test.ts       NEW — integration test
```

If your endpoint is a thin wrapper over an existing repo, you may not need a new repo file.

## Steps

### 1. Create the route module

**File:** `src/api/admin/widgets.ts` (new)

```ts
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { ApiError, handleApiError } from './middleware.js';
import { createWidget, deleteWidget, listWidgets } from '../../db/repos/widgets.js';

export const widgetRoutes = new Hono();

const NAME_RE = /^[A-Za-z0-9._:-]{1,128}$/;

function validateName(name: unknown): string {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new ApiError(
      'invalid_widget_name',
      'widget name must match /^[A-Za-z0-9._:-]{1,128}$/',
      400
    );
  }
  return name;
}

widgetRoutes.get('/', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    return c.json({ widgets: listWidgets(db) });
  } catch (e) {
    return handleApiError(e);
  }
});

widgetRoutes.post('/', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const body = await c.req.json().catch(() => ({}));
    const name = validateName(body.name);
    const widget = createWidget(db, name);
    return c.json(widget, 201);
  } catch (e) {
    return handleApiError(e);
  }
});

widgetRoutes.delete('/:name', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    deleteWidget(db, c.req.param('name')!);
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
});
```

**Why:** `ApiError` + `handleApiError` give you consistent error envelopes. The `try/catch` around every handler is the convention — don't skip it.

### 2. Register the router

**File:** `src/api/admin/index.ts`

Add the import and route:
```ts
import { widgetRoutes } from './widgets.js';
// ...
app.route('/admin/widgets', widgetRoutes);
```

**Why:** `app.route` mounts the new module under the `/admin/widgets` prefix. CSRF + admin auth middleware already applies (the `app.use('/admin/*', requireAdminJson)` and `app.use('*', csrfGuard)` lines are at the top of the file — you don't add them).

### 3. (If needed) write the repo

**File:** `src/db/repos/widgets.ts` (new)

Mirror an existing repo like `src/db/repos/models.ts`:
- Use `cachedStmt(db, '...')` for prepared statements (it caches by SQL string)
- Return `T | null` (not `undefined`) — coerce with `?? null`
- Use `ulid()` for IDs
- Use `datetime('now')` defaults in INSERTs

```ts
import type Database from 'better-sqlite3';
import { cachedStmt } from '../cachedStmt.js';
import { ulid } from 'ulid';

export interface Widget {
  id: string;
  name: string;
  created_at: string;
}

export function listWidgets(db: Database.Database): Widget[] {
  return cachedStmt(db, `SELECT * FROM widgets ORDER BY created_at`).all() as Widget[];
}

export function createWidget(db: Database.Database, name: string): Widget {
  const id = `widget_${ulid()}`;
  cachedStmt(
    db,
    `INSERT INTO widgets (id, name) VALUES (?, ?)`
  ).run(id, name);
  return { id, name, created_at: new Date().toISOString() };
}

export function deleteWidget(db: Database.Database, name: string): void {
  cachedStmt(db, `DELETE FROM widgets WHERE name = ?`).run(name);
}
```

**Why:** Repo functions are the only thing the route module calls. No SQL in routes. (See AGENTS.md "Test patterns" — repos are easy to test in isolation.)

### 4. Add the migration (only if the endpoint needs a new table)

If `widgets` is a new table, add a migration. See [`add-a-migration.md`](add-a-migration.md).

**Why:** Schema is additive. Never drop or rewrite columns in a migration.

### 5. Write the integration test

**File:** `src/api/admin/widgets.test.ts` (new)

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../../db/index.js';
import { resetDb } from '../../server.js';
import { createApp } from '../../app.js';  // adjust import to your app factory

let app: ReturnType<typeof createApp>;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'router-test-'));
  process.env.ROUTER_DB_PATH = join(tmpDir, 't.db');
  resetDb();
  const db = openDb();
  // seed if needed
  app = createApp(db);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('POST /api/admin/widgets/', () => {
  it('creates a widget and returns 201', async () => {
    const res = await app.request('/api/admin/widgets/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'foo' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string };
    expect(body.name).toBe('foo');
    expect(body.id).toMatch(/^widget_/);
  });

  it('rejects an invalid name with 400', async () => {
    const res = await app.request('/api/admin/widgets/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'has spaces and !' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_widget_name');
  });
});

describe('GET /api/admin/widgets/', () => {
  it('lists widgets', async () => {
    // seed + assert
  });
});
```

**Why:** The `process.env.ROUTER_DB_PATH` + `resetDb()` pattern in `beforeEach` is the project convention (see AGENTS.md "Test patterns"). Each test gets a fresh DB.

### 6. Add an entry to the route inventory

**File:** `docs/reference/admin-api-routes.md`

Add a row for your new endpoint under the appropriate section. Keep the table format consistent.

**Why:** The route inventory is a lookup doc. Out-of-date inventory = bugs that ship.

## Test

```bash
npm test -- widgets
npx vitest run src/api/admin/widgets.test.ts
npm run typecheck
```

Expected: new tests green, no other tests regress, typecheck clean.

## Commit

```bash
git add src/api/admin/widgets.ts src/api/admin/index.ts \
        src/db/repos/widgets.ts tests/api/admin/widgets.test.ts \
        docs/reference/admin-api-routes.md

git commit -m "feat(admin): add /api/admin/widgets/ endpoint

CRUD for widgets. New repo at src/db/repos/widgets.ts.
Integration test at src/api/admin/widgets.test.ts. Route
inventory updated.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Checklist

- [ ] `src/api/admin/widgets.ts` exports `widgetRoutes`
- [ ] `src/api/admin/index.ts` registers the router
- [ ] `src/db/repos/widgets.ts` (if new table or new repo function) exists
- [ ] Migration added (if new table)
- [ ] Integration test green
- [ ] `docs/reference/admin-api-routes.md` updated
- [ ] `npm run typecheck` green

## See also

- [`../reference/admin-api-routes.md`](../reference/admin-api-routes.md) — existing route inventory
- [`../reference/db-tables.md`](../reference/db-tables.md) — schema reference
- [`../../AGENTS.md`](../../AGENTS.md) — TDD + test patterns
- [`add-a-migration.md`](add-a-migration.md) — for new tables
```

- [x] **Step 2: Verify**

Run: `wc -l docs/guides/add-an-admin-endpoint.md && head -3 docs/guides/add-an-admin-endpoint.md`
Expected: ~225-245 lines, first line `# Add an Admin API Endpoint`.

- [x] **Step 3: Commit**

```bash
cd /home/kocomon/Projects/kelola-router
git add docs/guides/add-an-admin-endpoint.md
git commit -m "docs(guides): add add-an-admin-endpoint.md playbook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Create `docs/guides/add-a-dashboard-page.md`

**Files:**
- Create: `docs/guides/add-a-dashboard-page.md`
- Reference: `client/src/pages/`, `client/src/layout/{AppShell,Sidebar,TopBar}.tsx`, `client/src/lib/api.ts`, `client/src/components/`

- [x] **Step 1: Write `docs/guides/add-a-dashboard-page.md`**

Create the file with this content (exact paste):

```markdown
# Add a Dashboard Page

Add a new Preact page to the dashboard SPA. The router uses hash-routing (`#/admin/<page>`), TanStack Query for data fetching, and an Obsidian Gold theme.

## Goal

A new page, e.g. `/admin/widgets` that:
- Renders a list of widgets from `GET /api/admin/widgets/`
- Has a button to create a new widget via `POST /api/admin/widgets/`
- Shows toast on success / error
- Is reachable from the sidebar + command palette + `g w` keyboard shortcut

## Prerequisites

- Read [`CLAUDE.md`](../../CLAUDE.md) — Dashboard section
- Read [`../reference/admin-api-routes.md`](../reference/admin-api-routes.md) — your endpoint
- Read one small existing page as a reference: `client/src/pages/Aliases.tsx` (CRUD) or `client/src/pages/Quota.tsx` (read-only with polling)
- Dev env: `cd client && npm run dev` (proxies `/api` to the running server on :20137)

## File map

```
client/src/
├── pages/
│   └── Widgets.tsx            NEW — your page component
├── layout/
│   ├── AppShell.tsx           EXTEND — register the lazy import + KNOWN_ROUTES + switch case
│   └── Sidebar.tsx            EXTEND — add a sidebar entry
├── lib/
│   └── api.ts                 (read-only — use apiFetch helper)
└── components/
    └── WidgetForm.tsx         NEW (optional) — extracted form if the page is big
```

## Steps

### 1. Create the page component

**File:** `client/src/pages/Widgets.tsx` (new)

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ErrorState } from '../components/ErrorState';
import { useToast } from '../components/ToastProvider';
import { TopBar } from '../layout/TopBar';
import { apiFetch } from '../lib/api';

interface Widget {
  id: string;
  name: string;
  created_at: string;
}

export function Widgets() {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');

  const { data: widgets = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['widgets'],
    queryFn: () => apiFetch<{ widgets: Widget[] }>('/api/admin/widgets/'),
    select: (r) => r.widgets,
  });

  const createMut = useMutation({
    mutationFn: (n: string) =>
      apiFetch<Widget>('/api/admin/widgets/', {
        method: 'POST',
        json: { name: n },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['widgets'] });
      setName('');
      toast.success('Widget created');
    },
    onError: (e: unknown) => {
      toast.error((e as { message?: string }).message ?? 'Failed to create widget');
    },
  });

  return (
    <>
      <TopBar title="Widgets" />
      <div style={{ padding: 24, display: 'grid', gap: 16 }}>
        <Card title="Create">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) createMut.mutate(name.trim());
            }}
            style={{ display: 'flex', gap: 8 }}
          >
            <input
              type="text"
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              placeholder="widget-name"
              maxLength={128}
              style={{ flex: 1 }}
            />
            <Button type="submit" disabled={createMut.isPending || !name.trim()}>
              {createMut.isPending ? 'Creating…' : 'Create'}
            </Button>
          </form>
        </Card>

        <Card title="All widgets">
          {isLoading && <p>Loading…</p>}
          {isError && <ErrorState error={error} onRetry={refetch} />}
          {!isLoading && !isError && widgets.length === 0 && (
            <p style={{ color: 'var(--text-3)' }}>No widgets yet.</p>
          )}
          {widgets.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {widgets.map((w) => (
                <li key={w.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                  <code>{w.name}</code>
                  <span style={{ color: 'var(--text-3)', marginLeft: 8, fontSize: 12 }}>
                    {new Date(w.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
```

**Why:** TanStack Query gives you caching + retry + invalidation for free. The `select` option reshapes the response without re-fetching. TopBar + Card are the project's standard layout primitives.

### 2. Register the page in `AppShell`

**File:** `client/src/layout/AppShell.tsx`

Three edits:

1. Add the lazy import at the top (keep alphabetical order):
```tsx
const Widgets = lazy(() => import('../pages/Widgets').then((m) => ({ default: m.Widgets })));
```

2. Add `'widgets'` to `KNOWN_ROUTES` (keep alphabetical):
```ts
const KNOWN_ROUTES = [
  'aliases',
  'combos',
  // ...
  'widgets',
];
```

3. Add the switch case in the `<Page>` component:
```tsx
case 'widgets':
  return <Widgets />;
```

**Why:** The `KNOWN_ROUTES` array is what `g w` (go-to hotkey) and the `not found` fallback consult. If you don't add your route there, the page renders `<NotFound />` even if the switch case is correct.

### 3. Add a sidebar entry

**File:** `client/src/layout/Sidebar.tsx`

Find the array of nav items (likely `const NAV` or `const ITEMS` — search for the existing routes). Add:

```tsx
{ to: '/admin/widgets', label: 'Widgets', icon: <SomeIcon />, hotkey: 'w' }
```

Use an existing icon from `client/src/components/Icon.tsx` if one fits. The `hotkey` field powers the `g w` jump (the `KNOWN_ROUTES` list mirrors the available letters).

**Why:** Sidebar is the primary navigation. Command palette (`⌘K`) also reads this list.

### 4. (Optional) extract a sub-component

If the page grows past ~200 LOC, extract a `WidgetForm` or `WidgetRow` component to `client/src/components/`. Use the patterns from existing `AccountsTable.tsx` / `KiroDeviceFlowForm.tsx`.

**Why:** Pages that are too big are hard to test. Extracted components can be unit-tested in isolation.

### 5. Write a component test

**File:** `client/src/__tests__/Widgets.test.tsx` (new)

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Widgets } from '../pages/Widgets';
import * as api from '../lib/api';

vi.mock('../lib/api');

describe('Widgets', () => {
  it('renders the list and a create form', async () => {
    vi.mocked(api.apiFetch).mockResolvedValueOnce({
      widgets: [{ id: 'widget_1', name: 'foo', created_at: '2026-01-01T00:00:00Z' }],
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Widgets />
      </QueryClientProvider>
    );
    await waitFor(() => {
      expect(screen.getByText('foo')).toBeInTheDocument();
    });
  });
});
```

**Why:** Component tests catch regressions when the API contract changes. Mock the `apiFetch` helper, not the fetch global.

### 6. Add a row to the route map in `MEMORY.md`

**File:** `MEMORY.md`

Under "Read first" or "Knowledge resources", add a link to the new page if it's a major surface (skip for trivial additions).

## Test

```bash
cd client
npm run typecheck
npm test
npm run build
```

Expected: typecheck clean, tests green, build succeeds (catches missing imports + syntax errors).

## Commit

```bash
git add client/src/pages/Widgets.tsx \
        client/src/layout/AppShell.tsx \
        client/src/layout/Sidebar.tsx \
        client/src/components/WidgetForm.tsx \
        client/src/__tests__/Widgets.test.tsx

git commit -m "feat(client): add /admin/widgets page

List + create widgets via /api/admin/widgets/. Wired into
AppShell (lazy import, KNOWN_ROUTES, switch), Sidebar, and
tested in client/src/__tests__/Widgets.test.tsx.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Checklist

- [ ] `client/src/pages/Widgets.tsx` exists
- [ ] `client/src/layout/AppShell.tsx` registers the import + KNOWN_ROUTES + switch case
- [ ] `client/src/layout/Sidebar.tsx` has a nav entry
- [ ] Component test passes
- [ ] `cd client && npm run typecheck` green
- [ ] `cd client && npm test` green
- [ ] `cd client && npm run build` green
- [ ] `g w` jumps to the new page

## See also

- [`../../CLAUDE.md`](../../CLAUDE.md) — Dashboard section
- [`../reference/admin-api-routes.md`](../reference/admin-api-routes.md) — the API the page consumes
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — Module map (client section)
- [`add-an-admin-endpoint.md`](add-an-admin-endpoint.md) — for the API side
```

- [x] **Step 2: Verify**

Run: `wc -l docs/guides/add-a-dashboard-page.md && head -3 docs/guides/add-a-dashboard-page.md`
Expected: ~225-245 lines, first line `# Add a Dashboard Page`.

- [x] **Step 3: Commit**

```bash
cd /home/kocomon/Projects/kelola-router
git add docs/guides/add-a-dashboard-page.md
git commit -m "docs(guides): add add-a-dashboard-page.md playbook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Create `docs/guides/add-a-migration.md`

**Files:**
- Create: `docs/guides/add-a-migration.md`
- Reference: `src/db/migrations/00{1..5}.ts`, `src/db/migrations/index.ts`

- [x] **Step 1: Write `docs/guides/add-a-migration.md`**

Create the file with this content (exact paste):

```markdown
# Add a Database Migration

Add a new migration file to `src/db/migrations/`. Migrations are tracked by `PRAGMA user_version` and run in order on startup. New migrations must be additive — never rewrite or drop data.

## Goal

A new migration `00X-<name>.ts` that:
- Has a unique numeric `id` one above the current `user_version`
- Runs `ALTER TABLE ADD COLUMN` or `CREATE TABLE` only (no destructive changes)
- Bumps `user_version` automatically via `migrate()` in `src/db/migrations/index.ts`
- Is idempotent on re-run (uses `IF NOT EXISTS` / `IF NOT EXISTS` on columns)
- Has a unit test verifying the upgrade path

## Prerequisites

- Read [`../reference/db-tables.md`](../reference/db-tables.md) — current schema
- Read the latest migration: `src/db/migrations/005-combos.ts` (most recent)
- Read the runner: `src/db/migrations/index.ts`
- Know the current `user_version` (run `sqlite3 ~/.local/share/kelola-router/router.db "PRAGMA user_version;"`)

## File map

```
src/db/migrations/
├── 00X-<name>.ts        NEW — your migration
└── index.ts             EXTEND — register the new migration in ALL_MIGRATIONS
src/db/migrations/
└── 00X-<name>.test.ts   NEW — upgrade-path test
```

## Steps

### 1. Pick the next ID

Check `src/db/migrations/index.ts`:
```ts
const ALL_MIGRATIONS = [
  migration_001, // initial
  migration_002, // kiro-provider
  migration_003, // transports
  migration_004, // request-log-reqid
  migration_005, // combos
];
```

The next ID is 6. The migration file should be `00X-<name>.ts` where `<name>` is a short kebab-case identifier (e.g. `00X-foo-provider.ts`, `00X-per-key-budget.ts`).

**Why:** IDs are forever. Once a migration ships to a user, its ID is locked. Don't reorder.

### 2. Write the migration

**File:** `src/db/migrations/00X-<name>.ts` (new)

Pattern A — additive column on an existing table (most common):
```ts
/**
 * Migration 00X — <one-line description>.
 *
 * Additive only. <Why this column is needed.>
 */
export const migration_00X = {
  id: 6, // next id
  name: '<kebab-name>',
  sql: `
    ALTER TABLE accounts ADD COLUMN <col> <type> <constraints>;
  `,
};
```

Pattern B — new table:
```ts
export const migration_00X = {
  id: 6,
  name: '<kebab-name>',
  sql: `
    CREATE TABLE IF NOT EXISTS <table_name> (
      id          TEXT PRIMARY KEY,
      ...
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- additive indexes too
    CREATE INDEX IF NOT EXISTS idx_<table>_<col>
      ON <table_name>(<col>);
  `,
};
```

**Why:** `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` are both safe to re-run on existing DBs. Migrations are wrapped in `db.exec()` with no transaction guard — each statement must stand alone. Use `ADD COLUMN` with a `DEFAULT` to backfill existing rows.

**Avoid:**
- `ALTER TABLE DROP COLUMN` — destructive, can't roll back
- `ALTER TABLE RENAME` — fine, but coordinate with read paths
- `CREATE INDEX` without `IF NOT EXISTS` — fails on re-run
- Modifying values in-place (e.g. `UPDATE accounts SET …`) — that's data, not schema

### 3. Register in the runner

**File:** `src/db/migrations/index.ts`

```ts
import { migration_00X } from './00X-<name>.js';

const ALL_MIGRATIONS = [
  migration_001,
  migration_002,
  migration_003,
  migration_004,
  migration_005,
  migration_00X, // new
];
```

**Why:** The runner iterates and applies anything with `id > user_version`. If you forget to register, the migration is never run.

### 4. Write the upgrade-path test

**File:** `src/db/migrations/00X-<name>.test.ts` (new)

Mirror `src/db/migrations/index.test.ts`. The test pattern:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migration_005 } from './005-combos.js';
import { migration_00X } from './00X-<name>.js';
import { migrate } from './index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mig-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('migration 00X', () => {
  it('applies cleanly on a fresh DB', () => {
    const db = new Database(join(tmpDir, 't.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
    // assert the new column / table exists
    const cols = db.prepare(`PRAGMA table_info(accounts)`).all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('<new_col>');
  });

  it('applies on a DB at user_version=5 (one migration behind)', () => {
    const db = new Database(join(tmpDir, 't.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    // Apply 001-005 first
    db.exec(migration_005.sql);
    db.pragma('user_version = 5');
    // Now run migrate() — should apply 00X
    migrate(db);
    expect(db.pragma('user_version', { simple: true })).toBe(6);
  });
});
```

**Why:** The runner reads `user_version` and skips already-applied migrations. The test simulates a real upgrade from the previous version.

### 5. Update the schema reference

**File:** `docs/reference/db-tables.md`

- Add the new column to the appropriate table
- Add a row to the **Migrations** table

**Why:** The schema reference is the single source of truth for downstream code. Keep it in sync.

## Test

```bash
npm test -- migrations
npx vitest run src/db/migrations/00X-<name>.test.ts
```

Also do a full smoke test:
```bash
# Reset dev DB
npm run reset
# Start server
npm run dev:server
# Server logs should show: "applied migration 6: <name>"
# Ctrl-C, restart, logs should NOT re-apply (user_version is 6)
```

## Commit

```bash
git add src/db/migrations/00X-<name>.ts \
        src/db/migrations/00X-<name>.test.ts \
        src/db/migrations/index.ts \
        docs/reference/db-tables.md

git commit -m "feat(db): migration 00X — <one-line description>

<Why this column / table is needed.> Additive ALTER / CREATE
only. Idempotent on re-run. Includes upgrade-path test
(apply-on-005-DB scenario).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Checklist

- [ ] `src/db/migrations/00X-<name>.ts` exports `migration_00X`
- [ ] `id` is the next sequential number (no gaps)
- [ ] SQL is additive only — no DROP, no UPDATE
- [ ] All `CREATE` statements use `IF NOT EXISTS`
- [ ] New `ALTER TABLE ADD COLUMN` has a DEFAULT
- [ ] Registered in `src/db/migrations/index.ts` `ALL_MIGRATIONS`
- [ ] Upgrade-path test passes
- [ ] `docs/reference/db-tables.md` updated
- [ ] `npm test` green
- [ ] `npm run typecheck` green
- [ ] `npm run reset && npm run dev:server` applies the migration

## See also

- [`../reference/db-tables.md`](../reference/db-tables.md) — current schema
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — Storage section
- [`add-a-provider.md`](add-a-provider.md) — often paired (new provider needs new columns)
```

- [x] **Step 2: Verify**

Run: `wc -l docs/guides/add-a-migration.md && head -3 docs/guides/add-a-migration.md`
Expected: ~190-210 lines, first line `# Add a Database Migration`.

- [x] **Step 3: Commit**

```bash
cd /home/kocomon/Projects/kelola-router
git add docs/guides/add-a-migration.md
git commit -m "docs(guides): add add-a-migration.md playbook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Create `docs/guides/debug-a-failed-request.md`

**Files:**
- Create: `docs/guides/debug-a-failed-request.md`
- Reference: `src/proxy/`, `src/accounts/`, `src/console/`, `src/streaming/`, `src/db/repos/requestLogs.ts`

- [x] **Step 1: Write `docs/guides/debug-a-failed-request.md`**

Create the file with this content (exact paste):

```markdown
# Debug a Failed Request

Trace a single proxy request through the router. The most common failure modes are auth, model-not-found, account selection, upstream error, format conversion. This guide shows the diagnostic ladder for each.

## Goal

Given a client report like "request to `claude-sonnet-4-6` returned 429" or "all requests failing since 14:32", find the root cause in under 5 minutes without reading every log line.

## Prerequisites

- Read [`ARCHITECTURE.md`](../../ARCHITECTURE.md) — request pipeline + state machines
- Read [`../reference/error-codes.md`](../reference/error-codes.md) — what the backoff/lock decisions mean
- Know how to query the DB: `sqlite3 ~/.local/share/kelola-router/router.db` (or use the dashboard's Request Detail page)

## Diagnostic ladder

Walk these in order. Stop at the first clue that points to a fix.

### Step 1: Confirm the request was logged

```sql
SELECT id, model, status_code, error, created_at
FROM request_logs
ORDER BY created_at DESC LIMIT 5;
```

If no row exists: the request never reached the proxy. Check client auth:
- `Authorization: Bearer <key>` header present?
- `client_keys` row exists with `enabled = 1`?
- Run: `SELECT id, label, enabled FROM client_keys WHERE key = '<bearer>';`

### Step 2: Look at the Console page

Open the dashboard `Console` page (`#/admin/console`). The failed request should be a colored block with:
- `reqid` (4-byte hex) — match this to `request_logs.req_id` for cross-linking
- `account` — which account was selected
- `transport` — which relay/proxy/direct path
- `done` line with status + latency
- `error` line (if applicable) with the upstream body

If you see `error` but no `done`, the request errored before the response streamed.

If you see a `transport-fail` line, the proxy/relay was unreachable. See `docs/adr/0003-…` (or the proxy-failure console design spec) for `proxyFailureMode` semantics.

### Step 3: Check the account state

For 429 / 5xx: was the selected account healthy?

```sql
SELECT id, label, status, backoff_level, rate_limited_until, last_error
FROM accounts
ORDER BY backoff_level DESC;
```

- `status = 'error'` → 401 upstream, account is disabled
- `rate_limited_until > now` → account in backoff
- `backoff_level > 0` → exponential backoff active

Look at `last_error` (JSON):
```sql
SELECT json_extract(last_error, '$.status') AS status,
       json_extract(last_error, '$.baseRespCode') AS code,
       json_extract(last_error, '$.message') AS msg,
       json_extract(last_error, '$.timestamp') AS ts
FROM accounts
WHERE id = '<account_id>';
```

Match the `baseRespCode` to [`../reference/error-codes.md`](../reference/error-codes.md) to see what the router will do next.

### Step 4: Check the model lock

For 429 with `error: 'model_locked'`:

```sql
SELECT * FROM account_model_locks
WHERE account_id = '<id>' AND model = '<name>';
```

Lock expires automatically at `locked_until`. To clear manually (force-unlock):
- Dashboard: Accounts page → "Locks" column → "Clear"
- API: `DELETE /api/admin/accounts/<id>/locks/<model>`
- SQL: `DELETE FROM account_model_locks WHERE account_id = ? AND model = ?;`

### Step 5: Inspect the request/response bodies

For format-conversion or upstream-parsing issues:

```sql
SELECT id, model, endpoint, format, request_body, response_body, error
FROM request_logs
WHERE id = <row_id>;
```

Both bodies are stored as JSON TEXT. Common patterns:
- `response_body` is `{"error": {"base_resp": {"status_code": 1002, "status_msg": "rate limit exceeded"}}}` → upstream rate limit
- `response_body` is a streaming event that wasn't reassembled → check `format = 'openai'` vs `'anthropic'` match
- `request_body` shows a tool message that wasn't converted → check `upstreamFormat` setting

### Step 6: Trace the model resolution

If the request was routed to the wrong model:

```sql
SELECT * FROM model_aliases WHERE alias_name = '<client_sent_model>';
SELECT * FROM models WHERE name = '<resolved_model>' OR upstream_model = '<resolved_model>';
```

Check:
- Is there an alias overriding the model?
- Is the model `enabled = 0`?
- Is the `provider` column matching the account you expected?

### Step 7: Check combo / fallback chain

If the request used a combo name:

```sql
SELECT * FROM combos WHERE name = '<combo_name>';
```

The proxy iterates `combos.models` in order. If the first model is locked/errored, the next is tried. Look at the console for multiple `account` lines per `reqid`.

### Step 8: Live tail

For ongoing issues, tail the flow stream from the terminal:

```bash
# Server stdout (gated by CONSOLE_FLOW=0)
npm run dev:server | grep -E 'req_'
```

Or the dashboard Console page in another tab.

## Common failure modes

| Symptom | First check | Likely fix |
|---|---|---|
| 401 from router | Client bearer | Re-issue client key; check `enabled` |
| 503 with `reason=mode` | All accounts backoff/locked | Wait for cooldown or clear locks |
| 429 with `model_locked` | `account_model_locks` row | Clear the lock or wait |
| `base_resp.status_code = 1008` | `accounts.status` | Add balance or new account |
| `base_resp.status_code = 1039` | `account_model_locks` | Reduce context, retry |
| Stream hangs, no `done` line | Console / network | Check upstream timeout (`REQUEST_LOG_RETENTION_DAYS` is unrelated; this is a request still in flight) |
| All accounts return 401 | API key invalid/expired | Re-add account with new key |
| Format mismatch (OpenAI client ↔ Anthropic upstream) | `settings.minimax.upstreamFormat` | Set to `'openai'` or `'anthropic'` explicitly |
| Kiro: device-code flow loops | `accounts.access_token` stale | Delete + re-add account |

## Test

```bash
# Quick smoke test from the CLI
curl -X POST http://localhost:20137/v1/chat/completions \
  -H "Authorization: Bearer $ROUTER_CLIENT_KEY" \
  -H "content-type: application/json" \
  -d '{"model": "minimax/MiniMax-M3", "messages": [{"role": "user", "content": "hi"}]}'
```

Expected: 200 with `chat.completion` JSON (or 5xx with structured error body — match the status to the table above).

## Commit

This guide is read-only. No code changes. If you discover a new failure mode worth documenting, send a follow-up PR adding it to the **Common failure modes** table.

## See also

- [`../reference/error-codes.md`](../reference/error-codes.md) — backoff/lock semantics
- [`../reference/db-tables.md`](../reference/db-tables.md) — `request_logs`, `account_model_locks`, `accounts` schemas
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — request pipeline + state machines
- [`../../CLAUDE.md`](../../CLAUDE.md) — proxy pipeline overview
- [`../adr/`](../adr/) — past debug investigations
```

- [x] **Step 2: Verify**

Run: `wc -l docs/guides/debug-a-failed-request.md && head -3 docs/guides/debug-a-failed-request.md`
Expected: ~210-230 lines, first line `# Debug a Failed Request`.

- [x] **Step 3: Commit**

```bash
cd /home/kocomon/Projects/kelola-router
git add docs/guides/debug-a-failed-request.md
git commit -m "docs(guides): add debug-a-failed-request.md playbook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Create `docs/guides/ship-a-release.md`

**Files:**
- Create: `docs/guides/ship-a-release.md`
- Reference: `package.json`, `CHANGELOG.md`, `docs/superpowers/specs/`

- [x] **Step 1: Write `docs/guides/ship-a-release.md`**

Create the file with this content (exact paste):

```markdown
# Ship a Release

Cut a versioned release of `kelola-router`. Maintainer-only workflow. Contributors do not run this; they open a PR and the maintainer ships on merge.

## Goal

A new version on the `main` branch with:
- `package.json` version bumped (semver)
- `CHANGELOG.md` updated for the new version
- A git tag matching the version
- Docker image rebuilt + pushed (if maintainer controls the image registry)
- A short release note on the GitHub Releases page

## Prerequisites

- Maintainer privileges on the repo
- `npm` + `git` + `gh` (GitHub CLI) in `$PATH`
- Read the most recent release commit to confirm the format: `git show v<previous>` (or `git tag --sort=-v:refname | head -1`)
- Read [`../../CHANGELOG.md`](../../CHANGELOG.md) — Keep-a-Changelog format

## File map

No new files. Edits only:
- `package.json` (bump `version`)
- `CHANGELOG.md` (add new version section)
- (Optional) `docs/superpowers/specs/` — link from CHANGELOG if a spec was written for the release

## Steps

### 1. Confirm the release scope

```bash
# What's shipping since the last tag?
git log v<previous>..HEAD --oneline
# What was the last tag?
git tag --sort=-v:refname | head -1
```

Categorize the commits into Keep-a-Changelog sections:
- **Added** — `feat:` commits
- **Changed** — `refactor:` commits that change behavior, `feat!:` (breaking)
- **Deprecated** — `feat(deprecate):` or `chore(deprecate):`
- **Removed** — `feat!:` or `chore(remove):`
- **Fixed** — `fix:` commits
- **Security** — `fix(security):` or explicit security-related fixes

If a commit doesn't fit a section, leave it out of the changelog (housekeeping, tests, docs).

### 2. Bump the version

**File:** `package.json`

```json
{
  "version": "0.18.0"  // bump from 0.17.0
}
```

Semver rules:
- **MAJOR** (1.0.0 → 2.0.0) — breaking change to a public surface (env var removed, admin API contract changed, DB schema not backward-compatible). Project is at 0.x so this rarely fires.
- **MINOR** (0.17.0 → 0.18.0) — new feature, additive. Most releases.
- **PATCH** (0.17.0 → 0.17.1) — bug fix only.

If unsure, MINOR. The router is feature-stacked pre-1.0.

### 3. Update the changelog

**File:** `CHANGELOG.md`

Add a new section at the top (above the most recent version), following Keep-a-Changelog:

```markdown
## [0.18.0] — YYYY-MM-DD

### Added

- **Feature name.** One paragraph (or 2-3 bullets) explaining what + why + how to use. Link the GitHub issue/PR if relevant. Example: "**Live Console.** In-process flow event bus that streams per-request proxy events…"

### Changed

- (only if anything changed behavior)

### Fixed

- (only if bugs were fixed)

### Verification

- N/M server tests pass (`npx vitest run`).
- N/M client tests pass (`cd client && npx vitest run`).
- `npm run typecheck` clean.
- `cd client && npm run build` clean.
- Lint baseline: X errors / Y warnings (record deltas, even if 0).
```

Match the prose style of the most recent version section. Be terse but specific — the changelog is the public release note.

**Why:** Keep-a-Changelog is the project's house style (see `CHANGELOG.md` top comment). Future contributors diff releases from this file.

### 4. Commit the version bump

```bash
git add package.json CHANGELOG.md
git commit -m "chore(release): v0.18.0

Bump version to 0.18.0. See CHANGELOG.md for the full list of
additions, changes, and fixes since 0.17.0.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### 5. Tag the release

```bash
git tag -a v0.18.0 -m "v0.18.0 — <one-line summary>

<optional 1-2 lines pointing at the most notable feature>"
```

Annotated tags (the default) carry the tagger, date, and message. The tag message becomes the GitHub Release title.

### 6. Build the Docker image (if maintaining the image)

```bash
docker build -t kelola-router:0.18.0 -t kelola-router:latest .
docker push kelola-router:0.18.0
docker push kelola-router:latest
```

(Adjust the registry prefix to match the maintainer's setup — could be `ghcr.io/<owner>/kelola-router` or a private registry.)

### 7. Push the tag

**Ask the user** before pushing. The user confirms `git push` and `git push --tags` (global CLAUDE.md rule: "Never push without asking").

```bash
git push origin main
git push origin v0.18.0
```

### 8. Create the GitHub release

```bash
gh release create v0.18.0 \
  --title "v0.18.0 — <one-line summary>" \
  --notes-file <(sed -n '/## \[0.18.0\]/,/## \[0.17.0\]/p' CHANGELOG.md)
```

The `--notes-file` pulls the changelog section into the GitHub Release body. (Adjust the sed pattern to capture from the new version header to the next version header.)

### 9. Smoke test on the production artifact

```bash
# Pull the freshly built image and run it
docker run --rm -p 20137:20137 \
  -e ROUTER_DB_PATH=/data/router.db \
  -v /tmp/router-data:/data \
  kelola-router:0.18.0

# In another terminal:
curl -fsS http://localhost:20137/v1/models
```

Expected: 200 with the model catalog. If the image doesn't start, revert the tag and fix forward.

## Test

The release is the test. Before tagging, do a dry-run:

```bash
# Full test suite
npm test
cd client && npm test && cd ..

# Typecheck (both)
npm run typecheck
cd client && npm run typecheck && cd ..

# Lint
npm run lint

# Build
npm run build
```

All must be green. If anything is red, fix the commits before tagging. Never ship a release with known red CI.

## Commit

This guide is read-only. The version-bump commit (step 4) is the only commit for the release itself.

## See also

- [`../../CHANGELOG.md`](../../CHANGELOG.md) — current changelog
- [`../adr/`](../adr/) — past design decisions referenced in release notes
- [`../../CLAUDE.md`](../../CLAUDE.md) — conventions (commit format, etc.)
- [`../../AGENTS.md`](../../AGENTS.md) — agent workflow (push/PR rules)
- [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) — format reference
- [Semantic Versioning](https://semver.org/spec/v2.0.0.html) — semver rules
```

- [x] **Step 2: Verify**

Run: `wc -l docs/guides/ship-a-release.md && head -3 docs/guides/ship-a-release.md`
Expected: ~190-210 lines, first line `# Ship a Release`.

- [x] **Step 3: Commit**

```bash
cd /home/kocomon/Projects/kelola-router
git add docs/guides/ship-a-release.md
git commit -m "docs(guides): add ship-a-release.md playbook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Update `MEMORY.md` to add links to all 6 playbooks

**Files:**
- Modify: `MEMORY.md` (replace the "Playbooks (when written)" placeholder section with real links)

- [x] **Step 1: Read the current Playbooks section in MEMORY.md**

Run: `sed -n '/## Playbooks/,/## Reference/p' MEMORY.md`

- [x] **Step 2: Replace the placeholder block with the real list**

Use `Edit` to replace the existing `## Playbooks (when written)` block. The new content:

```markdown
## Playbooks

Step-by-step guides for common contributor tasks. When a playbook is missing, write the work + the playbook in the same PR.

- [`docs/guides/add-a-provider.md`](docs/guides/add-a-provider.md) — wire a new upstream provider alongside MiniMax / Kiro
- [`docs/guides/add-an-admin-endpoint.md`](docs/guides/add-an-admin-endpoint.md) — add a `/api/admin/*` route
- [`docs/guides/add-a-dashboard-page.md`](docs/guides/add-a-dashboard-page.md) — add a Preact page
- [`docs/guides/add-a-migration.md`](docs/guides/add-a-migration.md) — write a new `src/db/migrations/00X-*.ts`
- [`docs/guides/debug-a-failed-request.md`](docs/guides/debug-a-failed-request.md) — trace a request through the proxy
- [`docs/guides/ship-a-release.md`](docs/guides/ship-a-release.md) — version bump + changelog + tag
```

Find the exact existing text in MEMORY.md (the placeholder block under `## Playbooks (when written)`) and replace it with the above. Don't change any other section.

- [x] **Step 3: Verify**

Run: `grep -oE "docs/guides/[a-z-]+\.md" MEMORY.md | sort -u`
Expected: 6 unique paths, all 6 listed in the playbook inventory.

- [x] **Step 4: Commit**

```bash
cd /home/kocomon/Projects/kelola-router
git add MEMORY.md
git commit -m "docs: link 6 playbooks from MEMORY.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Verify Phase 3 — all 6 playbooks exist + linked from MEMORY.md

**Files:**
- Read-only verification (no file changes)

- [x] **Step 1: Confirm all 6 files exist with expected sizes**

Run:
```bash
cd /home/kocomon/Projects/kelola-router
for f in add-a-provider add-an-admin-endpoint add-a-dashboard-page add-a-migration debug-a-failed-request ship-a-release; do
  p="docs/guides/$f.md"
  if [ -f "$p" ]; then
    printf "%-40s %s lines\n" "$p" "$(wc -l < "$p")"
  else
    echo "MISSING: $p"
  fi
done
```

Expected (approximate):
```
docs/guides/add-a-provider.md            260 lines
docs/guides/add-an-admin-endpoint.md     235 lines
docs/guides/add-a-dashboard-page.md      235 lines
docs/guides/add-a-migration.md           200 lines
docs/guides/debug-a-failed-request.md    220 lines
docs/guides/ship-a-release.md            200 lines
```

- [ ] **Step 2: Confirm MEMORY.md links to all 6 playbooks**

Run:
```bash
cd /home/kocomon/Projects/kelola-router
grep -oE "docs/guides/[a-z-]+\.md" MEMORY.md | sort -u
```

Expected: 6 unique paths (add-a-provider, add-an-admin-endpoint, add-a-dashboard-page, add-a-migration, debug-a-failed-request, ship-a-release).

- [ ] **Step 3: Confirm 7 new commits (6 playbooks + 1 MEMORY.md update) in git log**

Run:
```bash
cd /home/kocomon/Projects/kelola-router
git log --oneline -10
```

Expected: 7 new commits most recent:
- `docs: link 6 playbooks from MEMORY.md`
- `docs(guides): add ship-a-release.md playbook`
- `docs(guides): add debug-a-failed-request.md playbook`
- `docs(guides): add add-a-migration.md playbook`
- `docs(guides): add add-a-dashboard-page.md playbook`
- `docs(guides): add add-an-admin-endpoint.md playbook`
- `docs(guides): add add-a-provider.md playbook`

Plus prior Phase 1 + Phase 2 commits.

- [x] **Step 4: `npm run typecheck` + `npm test` green (Phase 3 is docs only)**

Run:
```bash
cd /home/kocomon/Projects/kelola-router
npm run typecheck 2>&1 | tail -5
echo "==="
npm test 2>&1 | tail -5
```

Expected: typecheck clean, tests pass.

- [x] **Step 5: Final report**

Tell the user:

```
Phase 3 done. Seven commits added:
  - docs/guides/add-a-provider.md             (provider integration playbook)
  - docs/guides/add-an-admin-endpoint.md      (admin API route playbook)
  - docs/guides/add-a-dashboard-page.md       (Preact page playbook)
  - docs/guides/add-a-migration.md            (DB migration playbook)
  - docs/guides/debug-a-failed-request.md     (request debug ladder)
  - docs/guides/ship-a-release.md             (release process)
  - MEMORY.md updated with links to all 6

Verification:
  - All 6 files exist, sizes in range
  - MEMORY.md has 6 unique links to docs/guides/*
  - npm run typecheck green
  - npm test green (no code changed)

Next phases (not in this plan):
  - Phase 4: .claude/skills/* (auto-loaded task instructions, terse)
  - Phase 5: .claude/docs/* (indexed knowledge base for ctx_search)
  - Phase 6: docs/adr/* (4-5 ADRs backfilled from git history)
```

---

## Self-Review

### Spec coverage

| Spec requirement | Task |
|---|---|
| `add-a-provider.md` | Task 1 |
| `add-an-admin-endpoint.md` | Task 2 |
| `add-a-dashboard-page.md` | Task 3 |
| `add-a-migration.md` | Task 4 |
| `debug-a-failed-request.md` | Task 5 |
| `ship-a-release.md` | Task 6 |
| `MEMORY.md` updated | Task 7 |
| Verification gate | Task 8 |

All covered.

### Placeholder scan

Searched for `TBD`, `TODO`, `implement later`, `fill in details`. None present in step content. Every step has the actual content (code blocks, file paths, commands).

### Type / name consistency

- File names match `MEMORY.md` links exactly.
- File paths in code blocks (`src/api/admin/widgets.ts`, `client/src/pages/Widgets.tsx`, etc.) match the actual repo structure.
- `KNOWN_ROUTES` / Sidebar / AppShell references are correct (verified against the source).
- Migration numbering: `00X` is used as a placeholder for the next ID; the current is 5 so the example uses `6`.

Plan ready for execution.
