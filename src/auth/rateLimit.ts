// In-memory token bucket: 5 failed login attempts per IP per 15 min.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const SWEEP_THRESHOLD = 10_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

function maybeSweep(now: number): void {
  if (buckets.size <= SWEEP_THRESHOLD) return;
  for (const [k, v] of buckets) {
    if (now > v.resetAt) buckets.delete(k);
  }
}

export function recordLoginFailure(ip: string): { locked: boolean; resetAt: number } {
  const now = Date.now();
  maybeSweep(now);
  const b = buckets.get(ip) ?? { count: 0, resetAt: now + WINDOW_MS };
  if (now > b.resetAt) {
    b.count = 0;
    b.resetAt = now + WINDOW_MS;
  }
  b.count++;
  buckets.set(ip, b);
  return { locked: b.count >= MAX_FAILS, resetAt: b.resetAt };
}

export function isLoginLocked(ip: string): { locked: boolean; retryAfterMs: number } {
  const b = buckets.get(ip);
  if (!b) return { locked: false, retryAfterMs: 0 };
  if (Date.now() > b.resetAt) return { locked: false, retryAfterMs: 0 };
  if (b.count >= MAX_FAILS) return { locked: true, retryAfterMs: b.resetAt - Date.now() };
  return { locked: false, retryAfterMs: 0 };
}

export function clearLoginFailures(ip: string): void {
  buckets.delete(ip);
}

export function _resetRateLimitForTests(): void {
  buckets.clear();
}
