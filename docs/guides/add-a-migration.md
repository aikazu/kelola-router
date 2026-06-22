# Add a Database Migration

Add a new migration file to `src/db/migrations/`. Migrations are tracked by `PRAGMA user_version` and run in order on startup. New migrations must be additive. Never rewrite or drop data.

## Goal

A new migration `00X-<name>.ts` that:
- Has a unique numeric `id` one above the current `user_version`
- Runs `ALTER TABLE ADD COLUMN` or `CREATE TABLE` only (no destructive changes)
- Bumps `user_version` automatically via `migrate()` in `src/db/migrations/index.ts`
- Is idempotent on re-run (uses `IF NOT EXISTS` / `IF NOT EXISTS` on columns)
- Has a unit test verifying the upgrade path

## Prerequisites

- Read [`../reference/db-tables.md`](../reference/db-tables.md): current schema
- Read the consolidated schema: `src/db/migrations/schema.sql.ts` (CREATE TABLE), `indexes.sql.ts`, `seed.sql.ts`. These are concatenated by `001-initial.ts` into the single fresh-deploy migration (`user_version` = 1).
- Read the runner: `src/db/migrations/index.ts`
- Know the current `user_version` (run `sqlite3 ~/.local/share/kelola-router/router.db "PRAGMA user_version;"`)

## File map

```
src/db/migrations/
├── 00X-<name>.ts        NEW: your migration
└── index.ts             EXTEND: register the new migration in ALL_MIGRATIONS
src/db/migrations/
└── 00X-<name>.test.ts   NEW: upgrade-path test
```

## Steps

### 1. Pick the next ID

Check `src/db/migrations/index.ts`:
```ts
const ALL_MIGRATIONS: Array<{ id: number; name: string; sql: string }> = [migration_001];
```

There is currently one consolidated migration (`001-initial`, `user_version = 1`). The next ID is 2. The migration file should be `00X-<name>.ts` where `<name>` is a short kebab-case identifier (e.g. `002-foo-provider.ts`, `002-per-key-budget.ts`).

**Why:** IDs are forever. Once a migration ships to a user, its ID is locked. Don't reorder. The project ships fresh-deploy-only. New additive columns go in a new migration file (not back-edited into `001-initial`), so existing DBs at `user_version = 1` still pick them up via the runner.

### 2. Write the migration

**File:** `src/db/migrations/00X-<name>.ts` (new)

Pattern A: additive column on an existing table (most common):
```ts
/**
 * Migration 00X: <one-line description>.
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

Pattern B: new table:
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

**Why:** `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` are both safe to re-run on existing DBs. Migrations are wrapped in `db.exec()` with no transaction guard. Each statement must stand alone. Use `ADD COLUMN` with a `DEFAULT` to backfill existing rows.

**Avoid:**
- `ALTER TABLE DROP COLUMN`: destructive, can't roll back
- `ALTER TABLE RENAME`: fine, but coordinate with read paths
- `CREATE INDEX` without `IF NOT EXISTS`: fails on re-run
- Modifying values in-place (e.g. `UPDATE accounts SET …`): that's data, not schema

### 3. Register in the runner

**File:** `src/db/migrations/index.ts`

```ts
import { migration_001 } from './001-initial.js';
import { migration_00X } from './00X-<name>.js';

const ALL_MIGRATIONS: Array<{ id: number; name: string; sql: string }> = [
  migration_001,
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
import { migration_001 } from './001-initial.js';
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

  it('applies on a DB at user_version=1 (one migration behind)', () => {
    const db = new Database(join(tmpDir, 't.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    // Apply the consolidated 001 first
    db.exec(migration_001.sql);
    db.pragma('user_version = 1');
    // Now run migrate() to apply 00X
    migrate(db);
    expect(db.pragma('user_version', { simple: true })).toBe(2);
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
npm run typecheck
```

Expected: new test green, all other migration tests still green, typecheck clean.

## Commit

```bash
git add src/db/migrations/00X-<name>.ts \
        src/db/migrations/00X-<name>.test.ts \
        src/db/migrations/index.ts \
        docs/reference/db-tables.md

git commit -m "feat(db): add migration 00X-<name>

<one-line description>. Additive: <ALTER TABLE ADD COLUMN / CREATE TABLE>.
Upgrade-path test verifies the 00X->006 bump on both fresh
and partially-migrated DBs. Schema reference updated.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Checklist

- [ ] `src/db/migrations/00X-<name>.ts` has unique `id` one above current
- [ ] Migration registered in `ALL_MIGRATIONS`
- [ ] No destructive operations (`DROP COLUMN`, in-place `UPDATE`)
- [ ] `IF NOT EXISTS` used on all `CREATE`
- [ ] Upgrade-path test covers fresh DB + DB at `user_version = (N-1)`
- [ ] `docs/reference/db-tables.md` updated
- [ ] `npm run typecheck` green
- [ ] All existing migration tests still green

## See also

- [`../reference/db-tables.md`](../reference/db-tables.md): current schema + migration history
- [`../../adr/0005-sqlite-wal-migrations.md`](../../adr/0005-sqlite-wal-migrations.md): why the runner is the way it is
- [`../../AGENTS.md`](../../AGENTS.md): TDD + test patterns
- [`add-an-admin-endpoint.md`](add-an-admin-endpoint.md): for the API side
