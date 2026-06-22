# 0005. SQLite-WAL + user_version PRAGMA + additive migrations

Date: 2026-06-12

## Status

Accepted. Superseded in part (2026-06-21): the incremental migration files were consolidated into a single fresh-deploy schema. See "Schema consolidation (2026-06-21)" below.

## Context

The router is single-tenant self-host. It needs persistent storage for accounts, client keys, request logs, quota snapshots, models, etc. The options:

1. **SQLite-WAL + `user_version` PRAGMA + additive migrations**: single file, zero-config, no server process. Migrations tracked by `PRAGMA user_version = N`. Additive `ALTER TABLE ADD COLUMN` and `CREATE TABLE IF NOT EXISTS` only.
2. **PostgreSQL**: proper RDBMS, real migration tools (sqitch, flyway, alembic), multi-process safe. Operationally heavy: separate process, port, auth.
3. **File-based (JSON / YAML / TOML per table)**: git-friendly diffs, no schema migrations needed, but query support is limited and concurrency is racy.
4. **Embedded key-value (RocksDB, LMDB)**: fast, but no SQL, no migrations, no cross-table joins.

The pressure: a Docker container that "just works" with `docker compose up -d` is the deployment goal. A database that requires running a separate process defeats the self-host ethos. The data volume is small (tens of MB for a busy install); SQLite handles it easily.

## Decision

SQLite with WAL journal mode, `foreign_keys=ON`, `busy_timeout=5000`. Single file at `~/.local/share/kelola-router/router.db` (override via `ROUTER_DB_PATH`; Docker mounts `/data/router.db`). Migrations are TypeScript files in `src/db/migrations/` exporting `{id, name, sql}` constants. The runner (`src/db/migrations/index.ts:migrate(db)`) reads `PRAGMA user_version`, applies any migration with `id > current` in order, and advances the PRAGMA.

Every migration is additive. The current schema is consolidated in `001-initial.ts` (for fresh deploys); the additive ALTERs live in `002-kiro.ts` (provider columns), `003-transports.ts` (per-account transport), `004-reqid.ts` (request log ↔ console correlation), `005-combos.ts` (model fallback chains). Total `user_version` = 5.

### Schema consolidation (2026-06-21)

After the multi-provider, transport, combo, audit-log, transport-geoip, and model-context-output work shipped as incremental migrations (`002` through `010`), all of them (plus the standalone `CREATE TABLE` migrations `transports`, `combos`, `audit_log`) were folded back into `001-initial.ts` as a single consolidated fresh-deploy schema. The SQL is split across `schema.sql.ts` / `indexes.sql.ts` / `seed.sql.ts` (concatenated by `001-initial.ts`) to keep each file readable. The Pioneer dedup migrations `008` and `009` were data-only cleanups for DBs that had drifted across older releases; they are irrelevant on a fresh install and were dropped. Result: one migration file, `user_version` ends at 1, no incremental ALTERs, no data dedup. Existing DBs at `user_version = 10` keep working (the runner skips everything; the consolidated schema is a superset), and fresh deploys reach the final schema in a single step.

## Consequences

### Positive

- **Zero-config persistence.** `npm start` and the DB exists. No env vars, no separate service, no auth.
- **Migrations are files in the repo.** Reviewed in PRs, reversible by inspecting the SQL.
- **WAL mode supports concurrent reads + one writer.** Enough for the router's load (single process, occasional scheduler writes).
- **Single-file backup.** `cp router.db router.db.bak` is a complete snapshot. `sqlite3 router.db .dump` is a portable export.
- **No network surface.** No port to expose, no auth to manage.

### Negative

- **Not multi-process.** WAL allows concurrent reads + one writer, but two writers serialize. Multi-tenant would need a different DB.
- **No real migration tool.** The `user_version` PRAGMA + the runner script is the migration tool. No down-migrations, no dry-run, no per-statement progress. Mitigated by additive-only: every migration is safe to skip and re-apply.
- **Schema consolidation is one-way.** Once a user has `user_version = N`, changing the consolidated `001-initial.ts` doesn't reach them. New columns go in new migration files. This is the same constraint as every other migration system.
- **The 001-initial file is large** (~173 LOC of SQL). It contains the schema for 9 tables + their indexes. Splitting it is not possible without breaking the consolidation.

### Neutral

- `better-sqlite3` returns `undefined` for missing rows, not `null`. The repo layer coerces with `?? null` everywhere. Tests rely on this.

## Alternatives considered

### PostgreSQL

Real RDBMS, real migration tools, multi-process.

Rejected because: the operational complexity (a separate service, port allocation, auth, backup) is disproportionate to the data volume. Self-host friction is the priority. If a future user runs the router as a multi-tenant service, this ADR should be revisited, likely switching to `pg` + a real migration tool (drizzle-kit, kysely-migrations, or similar).

### File-based (JSON / YAML)

Git-friendly, no migrations needed, easy to inspect.

Rejected because: cross-table joins are needed (e.g. `request_logs.account_id → accounts.label`). No transaction guarantees. Concurrency is racy without locking. The query surface is too rich for files.

### RocksDB / LMDB

Fast key-value with transactions.

Rejected because: no SQL, no joins, no indexes beyond primary key. Every report query (`aggregatedUsage`, `recentLogs`) would need application-level joins. Not worth the speed for this volume.

## References

- `src/db/index.ts`: `openDb()`, `PRAGMA journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`
- `src/db/migrations/001-initial.ts`: the single consolidated fresh-deploy migration (concatenates `schema.sql.ts` / `indexes.sql.ts` / `seed.sql.ts`)
- `src/db/migrations/index.ts`: `migrate(db)` runner
- `src/db/repos/*.ts`: per-table repos
- `docs/reference/db-tables.md`: schema reference
- `docs/guides/add-a-migration.md`: playbook for new migrations
