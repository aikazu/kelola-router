import { describe, it, expect } from "vitest";
import { selectAccount } from "./selection.js";
import type { AccountState } from "./types.js";

function acc(id: string, level = 0, limited = false): AccountState {
  return {
    id, backoffLevel: level,
    rateLimitedUntil: limited ? new Date(Date.now() + 60_000).toISOString() : null,
    lastError: null, status: "active", enabled: true,
  };
}

describe("selectAccount", () => {
  it("returns first available", () => {
    const a = selectAccount([acc("a"), acc("b")]);
    expect(a?.id).toBe("a");
  });

  it("skips rate-limited account", () => {
    const a = selectAccount([acc("a", 0, true), acc("b")]);
    expect(a?.id).toBe("b");
  });

  it("returns null if all limited", () => {
    const a = selectAccount([acc("a", 0, true), acc("b", 0, true)]);
    expect(a).toBeNull();
  });

  it("picks lowest backoff level", () => {
    const a = selectAccount([acc("a", 3), acc("b", 1), acc("c", 2)]);
    expect(a?.id).toBe("b");
  });

  it("skips disabled accounts", () => {
    const a = selectAccount([{ ...acc("a"), enabled: false }, acc("b")]);
    expect(a?.id).toBe("b");
  });
});
