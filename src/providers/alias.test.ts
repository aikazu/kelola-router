import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../db/index.js";
import { resolveModel, ADAPTIVE_THINKING_MODELS, LEGACY_MODEL_ALIASES } from "./alias.js";

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "al-")), "t.db");
});

describe("resolveModel — base behavior", () => {
  it("M3 → upstream M3, no client thinking set → router injects adaptive", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M3", messages: [] };
    const r = resolveModel(db, "MiniMax-M3", body);
    expect(r.upstreamModel).toBe("MiniMax-M3");
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.reasoning_split).toBe(true);
  });

  it("M2.7 → upstream M2.7, no client thinking → adaptive", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M2.7", messages: [] };
    const r = resolveModel(db, "MiniMax-M2.7", body);
    expect(r.upstreamModel).toBe("MiniMax-M2.7");
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.reasoning_split).toBe(true);
  });

  it("M2.7-highspeed → upstream unchanged, adaptive injected", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M2.7-highspeed", messages: [] };
    const r = resolveModel(db, "MiniMax-M2.7-highspeed", body);
    expect(r.upstreamModel).toBe("MiniMax-M2.7-highspeed");
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: "adaptive" });
  });

  it("M2-her → no thinking injection, no reasoning_split", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M2-her", messages: [] };
    const r = resolveModel(db, "MiniMax-M2-her", body);
    expect(r.upstreamModel).toBe("MiniMax-M2-her");
    r.bodyTransform(body);
    expect(body.thinking).toBeUndefined();
    expect(body.reasoning_split).toBeUndefined();
  });
});

describe("resolveModel — caller wins on thinking", () => {
  it("client thinking.type=disabled → router does NOT inject", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M3", messages: [], thinking: { type: "disabled" } };
    resolveModel(db, "MiniMax-M3", body).bodyTransform(body);
    expect(body.thinking).toEqual({ type: "disabled" });
    // reasoning_split still auto-on because thinking is present
    expect(body.reasoning_split).toBe(true);
  });

  it("client thinking.type=adaptive with budget_tokens → router leaves it", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M2.7", messages: [], thinking: { type: "adaptive", budget_tokens: 8192 } };
    resolveModel(db, "MiniMax-M2.7", body).bodyTransform(body);
    expect(body.thinking).toEqual({ type: "adaptive", budget_tokens: 8192 });
  });

  it("client reasoning_split=false + thinking disabled → respects caller", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M3", messages: [], thinking: { type: "disabled" }, reasoning_split: false };
    resolveModel(db, "MiniMax-M3", body).bodyTransform(body);
    expect(body.reasoning_split).toBe(false);
  });
});

describe("resolveModel — legacy aliases", () => {
  it("M2.7-thinking → resolves to M2.7, adaptive injected", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M2.7-thinking", messages: [] };
    const r = resolveModel(db, "MiniMax-M2.7-thinking", body);
    expect(r.upstreamModel).toBe("MiniMax-M2.7");
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.reasoning_split).toBe(true);
  });

  it("M3-thinking → resolves to M3, adaptive injected (legacy compat)", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M3-thinking", messages: [] };
    const r = resolveModel(db, "MiniMax-M3-thinking", body);
    expect(r.upstreamModel).toBe("MiniMax-M3");
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: "adaptive" });
  });

  it("LEGACY_MODEL_ALIASES only contains retired names", () => {
    expect(LEGACY_MODEL_ALIASES["MiniMax-M2.7-thinking"]).toBe("MiniMax-M2.7");
    expect(LEGACY_MODEL_ALIASES["MiniMax-M3-thinking"]).toBe("MiniMax-M3");
  });
});

describe("resolveModel — error paths", () => {
  it("unknown model throws", () => {
    const db = openDb();
    expect(() => resolveModel(db, "totally-fake-model", {})).toThrow(/unknown model/);
  });

  it("disabled model throws", () => {
    const db = openDb();
    db.prepare(`UPDATE models SET enabled = 0 WHERE name = ?`).run("MiniMax-M3");
    expect(() => resolveModel(db, "MiniMax-M3", {})).toThrow(/model disabled/);
  });
});

describe("ADAPTIVE_THINKING_MODELS allowlist", () => {
  it("contains all MiniMax reference docs thinking-capable models", () => {
    expect(ADAPTIVE_THINKING_MODELS.has("MiniMax-M3")).toBe(true);
    expect(ADAPTIVE_THINKING_MODELS.has("MiniMax-M2.7")).toBe(true);
    expect(ADAPTIVE_THINKING_MODELS.has("MiniMax-M2.7-highspeed")).toBe(true);
    expect(ADAPTIVE_THINKING_MODELS.has("MiniMax-M2.5")).toBe(true);
    expect(ADAPTIVE_THINKING_MODELS.has("MiniMax-M2.5-highspeed")).toBe(true);
    expect(ADAPTIVE_THINKING_MODELS.has("MiniMax-M2.1")).toBe(true);
    expect(ADAPTIVE_THINKING_MODELS.has("MiniMax-M2.1-highspeed")).toBe(true);
    expect(ADAPTIVE_THINKING_MODELS.has("MiniMax-M2")).toBe(true);
  });

  it("does NOT contain M2-her (not in MiniMax docs)", () => {
    expect(ADAPTIVE_THINKING_MODELS.has("MiniMax-M2-her")).toBe(false);
  });
});

describe("M3 max_completion_tokens default", () => {
  it("sets max_completion_tokens=131072 when caller omits it (M3)", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M3", messages: [] };
    resolveModel(db, "MiniMax-M3", body).bodyTransform(body);
    expect(body.max_completion_tokens).toBe(131072);
  });

  it("respects caller-provided max_completion_tokens", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M3", messages: [], max_completion_tokens: 8192 };
    resolveModel(db, "MiniMax-M3", body).bodyTransform(body);
    expect(body.max_completion_tokens).toBe(8192);
  });

  it("does NOT default for non-M3 models", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M2.7", messages: [] };
    resolveModel(db, "MiniMax-M2.7", body).bodyTransform(body);
    expect(body.max_completion_tokens).toBeUndefined();
  });
});
