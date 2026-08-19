import { BACKOFF_MAX_LEVEL, getQuotaCooldown } from './backoff.js';

export interface FallbackDecision {
  shouldFallback: boolean;
  cooldownMs: number;
  newBackoffLevel?: number;
  source: 'rule' | 'default' | 'window-reset' | 'balance' | 'token-limit' | 'param';
}

interface ErrorRule {
  text?: string;
  status?: number;
  backoff?: boolean;
  cooldownMs?: number;
}

const ERROR_RULES: ErrorRule[] = [
  { text: 'rate limit', backoff: true },
  { text: 'rate growth', backoff: true },
  { text: 'window exhausted', cooldownMs: 0 },
  { status: 429, backoff: true },
  { status: 401, cooldownMs: 0 },
  { status: 400, cooldownMs: 0 },
  { status: 500, cooldownMs: 5000 },
  { status: 502, cooldownMs: 5000 },
  { status: 503, cooldownMs: 5000 },
  { status: 504, cooldownMs: 5000 },
];

export function checkFallbackError(
  status: number,
  errorText: string,
  baseRespCode: number | undefined,
  backoffLevel: number,
  windowResetMs?: number,
  retryAfterHeader?: number,
  errorCode?: string
): FallbackDecision {
  if (status === 429 && retryAfterHeader && retryAfterHeader > 0) {
    return { shouldFallback: true, cooldownMs: retryAfterHeader * 1000, source: 'rule' };
  }
  if ((baseRespCode === 2056 || baseRespCode === 2061) && windowResetMs && windowResetMs > 0) {
    return { shouldFallback: true, cooldownMs: windowResetMs, source: 'window-reset' };
  }

  // OpenAI / New-API error codes (TabiToken, and any OpenAI-compatible gateway).
  // Priority 2.5 — semantic codes override text matching, mirroring the MiniMax
  // base_resp.status_code block below.
  if (errorCode) {
    // insufficient_user_quota: prepaid credit exhausted — permanent disable.
    if (errorCode === 'insufficient_user_quota') {
      return { shouldFallback: false, cooldownMs: 0, source: 'balance' };
    }
    // invalid_api_key / authentication_error: credential problem — no cooldown.
    if (errorCode === 'invalid_api_key' || errorCode === 'authentication_error') {
      return { shouldFallback: true, cooldownMs: 0, source: 'rule' };
    }
    // context_length_exceeded: caller error, don't back off.
    if (errorCode === 'context_length_exceeded') {
      return { shouldFallback: true, cooldownMs: 0, source: 'token-limit' };
    }
  }

  // MiniMax base_resp.status_code priority 2.5 — semantic codes override text matching.
  if (baseRespCode !== undefined) {
    // 1002: rate limit — exponential backoff
    if (baseRespCode === 1002) {
      const newLevel = Math.min(backoffLevel + 1, BACKOFF_MAX_LEVEL);
      return {
        shouldFallback: true,
        cooldownMs: getQuotaCooldown(newLevel),
        newBackoffLevel: newLevel,
        source: 'rule',
      };
    }
    // 1008: insufficient balance — permanent disable (no cooldown, sentinel source)
    if (baseRespCode === 1008) {
      return { shouldFallback: false, cooldownMs: 0, source: 'balance' };
    }
    // 1039: token limit exceeded — caller error, don't back off
    if (baseRespCode === 1039) {
      return { shouldFallback: true, cooldownMs: 0, source: 'token-limit' };
    }
    // 2013: parameter error — caller error, don't back off
    if (baseRespCode === 2013) {
      return { shouldFallback: true, cooldownMs: 0, source: 'param' };
    }
    // 1004: auth fail — don't backoff (per-account error state handles it)
    if (baseRespCode === 1004) {
      return { shouldFallback: true, cooldownMs: 0, source: 'rule' };
    }
    // 1001: upstream timeout — short retry
    if (baseRespCode === 1001) {
      return { shouldFallback: true, cooldownMs: 10_000, source: 'rule' };
    }
    // 1027: output content error — short backoff (likely transient guard)
    if (baseRespCode === 1027) {
      const newLevel = Math.min(backoffLevel + 1, BACKOFF_MAX_LEVEL);
      return {
        shouldFallback: true,
        cooldownMs: getQuotaCooldown(newLevel),
        newBackoffLevel: newLevel,
        source: 'rule',
      };
    }
    // 1013: internal — default 5s
    if (baseRespCode === 1013) {
      return { shouldFallback: true, cooldownMs: 5000, source: 'rule' };
    }
  }
  const lower = (errorText || '').toLowerCase();
  for (const rule of ERROR_RULES) {
    if (rule.text && lower.includes(rule.text)) {
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_MAX_LEVEL);
        return {
          shouldFallback: true,
          cooldownMs: getQuotaCooldown(newLevel),
          newBackoffLevel: newLevel,
          source: 'rule',
        };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs ?? 0, source: 'rule' };
    }
    if (rule.status && rule.status === status) {
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_MAX_LEVEL);
        return {
          shouldFallback: true,
          cooldownMs: getQuotaCooldown(newLevel),
          newBackoffLevel: newLevel,
          source: 'rule',
        };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs ?? 0, source: 'rule' };
    }
  }
  return { shouldFallback: true, cooldownMs: 5000, source: 'default' };
}
