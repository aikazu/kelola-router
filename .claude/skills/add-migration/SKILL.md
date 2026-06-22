---
name: add-migration
description: Add a new src/db/migrations/00X-*.ts file (additive ALTER / CREATE only) and bump user_version.
when-to-use: When the user asks to add a DB column, new table, or schema change to the SQLite database.
---

# Add a Database Migration

Full playbook: `docs/guides/add-a-migration.md`. Read it first.

## Steps

1. **Pick next ID**: `git grep user_version` or read `src/db/migrations/index.ts`. Current = 1 (single consolidated `001-initial` migration), next = 2. File: `src/db/migrations/00X-<kebab-name>.ts` (or `00N-…` matching the ID). The project ships fresh-deploy-only: add new columns in a NEW migration file, don't back-edit `001-initial.ts` (existing DBs at `user_version = 1` won't see edits to already-applied migrations).
2. **Write migration**: export `migration_00X = { id: N, name: '<kebab-name>', sql: \`...\` }`.
   - **Additive only.** `ALTER TABLE ADD COLUMN` (with `DEFAULT` to backfill) or `CREATE TABLE IF NOT EXISTS`.
   - **No DROP, no UPDATE of existing data, no RENAME.**
   - `CREATE INDEX IF NOT EXISTS` to make re-runs safe.
3. **Register**: `src/db/migrations/index.ts`: `import { migration_00X } from './00X-…js'` and add to `ALL_MIGRATIONS`.
4. **Upgrade-path test**: `src/db/migrations/00X-<name>.test.ts`:
   - Pattern A: fresh DB, run `migrate(db)`, assert column/table exists and `user_version` = N.
   - Pattern B: DB at `user_version = N-1`, run `migrate(db)`, assert it applies and `user_version` = N.
5. **Schema reference**: `docs/reference/db-tables.md`: add the column to the table + a row to the Migrations table.

## Test

```bash
npm test -- migrations
npx vitest run src/db/migrations/00X-<name>.test.ts
npm run reset && npm run dev:server   # smoke: see "applied migration N: <name>" in stdout
```

## Commit

```bash
git commit -m "feat(db): migration 00X - <one-line>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## See also

- `docs/guides/add-a-migration.md`: full playbook
- `docs/reference/db-tables.md`: current schema (update this in the same commit)
- `src/db/migrations/index.ts`: runner
