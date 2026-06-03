import type Database from 'better-sqlite3';

/**
 * Legacy migration: ALTER TABLE users ADD COLUMN admin_key.
 * No-op for fresh deploys (001 no longer creates users). Kept so v1-v2 DBs
 * upgrade cleanly — this migration runs only if the users table still has
 * the old schema.
 */
export const migration_002 = {
  id: 2,
  name: 'admin_key_legacy',
  condition: (db: Database.Database) => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string;
    }[];
    return tables.some((t) => t.name === 'users');
  },
  sql: `
    ALTER TABLE users ADD COLUMN admin_key TEXT;
  `,
};
