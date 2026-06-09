/**
 * Migration 003 — per-account transports (proxy pool + relay).
 *
 * Additive only. Introduces a `transports` table holding individual proxy or
 * relay endpoints, and four nullable columns on `accounts` to assign them:
 *
 *   - relay_id           single relay (vercel/cloudflare). Mutually exclusive
 *                        with proxy at resolve time (relay replaces the fetch
 *                        target, mirroring proxyAwareFetch behaviour).
 *   - proxy_id           single proxy (http/socks5).
 *   - proxy_pool         JSON array of proxy transport ids (round-robin pool).
 *   - proxy_rotate_every N requests before advancing to the next pool member.
 *
 * Existing accounts keep NULL on all four and fall back to the global
 * `settings.transport` config — zero breakage for current MiniMax/Kiro rows.
 *
 * The `transports.kind` column doubles for both types:
 *   type='proxy'  -> kind IN ('http','socks5')
 *   type='relay'  -> kind IN ('vercel','cloudflare')
 */
export const migration_003 = {
  id: 3,
  name: 'transports',
  sql: `
    CREATE TABLE IF NOT EXISTS transports (
      id          TEXT PRIMARY KEY,
      label       TEXT NOT NULL,
      type        TEXT NOT NULL CHECK (type IN ('proxy','relay')),
      kind        TEXT NOT NULL,
      url         TEXT NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    ALTER TABLE accounts ADD COLUMN relay_id           TEXT;
    ALTER TABLE accounts ADD COLUMN proxy_id           TEXT;
    ALTER TABLE accounts ADD COLUMN proxy_pool         TEXT;
    ALTER TABLE accounts ADD COLUMN proxy_rotate_every INTEGER NOT NULL DEFAULT 1;
  `,
};
