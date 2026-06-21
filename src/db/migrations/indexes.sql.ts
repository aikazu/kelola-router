/**
 * Fresh-deploy indexes: every CREATE INDEX (base query indexes + performance
 * additive indexes) consolidated. Safe to re-run on existing DBs via
 * IF NOT EXISTS. Split out of the schema module to keep 001-initial readable.
 */
export const INDEXES_SQL = `
    CREATE INDEX IF NOT EXISTS idx_logs_client_created ON request_logs(client_key_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_account_created ON request_logs(account_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_model_created ON request_logs(model, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_status ON request_logs(status_code, created_at DESC);

    -- Performance: additive indexes (safe to re-run on existing DBs).
    CREATE INDEX IF NOT EXISTS idx_logs_model_created_cost
      ON request_logs(model, created_at, cost_usd);
    CREATE INDEX IF NOT EXISTS idx_logs_created_at
      ON request_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_accounts_enabled_status
      ON accounts(enabled, status, credit_type);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_client_keys_active_key
      ON client_keys(key) WHERE enabled = 1;
    CREATE INDEX IF NOT EXISTS idx_quota_account_fetched ON quota_snapshots(account_id, fetched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_models_family ON models(family, enabled);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_models_upstream_model ON models(upstream_model);
    CREATE INDEX IF NOT EXISTS idx_model_aliases_target ON model_aliases(upstream_model);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_event_created
      ON audit_log(event, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_key_created
      ON audit_log(client_key_id, created_at DESC);
`;
