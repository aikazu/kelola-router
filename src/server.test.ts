import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { app, resetDb } from "./server.js";
import { openDb } from "./db/index.js";
import { createClientKey } from "./db/repos/client_keys.js";
import { createAccount } from "./db/repos/accounts.js";
import { clearCache } from "./db/repos/settings.js";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

afterEach(() => { vi.restoreAllMocks(); });

describe("GET /health", () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "h-")), "t.db");
    resetDb();
  });

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

  it("401 when invalid client key", async () => {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer rk_invalid", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M3", messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(401);
  });

  it("503 when no upstream accounts", async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: "lonely", key: "rk_lonely" });
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${ck.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M3", messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(503);
  });

  it("uses account api_key when account present", async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: "u", key: "rk_test" });
    createAccount(db, { id: "acc_x", label: "L", credit_type: "payg", api_key: "mm_real_key" });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"choices":[{"message":{"content":"x"}}]}', { status: 200 }),
    );
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${ck.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M3", messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer mm_real_key");
  });

  it("isolates logs by client key: two different keys produce separate log rows", async () => {
    const db = openDb();
    const ck1 = createClientKey(db, { label: "app1", key: "rk_1" });
    const ck2 = createClientKey(db, { label: "app2", key: "rk_2" });
    createAccount(db, { id: "acc_i", label: "L", credit_type: "payg", api_key: "k" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response('{"choices":[{"message":{"content":"x"}}]}', { status: 200 }),
    );
    for (const ck of [ck1, ck2]) {
      const res = await app.request(new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${ck.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "MiniMax-M3", messages: [{ role: "user", content: "hi" }] }),
      }));
      expect(res.status, `request for ${ck.label}`).toBe(200);
    }
    const logs = db.prepare(`SELECT client_key_id, COUNT(*) as n FROM request_logs GROUP BY client_key_id`).all() as { client_key_id: number; n: number }[];
    expect(logs).toEqual([
      { client_key_id: ck1.id, n: 1 },
      { client_key_id: ck2.id, n: 1 },
    ]);
  });
});

describe("POST /admin/models/fetch", () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "am-")), "t.db");
    resetDb();
  });

  it("503 when admin key not configured", async () => {
    const res = await app.request("/admin/models/fetch", { method: "POST" });
    expect(res.status).toBe(503);
  });

  it("401 when admin key invalid", async () => {
    process.env.ROUTER_ADMIN_KEY = "ak_test";
    const res = await app.request("/admin/models/fetch", {
      method: "POST",
      headers: { "x-admin-key": "wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("fetches from first active account and merges", async () => {
    process.env.ROUTER_ADMIN_KEY = "ak_test";
    const db = openDb();
    createAccount(db, { id: "acc_f", label: "F", credit_type: "payg", api_key: "kk" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "MiniMax-M3" }, { id: "MiniMax-newly" }] }), { status: 200 }),
    );
    const res = await app.request("/admin/models/fetch", {
      method: "POST",
      headers: { "x-admin-key": "ak_test" },
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
    const ck = createClientKey(db, { label: "u", key: "rk_t" });
    createAccount(db, { id: "acc_z", label: "L", credit_type: "payg", api_key: "kk" });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"choices":[{"message":{"content":"x"}}]}', { status: 200 }),
    );
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${ck.key}`, "Content-Type": "application/json" },
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
    const ck = createClientKey(db, { label: "u", key: "rk_t" });
    createAccount(db, { id: "acc_y", label: "L", credit_type: "payg", api_key: "kk" });
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${ck.key}`, "Content-Type": "application/json" },
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

  it("logs non-stream request with cost + client_key_id", async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: "u", key: "rk_log" });
    createAccount(db, { id: "a1", label: "L", credit_type: "payg", api_key: "kk" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        id: "x", model: "MiniMax-M2.7",
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }), { status: 200 }),
    );
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${ck.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M2.7", messages: [{ role: "user", content: "hi" }] }),
    });
    await app.request(req);
    const logs = db.prepare(`SELECT * FROM request_logs`).all() as any[];
    expect(logs.length).toBe(1);
    expect(logs[0].prompt_tokens).toBe(100);
    expect(logs[0].completion_tokens).toBe(50);
    expect(logs[0].cost_usd).toBeGreaterThan(0);
    expect(logs[0].client_key_id).toBe(ck.id);
  });

  it("logs stream request with usage extracted from final SSE chunk", async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: "u", key: "rk_stream" });
    createAccount(db, { id: "a1", label: "L", credit_type: "payg", api_key: "kk" });
    const sse = [
      `data: {"choices":[{"delta":{"content":"hi"}}]}\n\n`,
      `data: {"choices":[],"usage":{"prompt_tokens":42,"completion_tokens":7,"total_tokens":49}}\n\n`,
      `data: [DONE]\n\n`,
    ].join("");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${ck.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M2.7", stream: true, messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    await res.text();
    await new Promise(r => setTimeout(r, 10));
    const logs = db.prepare(`SELECT * FROM request_logs WHERE stream = 1`).all() as any[];
    expect(logs.length).toBe(1);
    expect(logs[0].prompt_tokens).toBe(42);
    expect(logs[0].completion_tokens).toBe(7);
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
    const ck = createClientKey(db, { label: "u", key: "rk_aug" });
    createAccount(db, { id: "acc_a", label: "L", credit_type: "payg", api_key: "kk" });
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'caveman'`).run('{"level":"terse"}');
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"content":[{"type":"text","text":"x"}]}', { status: 200 }),
    );
    const req = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { Authorization: `Bearer ${ck.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M3", max_tokens: 100, system: "you are helpful", messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    const sent = JSON.parse((spy.mock.calls as any[])[0][1].body as string) as any;
    expect(sent.system[0].text).toContain("Be concise");
  });

  it("caching=autoBreakpoints: Anthropic request gets cache marker", async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: "u", key: "rk_cache" });
    createAccount(db, { id: "acc_b", label: "L", credit_type: "payg", api_key: "kk" });
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'caching'`).run(JSON.stringify({ autoBreakpoints: true, respectCallerMarkers: true }));
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"content":[{"type":"text","text":"x"}]}', { status: 200 }),
    );
    const req = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { Authorization: `Bearer ${ck.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M3", max_tokens: 100, system: "you are helpful", messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    const sent = JSON.parse((spy.mock.calls as any[])[0][1].body as string) as any;
    expect(sent.system[0].cache_control).toEqual({ type: "ephemeral" });
  });
});

describe("dashboard pages", () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "dash-")), "t.db");
    resetDb();
    process.env.ROUTER_ADMIN_KEY = "ak_dashboard";
  });

  it("all pages render for admin", async () => {
    const db = openDb();
    createAccount(db, { id: "a1", label: "L", credit_type: "payg", api_key: "k" });
    const adminHdr = { "x-admin-key": "ak_dashboard" };
    for (const path of ["/admin", "/admin/usage", "/admin/accounts", "/admin/models", "/admin/quota", "/admin/settings", "/admin/client-keys"]) {
      const res = await app.request(path, { headers: adminHdr });
      expect(res.status, `path ${path}`).toBe(200);
      const html = await res.text();
      expect(html).toContain("<!DOCTYPE html>");
    }
  });

  it("usage page filters by client_key", async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: "u", key: "rk_u" });
    createAccount(db, { id: "a1", label: "L", credit_type: "payg", api_key: "k" });
    const res = await app.request(`/admin/usage?client_key=${ck.id}`, {
      headers: { "x-admin-key": "ak_dashboard" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("u"); // label appears
  });
});
