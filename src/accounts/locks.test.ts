import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../db/index.js";
import { setModelLock, getModelLock, clearExpiredModelLocks } from "./locks.js";
import { createAccount } from "../db/repos/accounts.js";

let db: ReturnType<typeof openDb>;
let accountId: string;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "locks-")), "t.db");
  db = openDb();
  const a = createAccount(db, { id: "acc_1", label: "L", credit_type: "payg", api_key: "kk" });
  accountId = a.id;
});

describe("setModelLock + getModelLock", () => {
  it("stores lock under (accountId, model) and reads it back", () => {
    setModelLock(db, accountId, "MiniMax-M2.7", 60_000);
    const lock = getModelLock(db, accountId, "MiniMax-M2.7");
    expect(lock).toBeDefined();
    expect(lock?.accountId).toBe(accountId);
    expect(lock?.model).toBe("MiniMax-M2.7");
    expect(new Date(lock!.lockedUntil).getTime()).toBeGreaterThan(Date.now());
  });

  it("upserts: re-setting extends lockedUntil", () => {
    setModelLock(db, accountId, "M", 1000);
    const first = new Date(getModelLock(db, accountId, "M")!.lockedUntil).getTime();
    setModelLock(db, accountId, "M", 60_000);
    const second = new Date(getModelLock(db, accountId, "M")!.lockedUntil).getTime();
    expect(second).toBeGreaterThan(first);
  });

  it("returns undefined when no lock exists", () => {
    expect(getModelLock(db, accountId, "nope")).toBeUndefined();
  });
});

describe("clearExpiredModelLocks", () => {
  it("removes expired rows, keeps active ones", () => {
    setModelLock(db, accountId, "old", -1000);
    setModelLock(db, accountId, "new", 60_000);
    clearExpiredModelLocks(db);
    expect(getModelLock(db, accountId, "old")).toBeUndefined();
    expect(getModelLock(db, accountId, "new")).toBeDefined();
  });
});
