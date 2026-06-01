import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { app, resetDb } from "./server.js";
import { openDb } from "./db/index.js";
import { createUser } from "./db/repos/users.js";
import { createAccount } from "./db/repos/accounts.js";
import { clearCache } from "./db/repos/settings.js";
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

describe("POST /admin/models/fetch", () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "am-")), "t.db");
    resetDb();
  });

  it("requires admin key", async () => {
    const db = openDb();
    const u = createUser(db, "u");
    const res = await app.request("/admin/models/fetch", {
      method: "POST",
      headers: { Authorization: `Bearer ${u.api_key}` },
    });
    expect(res.status).toBe(403);
  });

  it("fetches from first active account and merges", async () => {
    const db = openDb();
    const u = createUser(db, "u");
    createAccount(db, { id: "acc_f", user_id: u.id, label: "F", credit_type: "payg", api_key: "kk" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "MiniMax-M3" }, { id: "MiniMax-newly" }] }), { status: 200 }),
    );
    const res = await app.request("/admin/models/fetch", {
      method: "POST",
      headers: { Authorization: `Bearer ${u.admin_key}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.added).toBe(1);
  });
});

describe("model resolution in proxy", () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "mr-")), "t.db");
    resetDb();
  });

  it("rewrites MiniMax-M3-thinking to upstream MiniMax-M3 with thinking block", async () => {
    const db = openDb();
    const u = createUser(db, "u");
    createAccount(db, { id: "acc_z", user_id: u.id, label: "L", credit_type: "payg", api_key: "kk" });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"choices":[{"message":{"content":"x"}}]}', { status: 200 }),
    );
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${u.api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M3-thinking", messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    const sentBody = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(sentBody.model).toBe("MiniMax-M3");
    expect(sentBody.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
  });

  it("400 on unknown model", async () => {
    const db = openDb();
    const u = createUser(db, "u");
    createAccount(db, { id: "acc_y", user_id: u.id, label: "L", credit_type: "payg", api_key: "kk" });
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${u.api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "totally-fake", messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(400);
  });
});

describe("request logging", () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "rl-")), "t.db");
    resetDb();
  });

  it("logs non-stream request with cost", async () => {
    const db = openDb();
    const u = createUser(db, "u");
    createAccount(db, { id: "a1", user_id: u.id, label: "L", credit_type: "payg", api_key: "kk" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        id: "x", model: "MiniMax-M2.7",
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }), { status: 200 }),
    );
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${u.api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M2.7", messages: [{ role: "user", content: "hi" }] }),
    });
    await app.request(req);
    const logs = db.prepare(`SELECT * FROM request_logs`).all() as any[];
    expect(logs.length).toBe(1);
    expect(logs[0].prompt_tokens).toBe(100);
    expect(logs[0].completion_tokens).toBe(50);
    expect(logs[0].cost_usd).toBeGreaterThan(0);
  });
});

describe("augmentation in proxy", () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "aug-")), "t.db");
    resetDb();
    clearCache();
  });

  it("caveman=terse: Anthropic request gets caveman injected into system", async () => {
    const db = openDb();
    const u = createUser(db, "u");
    createAccount(db, { id: "acc_a", user_id: u.id, label: "L", credit_type: "payg", api_key: "kk" });
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'caveman'`).run('{"level":"terse"}');
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"content":[{"type":"text","text":"x"}]}', { status: 200 }),
    );
    const req = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { Authorization: `Bearer ${u.api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M3", max_tokens: 100, system: "you are helpful", messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    const sent = JSON.parse((spy.mock.calls as any[])[0][1].body as string) as any;
    expect(sent.system[0].text).toContain("Be concise");
  });

  it("caching=autoBreakpoints: Anthropic request gets cache marker", async () => {
    const db = openDb();
    const u = createUser(db, "u");
    createAccount(db, { id: "acc_b", user_id: u.id, label: "L", credit_type: "payg", api_key: "kk" });
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'caching'`).run(JSON.stringify({ autoBreakpoints: true, respectCallerMarkers: true }));
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"content":[{"type":"text","text":"x"}]}', { status: 200 }),
    );
    const req = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { Authorization: `Bearer ${u.api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M3", max_tokens: 100, system: "you are helpful", messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    const sent = JSON.parse((spy.mock.calls as any[])[0][1].body as string) as any;
    expect(sent.system[0].cache_control).toEqual({ type: "ephemeral" });
  });
});