import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Hono } from "hono";
import { openDb } from "./db/index.js";
import { createUser } from "./db/repos/users.js";
import { requireApiKey, requireAdmin } from "./auth.js";

let db: ReturnType<typeof openDb>;
let user: { api_key: string; admin_key: string };

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "auth-")), "t.db");
  db = openDb();
  const created = createUser(db, "tester");
  user = { api_key: created.api_key, admin_key: created.admin_key! };
});

function buildApp() {
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("db", db); await next(); });
  app.get("/p", requireApiKey, (c) => c.json({ user: c.get("user")!.name }));
  app.get("/a", requireAdmin, (c) => c.json({ user: c.get("user")!.name }));
  return app;
}

describe("requireApiKey", () => {
  it("401 when no header", async () => {
    const res = await buildApp().request("/p");
    expect(res.status).toBe(401);
  });

  it("401 when bad key", async () => {
    const res = await buildApp().request("/p", { headers: { Authorization: "Bearer rk_wrong" } });
    expect(res.status).toBe(401);
  });

  it("200 with valid Bearer", async () => {
    const res = await buildApp().request("/p", { headers: { Authorization: `Bearer ${user.api_key}` } });
    expect(res.status).toBe(200);
    expect((await res.json()).user).toBe("tester");
  });

  it("200 with x-api-key header (Anthropic style)", async () => {
    const res = await buildApp().request("/p", { headers: { "x-api-key": user.api_key } });
    expect(res.status).toBe(200);
  });
});

describe("requireAdmin", () => {
  it("403 when proxy api_key (not admin)", async () => {
    const res = await buildApp().request("/a", { headers: { Authorization: `Bearer ${user.api_key}` } });
    expect(res.status).toBe(403);
  });

  it("200 with admin_key", async () => {
    const res = await buildApp().request("/a", { headers: { Authorization: `Bearer ${user.admin_key}` } });
    expect(res.status).toBe(200);
  });

  it("200 with x-admin-key header", async () => {
    const res = await buildApp().request("/a", { headers: { "x-admin-key": user.admin_key } });
    expect(res.status).toBe(200);
  });
});
