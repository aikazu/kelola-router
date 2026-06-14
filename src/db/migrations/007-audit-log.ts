/**
 * Migration 007 — admin audit log.
 *
 * Dedicated table for security-relevant admin actions (key reveals, future:
 * logins, settings changes). Kept separate from `request_logs` because proxy
 * telemetry has a totally different shape (model/tokens/cost/latency, all
 * NOT NULL) and its retention pruning must not destroy audit history.
 *
 * Additive only: CREATE TABLE IF NOT EXISTS. `user_version = 7`.
 */
export const migration_007 = {
  id: 7,
  name: 'audit-log',
  sql: `
    CREATE TABLE IF NOT EXISTS audit_log (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      event          TEXT NOT NULL,
      client_key_id  INTEGER,
      ip             TEXT,
      user_agent     TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (client_key_id) REFERENCES client_keys(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_event_created
      ON audit_log(event, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_key_created
      ON audit_log(client_key_id, created_at DESC);
  `,
};
