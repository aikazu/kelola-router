const BASE_MS = 1000;
const MAX_MS = 4 * 60 * 1000;

export function getQuotaCooldown(backoffLevel: number): number {
  if (backoffLevel <= 0) return 0;
  if (backoffLevel >= 8) return MAX_MS;
  const ms = BASE_MS * 2 ** (backoffLevel - 1);
  return ms;
}

export const BACKOFF_MAX_LEVEL = 8;
