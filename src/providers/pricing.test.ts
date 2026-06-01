import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../db/index.js";
import { resolvePricing, calculateCost } from "./pricing.js";

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "pr-")), "t.db");
});

describe("resolvePricing", () => {
  it("M3 ≤ 512k → base pricing", () => {
    const db = openDb();
    const p = resolvePricing(db, "MiniMax-M3", 100_000);
    expect(p?.input).toBe(0.60);
    expect(p?.output).toBe(2.40);
    expect(p?.cacheRead).toBe(0.12);
  });

  it("M3 > 512k → high pricing (2x)", () => {
    const db = openDb();
    const p = resolvePricing(db, "MiniMax-M3", 600_000);
    expect(p?.input).toBe(1.20);
    expect(p?.output).toBe(4.80);
    expect(p?.cacheRead).toBe(0.24);
  });

  it("M2.7 → flat pricing", () => {
    const db = openDb();
    const p = resolvePricing(db, "MiniMax-M2.7", 50_000);
    expect(p?.input).toBe(0.30);
    expect(p?.output).toBe(1.20);
    expect(p?.cacheRead).toBe(0.06);
    expect(p?.cacheWrite).toBe(0.375);
  });

  it("M2-her with NULL pricing → null", () => {
    const db = openDb();
    expect(resolvePricing(db, "MiniMax-M2-her", 1000)).toBeNull();
  });

  it("unknown model → null", () => {
    const db = openDb();
    expect(resolvePricing(db, "nope", 1000)).toBeNull();
  });
});

describe("calculateCost", () => {
  it("M2.7 with cache_read returns positive cost", () => {
    const db = openDb();
    const c = calculateCost(db, "MiniMax-M2.7", {
      prompt_tokens: 1000, completion_tokens: 500, cache_creation_tokens: 0, cache_read_tokens: 2000,
    });
    const expected = (1000/1e6)*0.30 + (500/1e6)*1.20 + (2000/1e6)*0.06;
    expect(c).toBeCloseTo(expected, 8);
  });

  it("M3 with cache_creation: cacheWrite NULL → cost excludes cache_creation (honest unknown)", () => {
    const db = openDb();
    const c = calculateCost(db, "MiniMax-M3", {
      prompt_tokens: 1000, completion_tokens: 500, cache_creation_tokens: 1000, cache_read_tokens: 0,
    });
    const expected = (1000/1e6)*0.60 + (500/1e6)*2.40;
    expect(c).toBeCloseTo(expected, 8);
  });

  it("unknown model → cost = 0 (caller should log NULL)", () => {
    const db = openDb();
    const c = calculateCost(db, "nope", { prompt_tokens: 100, completion_tokens: 100, cache_creation_tokens: 0, cache_read_tokens: 0 });
    expect(c).toBe(0);
  });
});