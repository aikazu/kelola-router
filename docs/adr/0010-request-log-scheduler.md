# 0010. In-process scheduler for request_logs pruning

Date: 2026-06-14

## Status

Accepted.

## Context

`request_logs` grows unboundedly. Every proxy request appends a row; a moderately active install accumulates tens of thousands of rows in days. Without pruning, the table grows until disk space runs out or query performance degrades.

The router is a single-process, self-hosted server with no external infrastructure. Options for running a periodic prune:
1. **System cron** — a cron job runs `sqlite3 t.db "DELETE FROM request_logs WHERE ..."` on a schedule.
2. **Database-level trigger** — SQLite doesn't have time-based triggers; only row-level triggers exist, which fire on writes, not on a schedule.
3. **In-process interval** — the server's `scheduler/` module runs a `setInterval` tick that handles multiple housekeeping tasks (quota pull, session cleanup, snapshot cleanup, log pruning) in one place.

An existing scheduler already ran for quota pulling (`src/scheduler/quotaPull.ts`). Log pruning fits naturally in the same tick.

## Decision

`cleanupOldLogs(db, RETENTION_DAYS)` is added to `src/db/repos/requestLogs.ts` and called inside `tickQuotaOnce` in `src/scheduler/quotaPull.ts`. `RETENTION_DAYS` defaults to 30 and is overridable via the `REQUEST_LOG_RETENTION_DAYS` environment variable.

The tick fires on the same `intervalMs` as quota pulling (configured by `startQuotaPuller` in `src/server.ts`, typically 1h). Log pruning is a `DELETE FROM request_logs WHERE created_at < datetime('now', '-N days')`. If rows are deleted, a `log.info` line reports the count; if none, it's silent.

The scheduler is registered once in `src/server.ts` at startup. `startQuotaPuller` guards against double-registration with an `if (intervalHandle) return` check.

`tickQuotaOnce` is also exported for use in tests (`quotaPull.test.ts` calls it directly to verify the prune without waiting for the interval). The test sets `REQUEST_LOG_RETENTION_DAYS = '7'`, inserts a row with `created_at = '2000-01-01'`, calls `tickQuotaOnce`, and asserts the row is gone.

## Consequences

### Positive

- No external infrastructure required. The router self-prunes.
- Configurable retention via env var — easy to extend or tighten without a code change.
- Reuses the existing scheduler tick: no new timer, no new process, minimal code.
- The prune is logged when it removes rows, making it visible in server logs for operators who want to monitor growth.

### Negative

- Pruning runs at the scheduler interval (typically 1h), not at a precise retention boundary. A row that crossed the 30-day threshold an hour ago is pruned at the next tick, not immediately.
- If the server is off for an extended period, pruning is delayed until the next startup. SQLite handles large DELETEs without issue, but a large catch-up delete could momentarily increase WAL size.

### Neutral

- The prune is in the same transaction scope as the rest of the tick's SQLite operations — it benefits from WAL mode's isolation without additional configuration.

## Alternatives considered

### System cron

Require users to configure a cron job that runs a `sqlite3` command. Rejected because: the target user is a developer self-hosting without sysadmin expertise. Adding a cron requirement to the README is operational friction for a routine housekeeping task. The in-process approach is zero-configuration.

### Separate pruning process / sidecar

Run a dedicated Node script as a separate process or container sidecar. Rejected because: introduces coordination complexity (two processes touching the same SQLite file — safe under WAL, but operationally awkward), and the task is trivial enough to co-locate with the existing scheduler.

### DELETE on every write (rolling window)

Prune in the same `setImmediate` that inserts the log row. Rejected because: couples the fast hot-path insert to a potentially slow DELETE (e.g. if many old rows need clearing at once). The periodic batch prune is cheaper for the hot path.

## References

- `src/scheduler/quotaPull.ts` — `tickQuotaOnce` (prune call), `startQuotaPuller` (interval guard)
- `src/db/repos/requestLogs.ts` — `cleanupOldLogs`
- `src/scheduler/quotaPull.test.ts` — retention test (sets `REQUEST_LOG_RETENTION_DAYS=7`)
- `CHANGELOG.md` v0.18.0 — Scheduler entry
