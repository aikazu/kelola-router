import type Database from 'better-sqlite3';

/**
 * Drop the router-invented `thinking_enabled` and `thinking_budget` columns
 * from the `models` table. Thinking is now driven by an allowlist in
 * `src/providers/alias.ts` and always uses `thinking.type = "adaptive"`.
 *
 * Idempotent: skip if the columns have already been removed (fresh deploys
 * from the updated 001-initial.ts won't have them).
 */
export const migration_006 = {
  id: 6,
  name: 'drop_thinking_fields',
  condition: (db: Database.Database) => {
    const cols = db.prepare(`PRAGMA table_info(models)`).all() as { name: string }[];
    return (
      cols.some((c) => c.name === 'thinking_enabled') ||
      cols.some((c) => c.name === 'thinking_budget')
    );
  },
  sql: `
    ALTER TABLE models DROP COLUMN thinking_enabled;
    ALTER TABLE models DROP COLUMN thinking_budget;
  `,
};
