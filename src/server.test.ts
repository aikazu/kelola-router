import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { app, resetDb } from "./server.js";
import { openDb } from "./db/index.js";
import { createUser } from "./db/repos/users.js";
import { createAccount } from "./db/repos/accounts.js";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

afterEach(() => { vi.restoreAllMocks(); });

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });
});

describe("handleProxy with auth + accounts", () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "ha-")), "t.db");
    resetDb();
  });

  it("401 when no auth", async () => {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M3", messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(401);
  });

  it("503 when user has no accounts", async () => {
    const db = openDb();
    const u = createUser(db, "lonely");
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${u.api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M3", messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(503);
  });

  it("uses account api_key when account present", async () => {
    const db = openDb();
    const u = createUser(db, "u");
    createAccount(db, { id: "acc_x", user_id: u.id, label: "L", credit_type: "payg", api_key: "mm_real_key" });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"choices":[{"message":{"content":"x"}}]}', { status: 200 }),
    );
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${u.api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M3", messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer mm_real_key");
  });
});