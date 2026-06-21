/**
 * Fresh-deploy schema: all CREATE TABLE statements, consolidated. Every prior
 * incremental ALTER (provider columns, transports, req_id, combos, audit_log,
 * transport country, model context_output) and the standalone CREATE TABLE
 * migrations (transports, combos, audit_log) are folded into these tables.
 * New databases reach the final schema in one step. No change migrations, no
 * dedup — fresh deploy only.
 *
 * Historical note: legacy upgrade stubs (admin-key, drop-users, drop-thinking)
 * and the Pioneer dedup migrations (008 / 009) were data-only cleanups for dirty
 * DBs that no longer ship — irrelevant on a fresh install, so dropped.
 */
export const SCHEMA_SQL = `
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
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      provider           TEXT NOT NULL DEFAULT 'minimax',
      access_token       TEXT,
      token_expires_at   TEXT,
      provider_data      TEXT,
      relay_id           TEXT,
      proxy_id           TEXT,
      proxy_pool         TEXT,
      proxy_rotate_every INTEGER NOT NULL DEFAULT 1
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
      requested_model         TEXT,
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
      request_body            TEXT,
      response_body           TEXT,
      request_headers         TEXT,
      response_headers        TEXT,
      error                   TEXT,
      req_id                  TEXT,
      created_at              TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS quota_snapshots (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id        TEXT NOT NULL,
      source            TEXT NOT NULL,
      model_name        TEXT,
      total_count       INTEGER,
      remaining_count   INTEGER,
      used_count        INTEGER,
      remaining_percent INTEGER,
      remains_time      INTEGER,
      window_type       TEXT,
      window_start      TEXT,
      window_end        TEXT,
      raw_response      TEXT,
      fetched_at        TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS models (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      name                  TEXT NOT NULL UNIQUE,
      display_name          TEXT,
      family                TEXT,
      upstream_model        TEXT NOT NULL,
      context_window        INTEGER,
      context_output        INTEGER,
      pricing_input         REAL,
      pricing_output        REAL,
      pricing_cache_read    REAL,
      pricing_cache_write   REAL,
      pricing_tiers         TEXT,
      capabilities          TEXT,
      source                TEXT NOT NULL DEFAULT 'manual',
      enabled               INTEGER NOT NULL DEFAULT 1,
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      provider              TEXT NOT NULL DEFAULT 'minimax'
    );

    CREATE TABLE IF NOT EXISTS model_aliases (
      alias_name      TEXT PRIMARY KEY,
      upstream_model  TEXT NOT NULL,
      label           TEXT,
      source          TEXT NOT NULL DEFAULT 'user',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (upstream_model) REFERENCES models(upstream_model) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      user_agent  TEXT,
      ip          TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at  TEXT NOT NULL,
      last_seen   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transports (
      id          TEXT PRIMARY KEY,
      label       TEXT NOT NULL,
      type        TEXT NOT NULL CHECK (type IN ('proxy','relay')),
      kind        TEXT NOT NULL,
      url         TEXT NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      country     TEXT
    );

    CREATE TABLE IF NOT EXISTS combos (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      models     TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      event          TEXT NOT NULL,
      client_key_id  INTEGER,
      ip             TEXT,
      user_agent     TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (client_key_id) REFERENCES client_keys(id) ON DELETE SET NULL
    );
`;
