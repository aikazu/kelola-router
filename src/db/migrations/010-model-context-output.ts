/**
 * Migration 010 — add `context_output` column to `models`.
 *
 * The catalogue distinguishes max input tokens (`context_window`, already seeded) from
 * the output token cap (`max_tokens`). The Models dashboard wants separate CONTEXT IN /
 * CONTEXT OUT columns. Additive ALTER only. `user_version = 10`.
 */
export const migration_010 = {
  id: 10,
  name: 'model-context-output',
  sql: `ALTER TABLE models ADD COLUMN context_output INTEGER;`,
};
