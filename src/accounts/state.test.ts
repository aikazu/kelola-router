import { describe, it, expect } from "vitest";
import { applyErrorState, resetAccountState, isAccountUnavailable, isModelLockActive } from "./state.js";
import type { AccountState, ModelLock } from "./types.js";

const base: AccountState = {
  id: "acc_1", backoffLevel: 0, rateLimitedUntil: null, lastError: null,
  status: "active", enabled: true,
};

describe("state machine", () => {
  it("applyErrorState on 429 sets rateLimitedUntil and bumps backoff", () => {
    const { account, newBackoffLevel } = applyErrorState(base, 429, "rate limit", undefined, undefined, undefined);
    expect(newBackoffLevel).toBe(1);
    expect(new Date(account.rateLimitedUntil!).getTime()).toBeGreaterThan(Date.now());
  });

  it("applyErrorState on 401 sets status=error, no cooldown", () => {
    const { account } = applyErrorState(base, 401, "auth failed", 1004);
    expect(account.status).toBe("error");
    expect(account.rateLimitedUntil).toBeNull();
  });

  it("resetAccountState clears everything", () => {
    const cooled: AccountState = { ...base, backoffLevel: 3, rateLimitedUntil: "2099-01-01", lastError: { status: 429, message: "x", timestamp: "x" }, status: "error" };
    const r = resetAccountState(cooled);
    expect(r.backoffLevel).toBe(0);
    expect(r.rateLimitedUntil).toBeNull();
    expect(r.lastError).toBeNull();
    expect(r.status).toBe("active");
  });

  it("isAccountUnavailable true when rateLimitedUntil in future", () => {
    const a: AccountState = { ...base, rateLimitedUntil: new Date(Date.now() + 60_000).toISOString() };
    expect(isAccountUnavailable(a)).toBe(true);
  });

  it("isAccountUnavailable false when expired", () => {
    const a: AccountState = { ...base, rateLimitedUntil: new Date(Date.now() - 1000).toISOString() };
    expect(isAccountUnavailable(a)).toBe(false);
  });

  it("isModelLockActive respects lockedUntil", () => {
    const l: ModelLock = { accountId: "a", model: "m", lockedUntil: new Date(Date.now() + 60_000).toISOString() };
    expect(isModelLockActive(l)).toBe(true);
    const expired: ModelLock = { ...l, lockedUntil: new Date(Date.now() - 1).toISOString() };
    expect(isModelLockActive(expired)).toBe(false);
  });
});