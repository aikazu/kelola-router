import { filterAvailableAccounts } from './state.js';
import type { AccountState, SelectionOpts, SelectionResult } from './types.js';

/**
 * Pick the best available upstream account.
 * Supports three modes: lowest-backoff (default), round-robin, sticky.
 */
export function selectAccount(
  accounts: AccountState[],
  opts: SelectionOpts = { mode: 'lowest-backoff' }
): SelectionResult {
  const available = filterAvailableAccounts(accounts);
  if (available.length === 0)
    return { account: null, reason: opts.mode === 'sticky' ? 'fallback' : opts.mode };

  if (opts.mode === 'round-robin') {
    const cursor = opts.cursor ?? 0;
    const idx = cursor % available.length;
    return { account: available[idx]!, reason: 'round-robin', nextCursor: cursor + 1 };
  }

  if (opts.mode === 'sticky' && opts.clientKeyId != null && opts.stickyMap) {
    const pinned = opts.stickyMap.get(opts.clientKeyId);
    if (pinned) {
      const match = available.find((a) => a.id === pinned);
      if (match) return { account: match, reason: 'sticky' };
    }
    // Fallback to lowest-backoff and pin
    const picked = available.sort((a, b) => a.backoffLevel - b.backoffLevel)[0]!;
    opts.stickyMap.set(opts.clientKeyId, picked.id);
    return { account: picked, reason: 'fallback' };
  }

  // lowest-backoff (default)
  const picked = available.sort((a, b) => a.backoffLevel - b.backoffLevel)[0]!;
  return { account: picked, reason: 'lowest-backoff' };
}
