import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../db/index.js";
import { resolveModel } from "./alias.js";

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "al-")), "t.db");
});

describe("resolveModel", () => {
  it("M3 → upstream M3, no thinking injected", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M3", messages: [] };
    const r = resolveModel(db, "MiniMax-M3", body);
    expect(r.upstreamModel).toBe("MiniMax-M3");
    r.bodyTransform(body);
    expect(body.thinking).toBeUndefined();
  });

  it("M3-thinking → upstream M3, injects thinking.enabled", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M3-thinking", messages: [] };
    const r = resolveModel(db, "MiniMax-M3-thinking", body);
    expect(r.upstreamModel).toBe("MiniMax-M3");
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
  });

  it("M3-thinking respects caller override of budget_tokens", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M3-thinking", messages: [], thinking: { type: "enabled", budget_tokens: 16384 } };
    const r = resolveModel(db, "MiniMax-M3-thinking", body);
    r.bodyTransform(body);
    expect(body.thinking.budget_tokens).toBe(16384);
  });

  it("M2.7-thinking → upstream M2.7, injects thinking", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M2.7-thinking", messages: [] };
    const r = resolveModel(db, "MiniMax-M2.7-thinking", body);
    expect(r.upstreamModel).toBe("MiniMax-M2.7");
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
  });

  it("M2.7 → no thinking injected", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M2.7", messages: [] };
    const r = resolveModel(db, "MiniMax-M2.7", body);
    r.bodyTransform(body);
    expect(body.thinking).toBeUndefined();
  });

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