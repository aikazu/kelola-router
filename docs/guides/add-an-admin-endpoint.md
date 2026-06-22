# Add an Admin API Endpoint

Add a new route under `/api/admin/*`. The router uses Hono, all routes are admin-authenticated, all mutating verbs (POST/PATCH/PUT/DELETE) pass through `csrfGuard` automatically.

## Goal

A new endpoint, e.g. `POST /api/admin/widgets/` that:
- Requires admin auth (session cookie OR `x-admin-key` header)
- Passes CSRF guard (Origin matches Host, or no Origin)
- Validates input, returns a JSON response
- Has a unit + integration test

## Prerequisites

- Read [`ARCHITECTURE.md`](../../ARCHITECTURE.md): request flow + two-tier auth
- Read [`../reference/admin-api-routes.md`](../reference/admin-api-routes.md): existing route inventory
- Read `src/api/admin/middleware.ts`: `requireAdminJson`, `ApiError`, `handleApiError`
- Read one existing route module as a reference: `src/api/admin/accounts.ts` (most complete pattern)

## File map

```
src/
└── api/admin/
    ├── widgets.ts            NEW: your route module
    └── index.ts              EXTEND: register the new router
src/
└── db/repos/
    └── widgets.ts            NEW (optional): DB CRUD for your domain
tests/
└── api/admin/
    └── widgets.test.ts       NEW: integration test
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

**Why:** `ApiError` + `handleApiError` give you consistent error envelopes. The `try/catch` around every handler is the convention. Don't skip it.

### 2. Register the router

**File:** `src/api/admin/index.ts`

Add the import and route:
```ts
import { widgetRoutes } from './widgets.js';
// ...
app.route('/admin/widgets', widgetRoutes);
```

**Why:** `app.route` mounts the new module under the `/admin/widgets` prefix. CSRF + admin auth middleware already applies (the `app.use('/admin/*', requireAdminJson)` and `app.use('*', csrfGuard)` lines are at the top of the file; you don't add them).

### 3. (If needed) write the repo

**File:** `src/db/repos/widgets.ts` (new)

Mirror an existing repo like `src/db/repos/models.ts`:
- Use `cachedStmt(db, '...')` for prepared statements (it caches by SQL string)
- Return `T | null` (not `undefined`); coerce with `?? null`
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

**Why:** Repo functions are the only thing the route module calls. No SQL in routes. (See AGENTS.md "Test patterns"; repos are easy to test in isolation.)

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

- [`../reference/admin-api-routes.md`](../reference/admin-api-routes.md): existing route inventory
- [`../reference/db-tables.md`](../reference/db-tables.md): schema reference
- [`../../AGENTS.md`](../../AGENTS.md): TDD + test patterns
- [`add-a-migration.md`](add-a-migration.md): for new tables
