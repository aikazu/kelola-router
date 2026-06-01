import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../index.js";
import { createUser } from "./users.js";
import { createAccount } from "./accounts.js";
import { insertRequestLog, recentLogs, aggregateUsage, cleanupOldLogs } from "./requestLogs.js";

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "rl-")), "t.db");
});

describe("requestLogs repo", () => {
  it("insertRequestLog + recentLogs", () => {
    const db = openDb();
    const u = createUser(db, "u");
    createAccount(db, { id: "a", user_id: u.id, label: "L", credit_type: "payg", api_key: "k" });
    insertRequestLog(db, {
      user_id: u.id, account_id: "a", model: "MiniMax-M3", endpoint: "/v1/messages", format: "anthropic",
      prompt_tokens: 100, completion_tokens: 50, cache_creation_tokens: 0, cache_read_tokens: 0, total_tokens: 150,
      cost_usd: 0.0003, latency_ms: 500, status_code: 200, stream: 0, rtk_bytes_saved: 0,
    });
    const logs = recentLogs(db, u.id, 10);
    expect(logs.length).toBe(1);
    expect(logs[0].model).toBe("MiniMax-M3");
  });

  it("aggregateUsage sums cost + tokens by model", () => {
    const db = openDb();
    const u = createUser(db, "u");
    createAccount(db, { id: "a", user_id: u.id, label: "L", credit_type: "payg", api_key: "k" });
    insertRequestLog(db, { user_id: u.id, account_id: "a", model: "MiniMax-M3", endpoint: "/v1/messages", format: "anthropic", prompt_tokens: 100, completion_tokens: 50, cache_creation_tokens: 0, cache_read_tokens: 0, total_tokens: 150, cost_usd: 0.5, latency_ms: 500, status_code: 200, stream: 0, rtk_bytes_saved: 0 });
    insertRequestLog(db, { user_id: u.id, account_id: "a", model: "MiniMax-M3", endpoint: "/v1/messages", format: "anthropic", prompt_tokens: 100, completion_tokens: 50, cache_creation_tokens: 0, cache_read_tokens: 0, total_tokens: 150, cost_usd: 0.7, latency_ms: 500, status_code: 200, stream: 0, rtk_bytes_saved: 0 });
    insertRequestLog(db, { user_id: u.id, account_id: "a", model: "MiniMax-M2.7", endpoint: "/v1/messages", format: "anthropic", prompt_tokens: 100, completion_tokens: 50, cache_creation_tokens: 0, cache_read_tokens: 0, total_tokens: 150, cost_usd: 0.2, latency_ms: 500, status_code: 200, stream: 0, rtk_bytes_saved: 0 });
    const agg = aggregateUsage(db, u.id, 7);
    expect(agg.total_cost).toBe(1.4);
    expect(agg.total_requests).toBe(3);
    expect(agg.by_model.length).toBe(2);
    expect(agg.by_model.find(m => m.model === "MiniMax-M3")?.cost).toBe(1.2);
  });

  it("cleanupOldLogs deletes > 90 days", () => {
    const db = openDb();
    const u = createUser(db, "u");
    createAccount(db, { id: "a", user_id: u.id, label: "L", credit_type: "payg", api_key: "k" });
    insertRequestLog(db, { user_id: u.id, account_id: "a", model: "X", endpoint: "/v1/x", format: "openai", prompt_tokens: 1, completion_tokens: 1, cache_creation_tokens: 0, cache_read_tokens: 0, total_tokens: 2, cost_usd: 0, latency_ms: 1, status_code: 200, stream: 0, rtk_bytes_saved: 0 });
    db.prepare(`UPDATE request_logs SET created_at = '2000-01-01 00:00:00' WHERE id = 1`).run();
    cleanupOldLogs(db, 90);
    expect(recentLogs(db, u.id, 100).length).toBe(0);
  });
});