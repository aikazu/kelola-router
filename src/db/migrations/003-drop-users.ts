import type Database from "better-sqlite3";

/**
 * Drop multi-tenant scaffolding (users, user_settings) and introduce
 * client_keys table: each row is a router bearer credential for one
 * client/user. The accounts table is kept (no more user_id) and becomes
 * the pool of MiniMax upstream keys for fallback.
 */
export const migration_003 = {
  id: 3,
  name: "client_keys",
  // Idempotent: only run if legacy users table still exists
  condition: (db: Database.Database) => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    return tables.some(t => t.name === "users");
  },
  sql: `
    -- Rebuild accounts without user_id
    CREATE TABLE accounts_new (
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
    INSERT INTO accounts_new (id, label, credit_type, api_key, base_url, enabled,
                              rate_limited_until, backoff_level, last_error, status, created_at)
      SELECT id, label, credit_type, api_key, base_url, enabled,
             rate_limited_until, backoff_level, last_error, status, COALESCE(created_at, datetime('now'))
      FROM accounts;
    DROP TABLE accounts;
    ALTER TABLE accounts_new RENAME TO accounts;

    -- Rebuild request_logs: drop user_id, add client_key_id
    CREATE TABLE request_logs_new (
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
    INSERT INTO request_logs_new (id, client_key_id, account_id, model, endpoint, format,
                                  prompt_tokens, completion_tokens, cache_creation_tokens,
                                  cache_read_tokens, total_tokens, cost_usd, latency_ms,
                                  status_code, base_resp_code, stream, relay_path, proxy_path,
                                  rtk_bytes_saved, caveman_level, error_message, created_at)
      SELECT id, NULL, account_id, model, endpoint, format,
             prompt_tokens, completion_tokens, cache_creation_tokens,
             cache_read_tokens, total_tokens, cost_usd, latency_ms,
             status_code, base_resp_code, stream, relay_path, proxy_path,
             rtk_bytes_saved, caveman_level, error_message, created_at
      FROM request_logs;
    DROP TABLE request_logs;
    ALTER TABLE request_logs_new RENAME TO request_logs;

    -- New table: client_keys (router bearer credentials)
    CREATE TABLE client_keys (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      label       TEXT NOT NULL,
      key         TEXT NOT NULL UNIQUE,
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    DROP TABLE user_settings;
    DROP TABLE users;
  `,
};
