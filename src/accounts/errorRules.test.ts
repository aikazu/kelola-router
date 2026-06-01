import { describe, it, expect } from "vitest";
import { checkFallbackError } from "./errorRules.js";

describe("checkFallbackError", () => {
  it("honors Retry-After header on 429 (priority 1)", () => {
    const d = checkFallbackError(429, "rate limit", undefined, 0, undefined, 30);
    expect(d.cooldownMs).toBe(30_000);
    expect(d.source).toBe("rule");
  });

  it("uses window reset for baseResp 2056 (priority 2)", () => {
    const d = checkFallbackError(200, "window exhausted", 2056, 0, 600_000, undefined);
    expect(d.cooldownMs).toBe(600_000);
    expect(d.source).toBe("window-reset");
  });

  it("uses window reset for baseResp 2061 (priority 2)", () => {
    const d = checkFallbackError(200, "window exhausted", 2061, 0, 1_200_000, undefined);
    expect(d.cooldownMs).toBe(1_200_000);
  });

  it("falls back to exponential for text 'rate limit' (priority 3)", () => {
    const d = checkFallbackError(200, "rate limit reached", 1002, 1);
    expect(d.cooldownMs).toBe(2000);
    expect(d.newBackoffLevel).toBe(2);
  });

  it("falls back to exponential for status 429 (priority 3)", () => {
    const d = checkFallbackError(429, "", undefined, 2);
    expect(d.cooldownMs).toBe(4000);
  });

  it("status 401 → no cooldown, mark error", () => {
    const d = checkFallbackError(401, "auth failed", 1004, 0);
    expect(d.cooldownMs).toBe(0);
  });

  it("status 5xx → 5s transient", () => {
    expect(checkFallbackError(500, "", undefined, 0).cooldownMs).toBe(5000);
    expect(checkFallbackError(502, "", undefined, 0).cooldownMs).toBe(5000);
    expect(checkFallbackError(503, "", undefined, 0).cooldownMs).toBe(5000);
    expect(checkFallbackError(504, "", undefined, 0).cooldownMs).toBe(5000);
  });

  it("unknown error → 5s default", () => {
    const d = checkFallbackError(418, "teapot", undefined, 0);
    expect(d.cooldownMs).toBe(5000);
  });
});