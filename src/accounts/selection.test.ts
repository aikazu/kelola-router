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
  it("round-robin: returns first available", () => {
    const a = selectAccount([acc("a"), acc("b")], "round-robin");
    expect(a?.id).toBe("a");
  });

  it("round-robin: skips rate-limited account", () => {
    const a = selectAccount([acc("a", 0, true), acc("b")], "round-robin");
    expect(a?.id).toBe("b");
  });

  it("round-robin: returns null if all limited", () => {
    const a = selectAccount([acc("a", 0, true), acc("b", 0, true)], "round-robin");
    expect(a).toBeNull();
  });

  it("sticky: pins to sticky key's account if available", () => {
    const stickyMap = new Map<string, string>([["sess_1", "b"]]);
    const a = selectAccount([acc("a"), acc("b")], "sticky", "sess_1", stickyMap);
    expect(a?.id).toBe("b");
  });

  it("sticky: falls back to any available if pinned is limited", () => {
    const stickyMap = new Map<string, string>([["sess_1", "b"]]);
    const a = selectAccount([acc("a"), acc("b", 0, true)], "sticky", "sess_1", stickyMap);
    expect(a?.id).toBe("a");
  });

  it("sticky without stickyKey behaves like round-robin", () => {
    const a = selectAccount([acc("a"), acc("b")], "sticky");
    expect(a?.id).toBe("a");
  });

  it("picks lowest backoff level", () => {
    const a = selectAccount([acc("a", 3), acc("b", 1), acc("c", 2)], "round-robin");
    expect(a?.id).toBe("b");
  });

  it("skips disabled accounts", () => {
    const a = selectAccount([{ ...acc("a"), enabled: false }, acc("b")], "round-robin");
    expect(a?.id).toBe("b");
  });
});