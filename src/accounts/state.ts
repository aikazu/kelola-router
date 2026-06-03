import { checkFallbackError, type FallbackDecision } from './errorRules.js';
import type { AccountState, ModelLock } from './types.js';

export interface ApplyErrorResult {
  account: AccountState;
  decision: FallbackDecision;
}

export function applyErrorState(
  account: AccountState,
  status: number,
  errorText: string,
  baseRespCode?: number,
  windowResetMs?: number,
  retryAfterHeader?: number
): ApplyErrorResult {
  const decision = checkFallbackError(
    status,
    errorText,
    baseRespCode,
    account.backoffLevel,
    windowResetMs,
    retryAfterHeader
  );
  const newAccount: AccountState = {
    ...account,
    rateLimitedUntil:
      decision.cooldownMs > 0 ? new Date(Date.now() + decision.cooldownMs).toISOString() : null,
    backoffLevel: decision.newBackoffLevel ?? account.backoffLevel,
    lastError: {
      status,
      message: errorText.slice(0, 500),
      timestamp: new Date().toISOString(),
      baseRespCode,
    },
    status: status === 401 ? 'error' : account.status,
  };
  return { account: newAccount, decision };
}

export function resetAccountState(account: AccountState): AccountState {
  return { ...account, rateLimitedUntil: null, backoffLevel: 0, lastError: null, status: 'active' };
}

export function isAccountUnavailable(account: AccountState): boolean {
  if (!account.rateLimitedUntil) return false;
  return new Date(account.rateLimitedUntil).getTime() > Date.now();
}

export function isModelLockActive(lock: ModelLock | undefined): boolean {
  if (!lock) return false;
  return new Date(lock.lockedUntil).getTime() > Date.now();
}

export function filterAvailableAccounts(
  accounts: AccountState[],
  excludeId?: string
): AccountState[] {
  return accounts.filter((a) => {
    if (!a.enabled) return false;
    if (a.status === 'disabled') return false;
    if (excludeId && a.id === excludeId) return false;
    if (isAccountUnavailable(a)) return false;
    return true;
  });
}
