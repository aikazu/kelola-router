import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../db/index.js";
import { clearCache as clearSettingsCache } from "../db/repos/settings.js";
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

describe("M3 max_completion_tokens default (G7)", () => {
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

describe("reasoning_split default (G4)", () => {
  it("applies settings.minimax.reasoningSplitDefault=true to OpenAI M3 body", () => {
    const db = openDb();
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('minimax', ?)`)
      .run(JSON.stringify({ reasoningSplitDefault: true, upstreamFormat: "auto" }));
    clearSettingsCache();
    const body: any = { model: "MiniMax-M3", messages: [] };
    resolveModel(db, "MiniMax-M3", body).bodyTransform(body);
    expect(body.reasoning_split).toBe(true);
  });

  it("no-op when reasoningSplitDefault not set (default false)", () => {
    clearSettingsCache();
    const db = openDb();
    // Ensure no leftover minimax row from prior tests in this file (cache is per-process)
    db.prepare(`DELETE FROM settings WHERE key = 'minimax'`).run();
    const body: any = { model: "MiniMax-M3", messages: [] };
    resolveModel(db, "MiniMax-M3", body).bodyTransform(body);
    expect(body.reasoning_split).toBeUndefined();
  });

  it("respects caller-provided reasoning_split", () => {
    const db = openDb();
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('minimax', ?)`)
      .run(JSON.stringify({ reasoningSplitDefault: true, upstreamFormat: "auto" }));
    clearSettingsCache();
    const body: any = { model: "MiniMax-M3", messages: [], reasoning_split: false };
    resolveModel(db, "MiniMax-M3", body).bodyTransform(body);
    expect(body.reasoning_split).toBe(false);
  });
});