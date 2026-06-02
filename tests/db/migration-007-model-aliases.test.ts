import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { migrate } from "../../src/db/migrations/index.js";

let db: Database.Database;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "router-test-"));
  db = new Database(join(dir, "t.db"));
  db.pragma("foreign_keys = ON");
  migrate(db);
});

afterEach(() => { db.close(); rmSync(dir, { recursive: true }); });

describe("migration 007", () => {
  it("creates model_aliases table with expected columns", () => {
    const cols = db.prepare("PRAGMA table_info(model_aliases)").all() as Array<{ name: string; notnull: number; pk: number }>;
    const names = cols.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(["alias_name", "upstream_model", "label", "source", "created_at"]));
    const pk = cols.find(c => c.name === "alias_name");
    expect(pk?.pk).toBe(1);
  });

  it("creates idx_model_aliases_target index", () => {
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_model_aliases_target'").get();
    expect(idx).toBeDefined();
  });

  it("adds requested_model column to request_logs", () => {
    const cols = db.prepare("PRAGMA table_info(request_logs)").all() as Array<{ name: string }>;
    expect(cols.map(c => c.name)).toContain("requested_model");
  });

  it("FK cascades when upstream model is deleted", () => {
    db.prepare(`INSERT INTO models (name, upstream_model, source) VALUES ('m1', 'm1-up', 'manual')`).run();
    db.prepare(`INSERT INTO model_aliases (alias_name, upstream_model) VALUES ('a1', 'm1-up')`).run();
    db.prepare(`DELETE FROM models WHERE name = 'm1'`).run();
    const row = db.prepare(`SELECT * FROM model_aliases WHERE alias_name = 'a1'`).get();
    expect(row).toBeUndefined();
  });

  it("is idempotent on re-run (migrate twice)", () => {
    const userVersionBefore = Number(db.pragma("user_version", { simple: true }));
    migrate(db);
    const userVersionAfter = Number(db.pragma("user_version", { simple: true }));
    expect(userVersionAfter).toBe(userVersionBefore);
  });
});
