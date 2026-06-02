/**
 * Single consolidated initial migration. Final schema for fresh deploys.
 * The older 002 (admin key) + 003 (drop users) are retained as no-op stubs
 * for users who already have a v3 DB; new deploys only see this file.
 */
export const migration_001 = {
  id: 1,
  name: "initial",
  sql: `
    CREATE TABLE IF NOT EXISTS accounts (
      id                 TEXT PRIMARY KEY,
      label              TEXT NOT NULL,
      credit_type        TEXT NOT NULL CHECK (credit_type IN ('payg','token-plan')),
      api_key            TEXT NOT NULL UNIQUE,
      base_url           TEXT,
      enabled            INTEGER NOT NULL DEFAULT 1,
      rate_limited_until TEXT,
      backoff_level      INTEGER NOT NULL DEFAULT 0,
      last_error         TEXT,
      status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','error','disabled')),
      created_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS account_model_locks (
      account_id    TEXT NOT NULL,
      model         TEXT NOT NULL,
      locked_until  TEXT NOT NULL,
      PRIMARY KEY (account_id, model),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS client_keys (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      label       TEXT NOT NULL,
      key         TEXT NOT NULL UNIQUE,
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS request_logs (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      client_key_id           INTEGER,
      account_id              TEXT,
      model                   TEXT NOT NULL,
      endpoint                TEXT NOT NULL,
      format                  TEXT NOT NULL,
      prompt_tokens           INTEGER NOT NULL DEFAULT 0,
      completion_tokens       INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens   INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens       INTEGER NOT NULL DEFAULT 0,
      total_tokens            INTEGER NOT NULL DEFAULT 0,
      cost_usd                REAL NOT NULL DEFAULT 0,
      latency_ms              INTEGER NOT NULL DEFAULT 0,
      ttft_ms                 INTEGER,
      status_code             INTEGER NOT NULL,
      base_resp_code          INTEGER,
      stream                  INTEGER NOT NULL DEFAULT 0,
      relay_path              TEXT,
      proxy_path              TEXT,
      rtk_bytes_saved         INTEGER NOT NULL DEFAULT 0,
      caveman_level           TEXT,
      error_message           TEXT,
      created_at              TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_logs_client_created ON request_logs(client_key_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_account_created ON request_logs(account_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_model_created ON request_logs(model, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_status ON request_logs(status_code, created_at DESC);

    CREATE TABLE IF NOT EXISTS quota_snapshots (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id        TEXT NOT NULL,
      source            TEXT NOT NULL,
      total_count       INTEGER,
      remaining_count   INTEGER,
      used_count        INTEGER,
      window_type       TEXT,
      window_start      TEXT,
      window_end        TEXT,
      raw_response      TEXT,
      fetched_at        TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_quota_account_fetched ON quota_snapshots(account_id, fetched_at DESC);

    CREATE TABLE IF NOT EXISTS models (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      name                  TEXT NOT NULL UNIQUE,
      display_name          TEXT,
      family                TEXT,
      upstream_model        TEXT NOT NULL,
      context_window        INTEGER,
      pricing_input         REAL,
      pricing_output        REAL,
      pricing_cache_read    REAL,
      pricing_cache_write   REAL,
      pricing_tiers         TEXT,
      capabilities          TEXT,
      source                TEXT NOT NULL DEFAULT 'manual',
      enabled               INTEGER NOT NULL DEFAULT 1,
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_models_family ON models(family, enabled);

    CREATE TABLE IF NOT EXISTS settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('rtk', '{"enabled": true, "minCompressSize": 500, "rawCap": 10485760, "filters": ["smart-truncate", "dedup-log"]}'),
      ('caveman', '{"level": "off"}'),
      ('caching', '{"autoBreakpoints": true, "respectCallerMarkers": true}'),
      ('minimax', '{"upstreamFormat": "auto", "m3DefaultMaxCompletionTokens": 131072}'),
      ('transport', '{"relay": null, "proxy": null}'),
      ('build', '{"version": "0.2.0", "schemaVersion": 2}');

    INSERT OR IGNORE INTO models (name, display_name, family, upstream_model, context_window, pricing_input, pricing_output, pricing_cache_read, pricing_cache_write, pricing_tiers, source) VALUES
      ('MiniMax-M3',             'MiniMax M3',             'm3',   'MiniMax-M3',        1000000, 0.60, 2.40, 0.12, NULL,
        '{"base":{"input":0.60,"output":2.40,"cacheRead":0.12,"cacheWrite":null},"high":{"input":1.20,"output":4.80,"cacheRead":0.24,"cacheWrite":null},"promotional":{"input":0.30,"output":1.20,"cacheRead":0.06,"cacheWrite":null}}',
        'builtin'),
      ('MiniMax-M2.7',           'MiniMax M2.7',           'm2.7', 'MiniMax-M2.7',      204800,  0.30, 1.20, 0.06, 0.375, NULL, 'builtin'),
      ('MiniMax-M2.7-highspeed', 'MiniMax M2.7 highspeed', 'm2.7', 'MiniMax-M2.7-highspeed', 204800, 0.60, 2.40, 0.06, 0.375, NULL, 'builtin'),
      ('MiniMax-M2.5',           'MiniMax M2.5',           'm2.5', 'MiniMax-M2.5',      204800,  0.30, 1.20, 0.03, 0.375, NULL, 'builtin'),
      ('MiniMax-M2.5-highspeed', 'MiniMax M2.5 highspeed', 'm2.5', 'MiniMax-M2.5-highspeed', 204800, 0.60, 2.40, 0.03, 0.375, NULL, 'builtin'),
      ('MiniMax-M2.1',           'MiniMax M2.1',           'm2.1', 'MiniMax-M2.1',      204800,  0.30, 1.20, 0.03, 0.375, NULL, 'builtin'),
      ('MiniMax-M2.1-highspeed', 'MiniMax M2.1 highspeed', 'm2.1', 'MiniMax-M2.1-highspeed', 204800, 0.60, 2.40, 0.03, 0.375, NULL, 'builtin'),
      ('MiniMax-M2',             'MiniMax M2',             'm2',   'MiniMax-M2',        204800,  0.30, 1.20, 0.03, 0.375, NULL, 'builtin'),
      ('MiniMax-M2-her',         'MiniMax M2-her (roleplay)','m2-her', 'MiniMax-M2-her', 64000, NULL, NULL, NULL, NULL, NULL, 'builtin');
  `,
};
