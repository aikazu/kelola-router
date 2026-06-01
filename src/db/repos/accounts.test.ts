import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../index.js";
import {
  createAccount, getAccount, listAccounts, updateAccount, getAccountByApiKey,
} from "./accounts.js";

let db: ReturnType<typeof openDb>;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "a-")), "t.db");
  db = openDb();
});

describe("accounts repo", () => {
  it("createAccount stores required fields", () => {
    const a = createAccount(db, {
      id: "acc_test1",
      label: "PAYG main",
      credit_type: "payg",
      api_key: "mm_x",
    });
    expect(a.id).toBe("acc_test1");
    expect(a.label).toBe("PAYG main");
  });

  it("getAccount returns account by id", () => {
    createAccount(db, { id: "acc_a", label: "L", credit_type: "payg", api_key: "k1" });
    const got = getAccount(db, "acc_a");
    expect(got?.label).toBe("L");
  });

  it("getAccountByApiKey returns account by api_key", () => {
    createAccount(db, { id: "acc_b", label: "B", credit_type: "payg", api_key: "mm_unique" });
    const got = getAccountByApiKey(db, "mm_unique");
    expect(got?.id).toBe("acc_b");
  });

  it("listAccounts returns all accounts ordered by created_at", () => {
    createAccount(db, { id: "acc_1", label: "A", credit_type: "payg", api_key: "k1" });
    createAccount(db, { id: "acc_2", label: "B", credit_type: "token-plan", api_key: "k2" });
    const list = listAccounts(db);
    expect(list.map(a => a.id)).toEqual(["acc_1", "acc_2"]);
  });

  it("updateAccount patches fields", () => {
    createAccount(db, { id: "acc_u", label: "L", credit_type: "payg", api_key: "k" });
    updateAccount(db, "acc_u", { rate_limited_until: "2099-01-01T00:00:00Z", backoff_level: 3 });
    const got = getAccount(db, "acc_u");
    expect(got?.backoff_level).toBe(3);
    expect(got?.rate_limited_until).toBe("2099-01-01T00:00:00Z");
  });
});
