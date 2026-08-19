/**
 * Kiro access-token management with DB persistence.
 *
 * A Kiro `accounts` row stores its OAuth *refresh token* in `api_key`, the
 * cached short-lived bearer in `access_token`, its expiry in `token_expires_at`
 * (ISO), and the SSO/OIDC fields in `provider_data` (JSON). `ensureAccessToken`
 * returns a valid bearer, refreshing + persisting when the cache is empty or
 * within the expiry buffer.
 */
import type Database from 'better-sqlite3';
import type { Account } from '../../db/repos/accounts.js';
import { updateAccount } from '../../db/repos/accounts.js';
import type { TransportConfig } from '../../transport/types.js';
import { type KiroProviderData, refreshKiroToken } from './token-refresh.js';

/** Refresh when the cached token expires within this window. */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export interface KiroAuth {
  accessToken: string;
  providerData: KiroProviderData | null;
}

export function parseProviderData(raw: string | null): KiroProviderData | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as KiroProviderData;
  } catch {
    return null;
  }
}

function isFresh(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return false;
  return t - Date.now() > EXPIRY_BUFFER_MS;
}

/**
 * Return a valid Kiro bearer for `account`, refreshing + persisting if needed.
 * Throws when no refresh token is present or the refresh fails.
 */
export async function ensureAccessToken(
  db: Database.Database,
  account: Account,
  transport: TransportConfig | null = null
): Promise<KiroAuth> {
  const providerData = parseProviderData(account.provider_data);

  if (account.access_token && isFresh(account.token_expires_at)) {
    return { accessToken: account.access_token, providerData };
  }

  const refreshToken = account.api_key; // refresh token lives in api_key for Kiro
  const result = await refreshKiroToken(refreshToken, providerData, transport);
  if (!result) throw new Error('kiro token refresh failed');

  const expiresAt = result.expiresIn
    ? new Date(Date.now() + result.expiresIn * 1000).toISOString()
    : null;

  // Persist: cache the bearer + expiry, and rotate the refresh token if the
  // upstream returned a new one (stored back into api_key).
  const patch: Partial<Account> = {
    access_token: result.accessToken,
    token_expires_at: expiresAt,
  };
  if (result.refreshToken && result.refreshToken !== refreshToken) {
    patch.api_key = result.refreshToken;
  }
  updateAccount(db, account.id, patch);

  return { accessToken: result.accessToken, providerData };
}
