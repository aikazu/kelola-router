import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../index.js";
import { createUser } from "./users.js";
import {
  createAccount, getAccount, listAccountsByUser, updateAccount,
  setModelLock, getModelLock, clearExpiredModelLocks,
} from "./accounts.js";

let db: ReturnType<typeof openDb>;
let userId: number;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "a-")), "t.db");
  db = openDb();
  userId = createUser(db, "u").id;
});

describe("accounts repo", () => {
  it("createAccount stores required fields", () => {
    const a = createAccount(db, {
      id: "acc_test1",
      user_id: userId,
      label: "PAYG main",
      credit_type: "payg",
      api_key: "mm_x",
    });
    expect(a.id).toBe("acc_test1");
  });

  it("getAccount returns account by id", () => {
    createAccount(db, { id: "acc_a", user_id: userId, label: "L", credit_type: "payg", api_key: "k" });
    const got = getAccount(db, "acc_a");
    expect(got?.label).toBe("L");
  });

  it("listAccountsByUser returns user's accounts ordered by position", () => {
    createAccount(db, { id: "acc_1", user_id: userId, label: "A", credit_type: "payg", api_key: "k", position: 0 });
    createAccount(db, { id: "acc_2", user_id: userId, label: "B", credit_type: "token-plan", api_key: "k", position: 1 });
    const list = listAccountsByUser(db, userId);
    expect(list.map(a => a.id)).toEqual(["acc_1", "acc_2"]);
  });

  it("updateAccount patches fields", () => {
    createAccount(db, { id: "acc_u", user_id: userId, label: "L", credit_type: "payg", api_key: "k" });
    updateAccount(db, "acc_u", { rate_limited_until: "2099-01-01T00:00:00Z", backoff_level: 3 });
    const got = getAccount(db, "acc_u");
    expect(got?.backoff_level).toBe(3);
    expect(got?.rate_limited_until).toBe("2099-01-01T00:00:00Z");
  });

  it("setModelLock + getModelLock roundtrip", () => {
    createAccount(db, { id: "acc_ml", user_id: userId, label: "L", credit_type: "payg", api_key: "k" });
    setModelLock(db, "acc_ml", "MiniMax-M3", 60_000);
    const lock = getModelLock(db, "acc_ml", "MiniMax-M3");
    expect(lock).toBeTruthy();
    expect(new Date(lock!.locked_until).getTime()).toBeGreaterThan(Date.now());
  });

  it("clearExpiredModelLocks removes past locks", () => {
    createAccount(db, { id: "acc_cl", user_id: userId, label: "L", credit_type: "payg", api_key: "k" });
    db.prepare(`INSERT INTO account_model_locks (account_id, model, locked_until) VALUES (?, ?, ?)`)
      .run("acc_cl", "old-model", "2000-01-01T00:00:00Z");
    clearExpiredModelLocks(db);
    expect(getModelLock(db, "acc_cl", "old-model")).toBeUndefined();
  });
});
