import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";
import { migrate } from "../../../src/db/migrations/index.js";
import { adminApi } from "../../../src/api/admin/index.js";
import { setPassword } from "../../../src/auth/password.js";
import { createSession } from "../../../src/auth/session.js";
import { SESSION_COOKIE } from "../../../src/auth.js";

let db: Database.Database;
let dir: string;
let app: Hono;
let sessionCookie: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "csrf-"));
  db = new Database(join(dir, "t.db"));
  db.pragma("foreign_keys = ON");
  migrate(db);
  setPassword(db, "testpass");
  const sess = createSession(db);
  sessionCookie = `${SESSION_COOKIE}=${sess.id}`;
  app = new Hono();
  app.use("*", async (c, next) => { c.set("db", db); await next(); });
  app.route("/api", adminApi(db));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true });
  vi.restoreAllMocks();
});

describe("CSRF on /api/admin/*", () => {
  it("rejects cross-origin POST to /api/admin/* with 403", async () => {
    const res = await app.request("/api/admin/accounts/acc_x/disable", {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        origin: "https://evil.example",
        host: "localhost:20137",
        "content-type": "application/json",
      },
      body: "",
    });
    expect(res.status).toBe(403);
  });

  it("allows same-origin POST", async () => {
    const res = await app.request("/api/admin/accounts/acc_x/disable", {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        origin: "http://localhost:20137",
        host: "localhost:20137",
        "content-type": "application/json",
      },
      body: "",
    });
    expect(res.status).not.toBe(403);
  });

  it("allows POST without Origin header (curl/server-to-server)", async () => {
    const res = await app.request("/api/admin/accounts/acc_x/disable", {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        host: "localhost:20137",
        "content-type": "application/json",
      },
      body: "",
    });
    expect(res.status).not.toBe(403);
  });

  it("does NOT block same-origin GET even with mismatched origin (GET exempt)", async () => {
    const res = await app.request("/api/admin/accounts", {
      method: "GET",
      headers: {
        cookie: sessionCookie,
        origin: "https://other.example",
        host: "localhost:20137",
      },
    });
    expect(res.status).not.toBe(403);
  });
});
