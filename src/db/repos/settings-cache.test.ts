import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../index.js";
import { setSetting, getSetting } from "./settings.js";
import type Database from "better-sqlite3";

let db: Database.Database;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sc-"));
  process.env.ROUTER_DB_PATH = join(dir, "t.db");
  db = openDb();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true });
});

describe("settings cache invalidation", () => {
  it("setSetting invalidates getSetting cache", () => {
    expect(getSetting(db, "k")).toBeNull();
    setSetting(db, "k", "v1");
    expect(getSetting(db, "k")).toBe("v1");
    setSetting(db, "k", "v2");
    expect(getSetting(db, "k")).toBe("v2");
  });

  it("setSetting(null) makes getSetting return null", () => {
    setSetting(db, "k", "v1");
    expect(getSetting(db, "k")).toBe("v1");
    setSetting(db, "k", null);
    expect(getSetting(db, "k")).toBeNull();
  });

  it("cache is per-db (different dbs see different values)", () => {
    setSetting(db, "k", "v_db1");
    // Open a second db on a different path
    const dir2 = mkdtempSync(join(tmpdir(), "sc2-"));
    process.env.ROUTER_DB_PATH = join(dir2, "t.db");
    const db2 = openDb();
    expect(getSetting(db2, "k")).toBeNull();
    setSetting(db2, "k", "v_db2");
    expect(getSetting(db2, "k")).toBe("v_db2");
    expect(getSetting(db, "k")).toBe("v_db1"); // unaffected
    db2.close();
    rmSync(dir2, { recursive: true });
  });
});
