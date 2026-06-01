import { getQuotaCooldown, BACKOFF_MAX_LEVEL } from "./backoff.js";

export interface FallbackDecision {
  shouldFallback: boolean;
  cooldownMs: number;
  newBackoffLevel?: number;
  source: "rule" | "default" | "window-reset";
}

interface ErrorRule {
  text?: string;
  status?: number;
  backoff?: boolean;
  cooldownMs?: number;
}

const ERROR_RULES: ErrorRule[] = [
  { text: "rate limit",     backoff: true },
  { text: "rate growth",    backoff: true },
  { text: "window exhausted", cooldownMs: 0 },
  { status: 429,              backoff: true },
  { status: 401,              cooldownMs: 0 },
  { status: 400,              cooldownMs: 0 },
  { status: 500,              cooldownMs: 5000 },
  { status: 502,              cooldownMs: 5000 },
  { status: 503,              cooldownMs: 5000 },
  { status: 504,              cooldownMs: 5000 },
];

export function checkFallbackError(
  status: number,
  errorText: string,
  baseRespCode: number | undefined,
  backoffLevel: number,
  windowResetMs?: number,
  retryAfterHeader?: number,
): FallbackDecision {
  if (status === 429 && retryAfterHeader && retryAfterHeader > 0) {
    return { shouldFallback: true, cooldownMs: retryAfterHeader * 1000, source: "rule" };
  }
  if ((baseRespCode === 2056 || baseRespCode === 2061) && windowResetMs && windowResetMs > 0) {
    return { shouldFallback: true, cooldownMs: windowResetMs, source: "window-reset" };
  }
  const lower = (errorText || "").toLowerCase();
  for (const rule of ERROR_RULES) {
    if (rule.text && lower.includes(rule.text)) {
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_MAX_LEVEL);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel, source: "rule" };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs ?? 0, source: "rule" };
    }
    if (rule.status && rule.status === status) {
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_MAX_LEVEL);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel, source: "rule" };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs ?? 0, source: "rule" };
    }
  }
  return { shouldFallback: true, cooldownMs: 5000, source: "default" };
}