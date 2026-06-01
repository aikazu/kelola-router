import type Database from "better-sqlite3";

/**
 * Phase 1 of obsidian-gold onboarding: introduce password-based admin auth.
 * Replaces the opaque `ROUTER_ADMIN_KEY` / `settings.admin_key` env/key model
 * with a hashed password + session cookie. Back-compat: the old env/key path
 * is still honored (so scripts and tests keep working), but the UI flow
 * is now password-driven.
 */
export const migration_004 = {
  id: 4,
  name: "auth_sessions",
  // Idempotent: skip if sessions table already exists
  condition: (db: Database.Database) => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    return !tables.some(t => t.name === "sessions");
  },
  sql: `
    CREATE TABLE sessions (
      id          TEXT PRIMARY KEY,
      user_agent  TEXT,
      ip          TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at  TEXT NOT NULL,
      last_seen   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_sessions_expires ON sessions(expires_at);
  `,
};
