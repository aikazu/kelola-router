/**
 * Migration 002 — multi-provider support (Kiro / AWS CodeWhisperer).
 *
 * Additive only. Existing MiniMax deploys keep working: every new column has a
 * default that preserves current behaviour (`provider = 'minimax'`). Kiro
 * accounts reuse the `accounts.api_key` column to store their OAuth *refresh
 * token* (it is non-null + unique, satisfying the existing constraints) and add
 * a short-lived `access_token` cache plus a `provider_data` JSON blob carrying
 * the SSO/OIDC fields (clientId, clientSecret, region, profileArn, authMethod).
 *
 * SQLite has no `ADD COLUMN IF NOT EXISTS`, but this migration only ever runs
 * once per database (guarded by `user_version` in the runner), so plain
 * `ALTER TABLE ADD COLUMN` is safe.
 */
export const migration_002 = {
  id: 2,
  name: 'kiro-provider',
  sql: `
    ALTER TABLE accounts ADD COLUMN provider         TEXT NOT NULL DEFAULT 'minimax';
    ALTER TABLE accounts ADD COLUMN access_token     TEXT;
    ALTER TABLE accounts ADD COLUMN token_expires_at TEXT;
    ALTER TABLE accounts ADD COLUMN provider_data    TEXT;

    ALTER TABLE models ADD COLUMN provider TEXT NOT NULL DEFAULT 'minimax';
  `,
};
