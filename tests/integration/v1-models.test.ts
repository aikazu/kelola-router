import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { app, resetDb } from "../../src/server.js";
import { openDb } from "../../src/db/index.js";
import { createClientKey } from "../../src/db/repos/client_keys.js";
import { createAccount } from "../../src/db/repos/accounts.js";
import { upsertModel } from "../../src/db/repos/models.js";
import { setSetting, clearCache } from "../../src/db/repos/settings.js";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

afterEach(() => { vi.restoreAllMocks(); });

describe("GET /v1/models", () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "mdl-")), "t.db");
    resetDb();
    clearCache();
  });

  it("returns model list from upstream without requiring body.model", async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: "t", key: "rk_mdl" });
    createAccount(db, { id: "acc_mdl", label: "a1", credit_type: "payg", api_key: "mm_test" });
    upsertModel(db, { name: "MiniMax-M2.7", upstream_model: "MiniMax-M2.7" });
    setSetting(db, "transport", { relay: null, proxy: null });
    clearCache();

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(
      JSON.stringify({ data: [{ id: "MiniMax-M2.7" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));

    const req = new Request("http://localhost/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${ck.key}` },
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: string }> };
    expect(body.data[0].id).toBe("MiniMax-M2.7");
  });

  it("requires API key", async () => {
    const req = new Request("http://localhost/v1/models", { method: "GET" });
    const res = await app.request(req);
    expect(res.status).toBe(401);
  });

  it("returns 503 when no upstream accounts configured", async () => {
    const db = openDb();
    createClientKey(db, { label: "t", key: "rk_mdl2" });
    const req = new Request("http://localhost/v1/models", { method: "GET", headers: { Authorization: "Bearer rk_mdl2" } });
    const res = await app.request(req);
    expect(res.status).toBe(503);
  });
});
