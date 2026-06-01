import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../index.js";
import { getModel, listModels, upsertModel, disableModel } from "./models.js";

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "m-")), "t.db");
});

describe("models repo", () => {
  it("getModel returns seed model by name", () => {
    const db = openDb();
    const m = getModel(db, "MiniMax-M3");
    expect(m?.upstream_model).toBe("MiniMax-M3");
    expect(m?.thinking_enabled).toBe(0);
  });

  it("getModel returns null for unknown", () => {
    const db = openDb();
    expect(getModel(db, "nope")).toBeNull();
  });

  it("listModels returns enabled only by default", () => {
    const db = openDb();
    expect(listModels(db).length).toBe(11);
    const all = listModels(db, { includeDisabled: true });
    expect(all.length).toBe(11);
  });

  it("upsertModel inserts new", () => {
    const db = openDb();
    upsertModel(db, { name: "custom-x", upstream_model: "custom-x", display_name: "Custom X", family: "custom", source: "manual" });
    expect(getModel(db, "custom-x")?.display_name).toBe("Custom X");
  });

  it("upsertModel updates existing (name match)", () => {
    const db = openDb();
    upsertModel(db, { name: "MiniMax-M3", upstream_model: "MiniMax-M3", display_name: "Updated", family: "m3", source: "fetched" });
    expect(getModel(db, "MiniMax-M3")?.display_name).toBe("Updated");
  });

  it("disableModel sets enabled=0", () => {
    const db = openDb();
    disableModel(db, "MiniMax-M3");
    expect(getModel(db, "MiniMax-M3")?.enabled).toBe(0);
  });
});