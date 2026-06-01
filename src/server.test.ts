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

describe("GET / (landing page)", () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "root-")), "t.db");
    resetDb();
  });

  it("returns 200 + HTML status page when admin key missing", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("kelola-router");
    expect(html).toContain("needs setup");
    expect(html).toContain("/admin");
    expect(html).toContain("/v1/chat/completions");
    expect(html).toContain("/v1/messages");
  });

  it("shows 'ready' when admin key is configured", async () => {
    process.env.ROUTER_ADMIN_KEY = "ak_test";
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("ready");
    expect(html).toContain("Open /admin");
  });

  it("reflects current state (accounts + client keys counts)", async () => {
    const db = openDb();
    createAccount(db, { id: "a1", label: "A", credit_type: "payg", api_key: "k" });
    createAccount(db, { id: "a2", label: "B", credit_type: "payg", api_key: "k2", enabled: false });
    createClientKey(db, { label: "app1", key: "rk_1" });
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("2 (1 enabled)");
    expect(html).toContain("Active client keys</td><td>1");
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

  it("open access when no password set (local dev mode)", async () => {
    delete process.env.ROUTER_ADMIN_KEY;
    const db = openDb();
    createAccount(db, { id: "acc_open", label: "L", credit_type: "payg", api_key: "k" });
    const res = await app.request("/admin/models/fetch", { method: "POST" });
    // 400 = no upstream account matches the model list test scenario; but here
    // we set up an account. Result: 200 from /admin/models/fetch (mocked) or
    // 502 if no upstream available. Either way, NOT 401/503.
    expect([200, 502, 400]).toContain(res.status);
  });

  it("401 when password set AND env key invalid", async () => {
    process.env.ROUTER_ADMIN_KEY = "ak_test";
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`)
      .run(JSON.stringify("scrypt:16384:00:00"));
    const res = await app.request("/admin/models/fetch", {
      method: "POST",
      headers: { "x-admin-key": "wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("redirects to /login on GET when password set + no session", async () => {
    delete process.env.ROUTER_ADMIN_KEY;
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`)
      .run(JSON.stringify("scrypt:16384:00:00"));
    const res = await app.request("/admin");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
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

describe("/v1/embeddings", () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "emb-")), "t.db");
    resetDb();
  });

  it("returns 501 not implemented (MiniMax has no embeddings endpoint)", async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: "u", key: "rk_emb" });
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${ck.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M3", input: "hi" }),
    });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toContain("embeddings not supported");
  });
});

describe("cross-format proxy (OpenAI client → Anthropic upstream)", () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "xf-")), "t.db");
    resetDb();
  });

  it("transforms OpenAI tools to Anthropic when override forces anthropic upstream", async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: "u", key: "rk_xf" });
    createAccount(db, { id: "acc_xf", label: "L", credit_type: "payg", api_key: "kk" });
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('minimax', ?)`)
      .run(JSON.stringify({ upstreamFormat: "anthropic" }));
    clearCache();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const sent = JSON.parse((init as RequestInit).body as string);
      // Verify body was converted to Anthropic shape
      expect(sent.tools).toEqual([{
        name: "get_weather",
        input_schema: { type: "object", properties: { loc: { type: "string" } } },
      }]);
      expect(sent.tool_choice).toEqual({ type: "auto" });
      return new Response(JSON.stringify({
        id: "x", type: "message", role: "assistant", model: "MiniMax-M3",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${ck.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "MiniMax-M3",
        messages: [{ role: "user", content: "weather in SF?" }],
        tools: [{ type: "function", function: { name: "get_weather", parameters: { type: "object", properties: { loc: { type: "string" } } } } }],
        tool_choice: "auto",
      }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Response should be converted back to OpenAI shape
    expect(body.choices[0].message.content).toBe("ok");
    expect(body.choices[0].finish_reason).toBe("stop");
  });
});

describe("OpenAI stream auto include_usage", () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "iu-")), "t.db");
    resetDb();
  });

  it("injects stream_options.include_usage=true when client omitted it", async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: "u", key: "rk_iu" });
    createAccount(db, { id: "acc_iu", label: "L", credit_type: "payg", api_key: "kk" });
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const sent = JSON.parse((init as RequestInit).body as string);
      expect(sent.stream_options).toEqual({ include_usage: true });
      return new Response('{"choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}', { status: 200 });
    });
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${ck.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M3", stream: true, messages: [{ role: "user", content: "hi" }] }),
    });
    await app.request(req);
    expect(spy).toHaveBeenCalled();
  });

  it("does NOT overwrite explicit include_usage=false", async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: "u", key: "rk_iu2" });
    createAccount(db, { id: "acc_iu2", label: "L", credit_type: "payg", api_key: "kk" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const sent = JSON.parse((init as RequestInit).body as string);
      expect(sent.stream_options.include_usage).toBe(false);
      return new Response('{"choices":[{"message":{"content":"ok"}}]}', { status: 200 });
    });
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${ck.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "MiniMax-M3", stream: true,
        stream_options: { include_usage: false },
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    await app.request(req);
  });
});
