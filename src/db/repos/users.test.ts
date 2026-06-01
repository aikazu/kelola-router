import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../index.js";
import { createUser, getUserByApiKey, getUserByAdminKey, listUsers } from "./users.js";

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "u-")), "t.db");
});

describe("users repo", () => {
  it("createUser returns id + api_key + admin_key", () => {
    const db = openDb();
    const u = createUser(db, "alice");
    expect(u.id).toBeTypeOf("number");
    expect(u.api_key).toMatch(/^rk_/);
    expect(u.admin_key).toMatch(/^ak_/);
  });

  it("getUserByApiKey returns user with accounts", () => {
    const db = openDb();
    const u = createUser(db, "bob");
    const found = getUserByApiKey(db, u.api_key);
    expect(found?.name).toBe("bob");
    expect(found?.accounts).toEqual([]);
  });

  it("getUserByAdminKey returns user", () => {
    const db = openDb();
    const u = createUser(db, "carol");
    const found = getUserByAdminKey(db, u.admin_key!);
    expect(found?.name).toBe("carol");
  });

  it("getUserByApiKey returns null on miss", () => {
    const db = openDb();
    expect(getUserByApiKey(db, "rk_nope")).toBeNull();
  });

  it("listUsers returns all users", () => {
    const db = openDb();
    createUser(db, "a");
    createUser(db, "b");
    expect(listUsers(db).length).toBe(2);
  });
});
