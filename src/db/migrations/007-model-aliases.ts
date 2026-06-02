/**
 * Add the user-defined model alias table and a column on request_logs to
 * preserve the client-requested model name alongside the resolved upstream
 * model. Used by the new Aliases dashboard page.
 */
export const migration_007 = {
  id: 7,
  name: "model_aliases",
  sql: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_models_upstream_model ON models(upstream_model);
    CREATE TABLE IF NOT EXISTS model_aliases (
      alias_name      TEXT PRIMARY KEY,
      upstream_model  TEXT NOT NULL,
      label           TEXT,
      source          TEXT NOT NULL DEFAULT 'user',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (upstream_model) REFERENCES models(upstream_model) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_model_aliases_target ON model_aliases(upstream_model);
    ALTER TABLE request_logs ADD COLUMN requested_model TEXT;
  `,
};
