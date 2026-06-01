export type CreditType = "payg" | "token-plan";
export type AccountStatus = "active" | "error" | "disabled";
export type SelectionMode = "sticky" | "round-robin";

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
