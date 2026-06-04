/**
 * Real MiniMax quota response is per-model and percent-based:
 * model_remains[] each carry current_interval_remaining_percent + remains_time (ms to reset).
 * Add the columns needed to store that signal faithfully (general plan is not count-metered,
 * so percent is the only meaningful number there).
 */
export const migration_008 = {
  id: 8,
  name: 'quota_percent',
  sql: `
    ALTER TABLE quota_snapshots ADD COLUMN model_name TEXT;
    ALTER TABLE quota_snapshots ADD COLUMN remaining_percent INTEGER;
    ALTER TABLE quota_snapshots ADD COLUMN remains_time INTEGER;
  `,
};
