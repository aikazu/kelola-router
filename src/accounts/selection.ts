import { filterAvailableAccounts } from './state.js';
import type { AccountState } from './types.js';

/**
 * Pick the best available upstream account.
 * Strategy: lowest backoff level among non-rate-limited, non-disabled accounts.
 * Returns null when no account is available.
 */
export function selectAccount(accounts: AccountState[]): AccountState | null {
  const available = filterAvailableAccounts(accounts);
  if (available.length === 0) return null;
  return available.sort((a, b) => a.backoffLevel - b.backoffLevel)[0]!;
}
