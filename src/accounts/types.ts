export type CreditType = 'payg' | 'token-plan';
export type AccountStatus = 'active' | 'error' | 'disabled';
export type SelectionMode = 'lowest-backoff' | 'round-robin' | 'sticky';
export type SelectionReason = 'lowest-backoff' | 'round-robin' | 'sticky' | 'fallback';

export interface SelectionOpts {
  mode: SelectionMode;
  cursor?: number;
  /** Round-robin only: stay on the same account for `step` consecutive requests. Default 1. */
  step?: number;
  clientKeyId?: number;
  stickyMap?: Map<number, string>;
}

export interface SelectionResult {
  account: AccountState | null;
  reason: SelectionReason;
  nextCursor?: number;
}

export interface AccountState {
  id: string;
  backoffLevel: number;
  rateLimitedUntil: string | null;
  lastError: { status: number; message: string; timestamp: string; baseRespCode?: number } | null;
  status: AccountStatus;
  enabled: boolean;
}

export interface ModelLock {
  accountId: string;
  model: string;
  lockedUntil: string;
}
