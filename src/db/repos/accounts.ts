import type Database from 'better-sqlite3';
import { cachedStmt } from '../cachedStmt.js';

export type ProviderName = 'minimax' | 'kiro' | 'codebuddy';

export interface Account {
  id: string;
  label: string;
  credit_type: 'payg' | 'token-plan';
  api_key: string;
  base_url: string | null;
  enabled: boolean;
  rate_limited_until: string | null;
  backoff_level: number;
  last_error: string | null;
  status: 'active' | 'error' | 'disabled';
  created_at: string;
  /** Upstream provider. Defaults to 'minimax' for legacy rows. */
  provider: ProviderName;
  /** Kiro: cached short-lived bearer (refreshed from api_key=refresh_token). */
  access_token: string | null;
  /** Kiro: ISO timestamp when access_token expires. */
  token_expires_at: string | null;
  /** Kiro: JSON blob {clientId, clientSecret, region, profileArn, authMethod}. */
  provider_data: string | null;
  /** Single relay transport id (vercel/cloudflare). Mutually exclusive with proxy. */
  relay_id: string | null;
  /** Single proxy transport id (http/socks5). */
  proxy_id: string | null;
  /** JSON array of proxy transport ids for round-robin pool. */
  proxy_pool: string | null;
  /** Advance to the next pool member every N requests (>=1). */
  proxy_rotate_every: number;
}

export type AccountCreate = Pick<Account, 'id' | 'label' | 'credit_type' | 'api_key'> & {
  base_url?: string | null;
  enabled?: boolean;
  provider?: ProviderName;
  provider_data?: string | null;
};

export function createAccount(db: Database.Database, input: AccountCreate): Account {
  cachedStmt(
    db,
    `
    INSERT INTO accounts (id, label, credit_type, api_key, base_url, enabled, provider, provider_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    input.id,
    input.label,
    input.credit_type,
    input.api_key,
    input.base_url ?? null,
    input.enabled === false ? 0 : 1,
    input.provider ?? 'minimax',
    input.provider_data ?? null
  );
  return getAccount(db, input.id)!;
}

export function getAccount(db: Database.Database, id: string): Account | null {
  return (
    (cachedStmt(db, `SELECT * FROM accounts WHERE id = ?`).get(id) as Account | undefined) ?? null
  );
}

export function getAccountByApiKey(db: Database.Database, apiKey: string): Account | null {
  return (
    (cachedStmt(db, `SELECT * FROM accounts WHERE api_key = ?`).get(apiKey) as
      | Account
      | undefined) ?? null
  );
}

export function listAccounts(db: Database.Database): Account[] {
  return cachedStmt(db, `SELECT * FROM accounts ORDER BY created_at`).all() as Account[];
}

export function listEnabledAccounts(db: Database.Database): Account[] {
  return cachedStmt(
    db,
    `SELECT * FROM accounts WHERE enabled = 1 ORDER BY created_at`
  ).all() as Account[];
}

export function listEnabledAccountsByProvider(
  db: Database.Database,
  provider: ProviderName
): Account[] {
  return cachedStmt(
    db,
    `SELECT * FROM accounts WHERE enabled = 1 AND provider = ? ORDER BY created_at`
  ).all(provider) as Account[];
}

export function updateAccount(db: Database.Database, id: string, patch: Partial<Account>): void {
  const keys = Object.keys(patch).filter((k) => k !== 'id' && k !== 'created_at');
  if (keys.length === 0) return;
  const set = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => (patch as Record<string, unknown>)[k]);
  cachedStmt(db, `UPDATE accounts SET ${set} WHERE id = ?`).run(...values, id);
}

export function enableAccount(db: Database.Database, id: string): void {
  cachedStmt(db, `UPDATE accounts SET enabled = 1 WHERE id = ?`).run(id);
}

export function disableAccount(db: Database.Database, id: string): void {
  cachedStmt(db, `UPDATE accounts SET enabled = 0 WHERE id = ?`).run(id);
}

export function deleteAccount(db: Database.Database, id: string): void {
  cachedStmt(db, `DELETE FROM accounts WHERE id = ?`).run(id);
}
