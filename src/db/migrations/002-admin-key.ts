import type Database from "better-sqlite3";

export const migration_002 = {
  id: 2,
  name: "admin_key",
  sql: `
    ALTER TABLE users ADD COLUMN admin_key TEXT;
  `,
  // Idempotent: column may already exist from a previous partial run
  condition: (db: Database.Database) => {
    const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
    return !cols.some(c => c.name === "admin_key");
  },
};