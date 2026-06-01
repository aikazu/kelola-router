import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { app, resetDb } from "../../src/server.js";
import { openDb } from "../../src/db/index.js";
import { clearCache as clearSettingsCache } from "../../src/db/repos/settings.js";
import { hashPassword } from "../../src/auth/password.js";
import { getAccount, createAccount } from "../../src/db/repos/accounts.js";

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "auth-")), "t.db");
  resetDb();
  clearSettingsCache();
});

describe("POST /login", () => {
  it("sets session cookie + redirects to /admin when password correct", async () => {
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(JSON.stringify(hashPassword("hunter2")));

    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=hunter2",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("kelola_session=");
    expect(cookie).toContain("HttpOnly");
  });

  it("returns 401 login page with error when password wrong", async () => {
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(JSON.stringify(hashPassword("hunter2")));

    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=wrong",
    });
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toContain("Wrong password");
  });

  it("redirects to /admin (no-op login) when no password set", async () => {
    const res = await app.request("/login", { method: "POST" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin");
  });
});

describe("POST /logout", () => {
  it("clears the session cookie + redirects home", async () => {
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(JSON.stringify(hashPassword("x")));

    const login = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=x",
    });
    const setCookie = login.headers.get("set-cookie") ?? "";
    const sid = /kelola_session=([^;]+)/.exec(setCookie)?.[1];
    expect(sid).toBeTruthy();

    const logout = await app.request("/logout", {
      method: "POST",
      headers: { Cookie: `kelola_session=${sid}` },
    });
    expect(logout.status).toBe(302);
    expect(logout.headers.get("location")).toBe("/");
    const cleared = logout.headers.get("set-cookie") ?? "";
    expect(cleared).toMatch(/kelola_session=;/);
  });
});

describe("/admin/accounts actions", () => {
  it("POST /admin/accounts/:id/enable sets enabled=1", async () => {
    const db = openDb();
    createAccount(db, { id: "acc_e", label: "L", credit_type: "payg", api_key: "k" });
    db.prepare(`UPDATE accounts SET enabled = 0 WHERE id = 'acc_e'`).run();
    const res = await app.request("/admin/accounts/acc_e/enable", { method: "POST" });
    expect(res.status).toBe(302);
    expect(getAccount(db, "acc_e")?.enabled).toBe(1);
  });

  it("POST /admin/accounts/:id/disable sets enabled=0", async () => {
    const db = openDb();
    createAccount(db, { id: "acc_d", label: "L", credit_type: "payg", api_key: "k" });
    const res = await app.request("/admin/accounts/acc_d/disable", { method: "POST" });
    expect(res.status).toBe(302);
    expect(getAccount(db, "acc_d")?.enabled).toBe(0);
  });

  it("POST /admin/accounts/:id/delete removes the account", async () => {
    const db = openDb();
    createAccount(db, { id: "acc_x", label: "L", credit_type: "payg", api_key: "k" });
    const res = await app.request("/admin/accounts/acc_x/delete", { method: "POST" });
    expect(res.status).toBe(302);
    expect(getAccount(db, "acc_x")).toBeNull();
  });
});
