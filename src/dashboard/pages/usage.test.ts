import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../../db/index.js";
import { createClientKey } from "../../db/repos/client_keys.js";
import { createAccount } from "../../db/repos/accounts.js";
import { insertRequestLog } from "../../db/repos/requestLogs.js";
import { renderUsage } from "./usage.js";

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "usage-")), "t.db");
});

describe("renderUsage", () => {
  it("shows account label not just ID", () => {
    const db = openDb();
    const ck = createClientKey(db, { label: "my-app", key: "rk_1" });
    const a = createAccount(db, { id: "acc_z", label: "PAYG main", credit_type: "payg", api_key: "k" });
    insertRequestLog(db, {
      client_key_id: ck.id, account_id: a.id, model: "MiniMax-M3", endpoint: "/v1/x", format: "openai",
      prompt_tokens: 1, completion_tokens: 1, cache_creation_tokens: 0, cache_read_tokens: 0, total_tokens: 2,
      cost_usd: 0.01, latency_ms: 100, status_code: 200, stream: 0, rtk_bytes_saved: 0,
    });
    const html = renderUsage(db);
    expect(html).toContain("PAYG main");
  });
});
