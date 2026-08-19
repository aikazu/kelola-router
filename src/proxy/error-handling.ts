import type Database from 'better-sqlite3';
import { checkFallbackError, type FallbackDecision } from '../accounts/error-rules.js';
import { clearExpiredModelLocks, getModelLock, setModelLock } from '../accounts/locks.js';
import { isModelLockActive } from '../accounts/state.js';
import type { AccountState } from '../accounts/types.js';
import { disableAccount, updateAccount } from '../db/repos/accounts.js';
import { parseError } from '../providers/parse-error.js';
import { applyErrorState, type Db } from './pipeline.js';

export interface UpstreamErrorInput {
  account: { id: string };
  acc: AccountState;
  status: number;
  errBody: string;
  response?: Response;
  retryAfterSec?: number;
  upstreamModel: string;
}

export interface UpstreamErrorResult {
  decision: FallbackDecision;
  parsed: {
    baseRespCode?: number;
    windowResetMs?: number;
    retryAfterSec?: number;
    message: string;
  };
}

/**
 * Canonical post-fetch error sequence shared by every provider.
 * parseError → checkFallbackError → applyErrorState → setModelLock → disableAccount.
 * Mirrors src/proxy/minimax.ts:349-365.
 */
export function handleUpstreamError(
  db: Database.Database,
  input: UpstreamErrorInput
): UpstreamErrorResult {
  const stateDb: Db = { updateAccount: (id, patch) => updateAccount(db, id, patch) };
  const parsed = input.response
    ? parseError(input.response, input.errBody)
    : {
        baseRespCode: undefined,
        windowResetMs: undefined,
        retryAfterSec: input.retryAfterSec,
        message: input.errBody || `HTTP ${input.status}`,
      };
  const decision = checkFallbackError(
    input.status,
    parsed.message,
    parsed.baseRespCode,
    input.acc.backoffLevel,
    parsed.windowResetMs,
    parsed.retryAfterSec,
    parsed.errorCode
  );
  applyErrorState(stateDb, input.acc, decision, input.errBody, {
    status: input.status,
    baseRespCode: parsed.baseRespCode,
  });
  if (decision.cooldownMs > 0)
    setModelLock(db, input.account.id, input.upstreamModel, decision.cooldownMs);
  if (decision.source === 'balance') disableAccount(db, input.account.id);
  return { decision, parsed };
}

/**
 * Pre-fetch model-lock gate shared by every provider.
 * Returns true when the account is currently locked for `model` (caller → 429).
 * Mirrors src/proxy/minimax.ts:303-305.
 */
export function assertModelNotLocked(
  db: Database.Database,
  accountId: string,
  model: string
): boolean {
  clearExpiredModelLocks(db);
  return isModelLockActive(getModelLock(db, accountId, model));
}
