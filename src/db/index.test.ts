import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "./index.js";

let tmp: string;
let prevPath: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "router-test-"));
  prevPath = process.env.ROUTER_DB_PATH;
  process.env.ROUTER_DB_PATH = join(tmp, "test.db");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  if (prevPath === undefined) delete process.env.ROUTER_DB_PATH;
  else process.env.ROUTER_DB_PATH = prevPath;
});

describe("openDb", () => {
  it("creates expected tables after all migrations", () => {
    const db = openDb();
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain("accounts");
    expect(names).toContain("account_model_locks");
    expect(names).toContain("client_keys");
    expect(names).toContain("request_logs");
    expect(names).toContain("quota_snapshots");
    expect(names).toContain("models");
    expect(names).toContain("settings");
  });

  it("seeds default settings rows", () => {
    const db = openDb();
    const rows = db.prepare(`SELECT key FROM settings ORDER BY key`).all() as { key: string }[];
    const keys = rows.map(r => r.key);
    expect(keys).toContain("rtk");
    expect(keys).toContain("caveman");
    expect(keys).toContain("caching");
    expect(keys).toContain("transport");
    expect(keys).toContain("build");
  });

  it("seeds 11 default MiniMax models", () => {
    const db = openDb();
    const rows = db.prepare(`SELECT name FROM models ORDER BY name`).all() as { name: string }[];
    const names = rows.map(r => r.name);
    expect(names).toContain("MiniMax-M3");
    expect(names).toContain("MiniMax-M3-thinking");
    expect(names).toContain("MiniMax-M2.7");
    expect(names).toContain("MiniMax-M2.7-thinking");
    expect(names).toContain("MiniMax-M2.7-highspeed");
    expect(names).toContain("MiniMax-M2.5");
    expect(names).toContain("MiniMax-M2.5-highspeed");
    expect(names).toContain("MiniMax-M2.1");
    expect(names).toContain("MiniMax-M2.1-highspeed");
    expect(names).toContain("MiniMax-M2");
    expect(names).toContain("MiniMax-M2-her");
  });
});