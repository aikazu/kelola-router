# Phase 5: v0.5 — Quota + Dashboard

> Part of [Master Plan](./2026-06-01-minimax-router.md). Requires Phase 4 done.
> Spec: `docs/spec/IMPLEMENTATION.md` §6 v0.5
> Target: 2-3h

**Goal:** Quota puller hits /v1/token_plan/remains every 5 min. SSE stream usage extraction. 5 dashboard pages (overview, usage, accounts, models, quota, settings). All admin routes work.

**Done when:** Scheduler populates quota_snapshots, stream request_logs.completion_tokens populated, /admin/overview shows cost+count, /admin/accounts allows add/disable, /admin/settings toggles caveman.

---

## Task 5.1: requestLogs repo

**Files:**
- Create: `src/db/repos/requestLogs.ts`
- Create: `src/db/repos/requestLogs.test.ts`

- [ ] **Step 1: Write failing tests**

`src/db/repos/requestLogs.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: Write `src/db/repos/requestLogs.ts`**

```ts
import type Database from "better-sqlite3";

export interface RequestLog {
  id: number;
  user_id: number;
  account_id: string | null;
  model: string;
  endpoint: string;
  format: string;
  prompt_tokens: number;
  completion_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  cost_usd: number;
  latency_ms: number;
  ttft_ms: number | null;
  status_code: number;
  base_resp_code: number | null;
  stream: number;
  relay_path: string | null;
  proxy_path: string | null;
  rtk_bytes_saved: number;
  caveman_level: string | null;
  error_message: string | null;
  created_at: string;
}

export type RequestLogInsert = Omit<RequestLog, "id" | "created_at" | "ttft_ms" | "base_resp_code" | "relay_path" | "proxy_path" | "caveman_level" | "error_message"> & {
  ttft_ms?: number | null;
  base_resp_code?: number | null;
  relay_path?: string | null;
  proxy_path?: string | null;
  caveman_level?: string | null;
  error_message?: string | null;
};

export function insertRequestLog(db: Database.Database, log: RequestLogInsert): number {
  const info = db.prepare(`
    INSERT INTO request_logs (user_id, account_id, model, endpoint, format, prompt_tokens, completion_tokens,
      cache_creation_tokens, cache_read_tokens, total_tokens, cost_usd, latency_ms, ttft_ms, status_code,
      base_resp_code, stream, relay_path, proxy_path, rtk_bytes_saved, caveman_level, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    log.user_id, log.account_id, log.model, log.endpoint, log.format,
    log.prompt_tokens, log.completion_tokens, log.cache_creation_tokens, log.cache_read_tokens, log.total_tokens,
    log.cost_usd, log.latency_ms, log.ttft_ms ?? null, log.status_code, log.base_resp_code ?? null,
    log.stream ? 1 : 0, log.relay_path ?? null, log.proxy_path ?? null, log.rtk_bytes_saved,
    log.caveman_level ?? null, log.error_message ?? null,
  );
  return info.lastInsertRowid as number;
}

export function recentLogs(db: Database.Database, userId: number, limit: number): RequestLog[] {
  return db.prepare(`SELECT * FROM request_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(userId, limit) as RequestLog[];
}

export interface UsageAggregate {
  total_cost: number;
  total_requests: number;
  total_tokens: number;
  by_model: { model: string; cost: number; requests: number }[];
}

export function aggregateUsage(db: Database.Database, userId: number, days: number): UsageAggregate {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const total = db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as cost, COUNT(*) as reqs, COALESCE(SUM(total_tokens), 0) as toks
    FROM request_logs WHERE user_id = ? AND created_at > ?
  `).get(userId, since) as { cost: number; reqs: number; toks: number };
  const byModel = db.prepare(`
    SELECT model, SUM(cost_usd) as cost, COUNT(*) as requests
    FROM request_logs WHERE user_id = ? AND created_at > ?
    GROUP BY model ORDER BY cost DESC
  `).all(userId, since) as { model: string; cost: number; requests: number }[];
  return { total_cost: total.cost, total_requests: total.reqs, total_tokens: total.toks, by_model: byModel };
}

export function cleanupOldLogs(db: Database.Database, days: number): number {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const info = db.prepare(`DELETE FROM request_logs WHERE created_at < ?`).run(cutoff);
  return info.changes;
}
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 131 tests (3 new)

- [ ] **Step 5: Commit**

```bash
git add src/db/repos/requestLogs.ts src/db/repos/requestLogs.test.ts
git commit -m "feat: requestLogs repo (insert + recent + aggregate + cleanup)"
```

---

## Task 5.2: Quota pull (parse + storage + scheduler)

**Files:**
- Create: `src/db/repos/quotaSnapshots.ts`
- Create: `src/providers/quota.ts`
- Create: `src/scheduler/quotaPull.ts`
- Create: `src/providers/quota.test.ts`
- Create: `src/scheduler/quotaPull.test.ts`

- [ ] **Step 1: Write `src/db/repos/quotaSnapshots.ts`**

```ts
import type Database from "better-sqlite3";

export interface QuotaSnapshot {
  id: number;
  account_id: string;
  source: string;
  total_count: number | null;
  remaining_count: number | null;
  used_count: number | null;
  window_type: string | null;
  window_start: string | null;
  window_end: string | null;
  raw_response: string | null;
  fetched_at: string;
}

export function insertQuotaSnapshot(db: Database.Database, s: Omit<QuotaSnapshot, "id" | "fetched_at">): number {
  const info = db.prepare(`
    INSERT INTO quota_snapshots (account_id, source, total_count, remaining_count, used_count,
      window_type, window_start, window_end, raw_response)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(s.account_id, s.source, s.total_count, s.remaining_count, s.used_count,
    s.window_type, s.window_start, s.window_end, s.raw_response);
  return info.lastInsertRowid as number;
}

export function latestQuotaByAccount(db: Database.Database, accountId: string, limit = 10): QuotaSnapshot[] {
  return db.prepare(`
    SELECT * FROM quota_snapshots WHERE account_id = ? ORDER BY fetched_at DESC LIMIT ?
  `).all(accountId, limit) as QuotaSnapshot[];
}

export function cleanupOldQuota(db: Database.Database, days: number): number {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const info = db.prepare(`DELETE FROM quota_snapshots WHERE fetched_at < ?`).run(cutoff);
  return info.changes;
}
```

- [ ] **Step 2: Write `src/providers/quota.ts`**

```ts
import type Database from "better-sqlite3";
import { insertQuotaSnapshot } from "../db/repos/quotaSnapshots.js";
import { getBaseUrl } from "./baseUrl.js";
import { buildHeaders } from "./headers.js";
import type { Account } from "../db/repos/accounts.js";

export async function pullQuota(db: Database.Database, account: Account): Promise<{ ok: boolean; error?: string }> {
  if (account.credit_type !== "token-plan") {
    return { ok: true }; // skip PAYG for now
  }

  const accountLite = { provider: "minimax" as const, baseUrl: account.base_url, apiKey: account.api_key };

  // 1. Try /v1/token_plan/remains
  try {
    const url = `${getBaseUrl(accountLite, "openai")}/v1/token_plan/remains`;
    const resp = await fetch(url, { method: "GET", headers: buildHeaders(accountLite, false, "openai") });
    if (resp.ok) {
      const data = await resp.json();
      const snapshots = parseTokenPlanRemains(data, account.id);
      for (const s of snapshots) insertQuotaSnapshot(db, { ...s, raw_response: JSON.stringify(data) });
      return { ok: true };
    }
  } catch (e: any) {
    console.warn(`[quota] token_plan pull failed for ${account.id}, falling back:`, e.message);
  }

  // 2. Fallback /v1/api/openplatform/coding_plan/remains
  try {
    const url = `${getBaseUrl(accountLite, "openai")}/v1/api/openplatform/coding_plan/remains`;
    const resp = await fetch(url, { method: "GET", headers: buildHeaders(accountLite, false, "openai") });
    if (resp.ok) {
      const data = await resp.json();
      const snapshots = parseCodingPlanRemains(data, account.id);
      for (const s of snapshots) insertQuotaSnapshot(db, { ...s, raw_response: JSON.stringify(data) });
      return { ok: true };
    }
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
  return { ok: false, error: "upstream not ok" };
}

function parseTokenPlanRemains(data: any, accountId: string) {
  return [
    {
      account_id: accountId, source: "token_plan", window_type: "5h",
      total_count: data.current_interval_total_count,
      remaining_count: data.current_interval_usage_count,
      used_count: (data.current_interval_total_count ?? 0) - (data.current_interval_usage_count ?? 0),
      window_start: data.start_time ? new Date(data.start_time).toISOString() : null,
      window_end: data.end_time ? new Date(data.end_time).toISOString() : null,
    },
    {
      account_id: accountId, source: "token_plan", window_type: "weekly",
      total_count: data.current_weekly_total_count,
      remaining_count: data.current_weekly_usage_count,
      used_count: (data.current_weekly_total_count ?? 0) - (data.current_weekly_usage_count ?? 0),
      window_start: data.weekly_start_time ? new Date(data.weekly_start_time).toISOString() : null,
      window_end: data.weekly_end_time ? new Date(data.weekly_end_time).toISOString() : null,
    },
  ];
}

function parseCodingPlanRemains(data: any, accountId: string) {
  return (data.model_remains ?? []).map((m: any) => ({
    account_id: accountId, source: "coding_plan", window_type: "5h",
    total_count: m.current_interval_total_count,
    remaining_count: m.current_interval_usage_count,
    // SEMANTIC INVERSION FIX: usage_count is REMAINING, not used (per RISKS #1)
    used_count: (m.current_interval_total_count ?? 0) - (m.current_interval_usage_count ?? 0),
    window_start: m.start_time ? new Date(m.start_time).toISOString() : null,
    window_end: m.end_time ? new Date(m.end_time).toISOString() : null,
  }));
}
```

- [ ] **Step 3: Write `src/scheduler/quotaPull.ts`**

```ts
import type Database from "better-sqlite3";
import { listAccountsByUser } from "../db/repos/accounts.js";
import { listUsers } from "../db/repos/users.js";
import { pullQuota } from "../providers/quota.js";
import { cleanupOldQuota } from "../db/repos/quotaSnapshots.js";
import { log } from "../util/log.js";

let intervalHandle: NodeJS.Timeout | null = null;

export function startQuotaPuller(db: Database.Database, intervalMs: number): void {
  if (intervalHandle) return;
  const tick = async () => {
    try {
      for (const u of listUsers(db)) {
        for (const a of listAccountsByUser(db, u.id)) {
          if (!a.enabled) continue;
          if (a.credit_type !== "token-plan") continue;
          const r = await pullQuota(db, a);
          if (!r.ok) log.warn({ account: a.id, error: r.error }, "quota pull failed");
        }
      }
      cleanupOldQuota(db, 30);
    } catch (e: any) {
      log.error({ err: e.message }, "quota tick failed");
    }
  };
  tick();
  intervalHandle = setInterval(tick, intervalMs);
  log.info({ intervalMs }, "quota puller started");
}

export function stopQuotaPuller(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
```

- [ ] **Step 4: Write failing tests**

`src/providers/quota.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../db/index.js";
import { createUser } from "../db/repos/users.js";
import { createAccount } from "../db/repos/accounts.js";
import { latestQuotaByAccount } from "../db/repos/quotaSnapshots.js";
import { pullQuota } from "./quota.js";

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "q-")), "t.db");
});

describe("pullQuota", () => {
  it("skips PAYG accounts", async () => {
    const db = openDb();
    const u = createUser(db, "u");
    const a = createAccount(db, { id: "a1", user_id: u.id, label: "L", credit_type: "payg", api_key: "k" });
    const r = await pullQuota(db, a);
    expect(r.ok).toBe(true);
    expect(latestQuotaByAccount(db, "a1").length).toBe(0);
  });

  it("pulls token_plan and computes used = total - remaining (inversion fix)", async () => {
    const db = openDb();
    const u = createUser(db, "u");
    const a = createAccount(db, { id: "a2", user_id: u.id, label: "L", credit_type: "token-plan", api_key: "k" });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        current_interval_total_count: 1500,
        current_interval_usage_count: 1349, // remaining
        start_time: Date.now() - 3_600_000,
        end_time: Date.now() + 3_600_000,
        current_weekly_total_count: 50000,
        current_weekly_usage_count: 12000,
        weekly_start_time: Date.now() - 86_400_000,
        weekly_end_time: Date.now() + 6 * 86_400_000,
      }), { status: 200 }),
    );
    const r = await pullQuota(db, a);
    expect(r.ok).toBe(true);
    const snaps = latestQuotaByAccount(db, "a2");
    expect(snaps.length).toBe(2);
    const h5 = snaps.find(s => s.window_type === "5h")!;
    expect(h5.total_count).toBe(1500);
    expect(h5.remaining_count).toBe(1349);
    expect(h5.used_count).toBe(151); // 1500 - 1349
  });

  it("falls back to coding_plan when token_plan fails", async () => {
    const db = openDb();
    const u = createUser(db, "u");
    const a = createAccount(db, { id: "a3", user_id: u.id, label: "L", credit_type: "token-plan", api_key: "k" });
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(new Response("err", { status: 500 }));
    spy.mockResolvedValueOnce(new Response(JSON.stringify({
      model_remains: [{ model_name: "MiniMax-M*", current_interval_total_count: 100, current_interval_usage_count: 80, start_time: 0, end_time: 0 }],
    }), { status: 200 }));
    const r = await pullQuota(db, a);
    expect(r.ok).toBe(true);
    expect(spy.mock.calls[1][0]).toContain("coding_plan/remains");
  });
});
```

- [ ] **Step 5: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 134 tests (3 new)

- [ ] **Step 6: Commit**

```bash
git add src/db/repos/quotaSnapshots.ts src/providers/quota.ts src/scheduler/ src/providers/quota.test.ts
git commit -m "feat: quota pull + storage + scheduler + semantic inversion fix"
```

---

## Task 5.3: SSE stream usage extraction

**Files:**
- Create: `src/streaming/extractUsage.ts`
- Create: `src/streaming/pipeWithUsage.ts`
- Create: `src/streaming/extractUsage.test.ts`

- [ ] **Step 1: Write failing test**

`src/streaming/extractUsage.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { extractUsageFromSSE } from "./extractUsage.js";

describe("extractUsageFromSSE (OpenAI)", () => {
  it("parses final chunk with usage", () => {
    const chunks = [
      `data: {"choices":[{"delta":{"content":"hi"}}]}\n\n`,
      `data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\n`,
      `data: [DONE]\n\n`,
    ];
    const r = extractUsageFromSSE(chunks.join(""), "openai");
    expect(r.usage).toEqual({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 });
  });

  it("returns null usage if no usage in any chunk", () => {
    const chunks = [`data: {"choices":[{"delta":{"content":"hi"}}]}\n\n`, `data: [DONE]\n\n`];
    const r = extractUsageFromSSE(chunks.join(""), "openai");
    expect(r.usage).toBeNull();
  });
});

describe("extractUsageFromSSE (Anthropic)", () => {
  it("parses message_delta with usage", () => {
    const chunks = [
      `event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_creation_input_tokens":10,"cache_read_input_tokens":0,"output_tokens":0}}}\n\n`,
      `event: message_delta\ndata: {"type":"message_delta","usage":{"input_tokens":100,"cache_creation_input_tokens":10,"cache_read_input_tokens":0,"output_tokens":50}}\n\n`,
      `event: message_stop\ndata: {"type":"message_stop"}\n\n`,
    ];
    const r = extractUsageFromSSE(chunks.join(""), "anthropic");
    expect(r.usage).toEqual({ prompt_tokens: 100, completion_tokens: 50, cache_creation_tokens: 10, cache_read_tokens: 0, total_tokens: 150 });
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: Write `src/streaming/extractUsage.ts`**

```ts
export interface SSEUsage {
  prompt_tokens: number;
  completion_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
}

export interface SSEParseResult {
  usage: SSEUsage | null;
  raw: string;
}

export function extractUsageFromSSE(raw: string, format: "openai" | "anthropic"): SSEParseResult {
  if (format === "openai") return extractOpenAI(raw);
  return extractAnthropic(raw);
}

function extractOpenAI(raw: string): SSEParseResult {
  let usage: SSEUsage | null = null;
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (payload === "[DONE]") continue;
    try {
      const obj = JSON.parse(payload);
      if (obj.usage) {
        usage = {
          prompt_tokens: obj.usage.prompt_tokens ?? 0,
          completion_tokens: obj.usage.completion_tokens ?? 0,
          cache_creation_tokens: 0,
          cache_read_tokens: obj.usage.prompt_tokens_details?.cached_tokens ?? 0,
          total_tokens: obj.usage.total_tokens ?? 0,
        };
      }
    } catch {}
  }
  return { usage, raw };
}

function extractAnthropic(raw: string): SSEParseResult {
  let usage: SSEUsage | null = null;
  const events = raw.split("\n\n");
  for (const ev of events) {
    const lines = ev.split("\n");
    let data = "";
    for (const l of lines) if (l.startsWith("data: ")) data += l.slice(6).trim();
    if (!data) continue;
    try {
      const obj = JSON.parse(data);
      if (obj.usage && (obj.type === "message_delta" || obj.type === "message_start")) {
        usage = {
          prompt_tokens: obj.usage.input_tokens ?? 0,
          completion_tokens: obj.usage.output_tokens ?? 0,
          cache_creation_tokens: obj.usage.cache_creation_input_tokens ?? 0,
          cache_read_tokens: obj.usage.cache_read_input_tokens ?? 0,
          total_tokens: (obj.usage.input_tokens ?? 0) + (obj.usage.output_tokens ?? 0),
        };
      }
    } catch {}
  }
  return { usage, raw };
}
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 136 tests (2 new)

- [ ] **Step 5: Commit**

```bash
git add src/streaming/extractUsage.ts src/streaming/extractUsage.test.ts
git commit -m "feat: extractUsageFromSSE for OpenAI + Anthropic"
```

---

## Task 5.4: Wire requestLogs into handleProxy (non-stream + stream)

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Write failing test**

`src/server.test.ts` (append):
```ts
describe("request logging", () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "rl-")), "t.db");
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
```

- [ ] **Step 2: Run test (expect fail)**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: Update `handleProxy` in `src/server.ts`**

Add imports:
```ts
import { insertRequestLog } from "./db/repos/requestLogs.js";
import { calculateCost } from "./providers/pricing.js";
import { parseError } from "./providers/parseError.js";
```

In the non-stream success branch, after `updateAccount(...)`:
```ts
let respBody = await resp.text();
let usage: any = {};
try { usage = JSON.parse(respBody).usage ?? {}; } catch {}
const cost = calculateCost(c.get("db"), body.model, {
  prompt_tokens: usage.prompt_tokens ?? 0,
  completion_tokens: usage.completion_tokens ?? 0,
  cache_creation_tokens: usage.cache_creation_tokens ?? 0,
  cache_read_tokens: usage.cache_read_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0,
});
insertRequestLog(c.get("db"), {
  user_id: user.id, account_id: account.id, model: body.model,
  endpoint: upstreamPath, format,
  prompt_tokens: usage.prompt_tokens ?? 0,
  completion_tokens: usage.completion_tokens ?? 0,
  cache_creation_tokens: usage.cache_creation_tokens ?? 0,
  cache_read_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
  total_tokens: usage.total_tokens ?? 0,
  cost_usd: cost,
  latency_ms: Date.now() - c.get("startTime"),
  status_code: resp.status,
  base_resp_code: undefined,
  stream: 0,
  rtk_bytes_saved: 0,
});
return c.body(respBody, resp.status as any, { "content-type": resp.headers.get("content-type") ?? "application/json" });
```

Create `src/providers/parseError.ts`:
```ts
export function parseError(resp: Response, bodyText: string): { baseRespCode?: number; windowResetMs?: number; retryAfterSec?: number; message: string } {
  let baseRespCode: number | undefined;
  let windowResetMs: number | undefined;
  try {
    const parsed = JSON.parse(bodyText);
    baseRespCode = parsed?.base_resp?.status_code;
    if (baseRespCode === 2056 || baseRespCode === 2061) {
      const m = parsed?.model_remains?.[0];
      if (m?.end_time) windowResetMs = Math.max(0, m.end_time - Date.now());
    }
  } catch {}
  const ra = resp.headers.get("retry-after");
  const retryAfterSec = ra ? parseInt(ra, 10) : undefined;
  return { baseRespCode, windowResetMs, retryAfterSec, message: bodyText || `HTTP ${resp.status}` };
}
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 137 tests (1 new)

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/providers/parseError.ts src/server.test.ts
git commit -m "feat: log non-stream request with cost"
```

---

## Task 5.5: Dashboard pages (5 pages)

**Files:**
- Create: `src/dashboard/layout.ts`
- Create: `src/dashboard/render.ts`
- Create: `src/dashboard/pages/overview.ts`
- Create: `src/dashboard/pages/usage.ts`
- Create: `src/dashboard/pages/accounts.ts`
- Create: `src/dashboard/pages/models.ts`
- Create: `src/dashboard/pages/quota.ts`
- Create: `src/dashboard/pages/settings.ts`

For brevity, all 5 pages share a layout helper and minimal HTML. Tests verify each route returns 200 + contains expected content.

- [ ] **Step 1: Write `src/dashboard/layout.ts`**

```ts
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} — minimax-router</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 0; padding: 0; background: #f5f5f5; color: #222; }
  nav { background: #222; color: #fff; padding: 12px 24px; }
  nav a { color: #fff; margin-right: 16px; text-decoration: none; }
  main { max-width: 960px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 24px; }
  table { width: 100%; border-collapse: collapse; background: #fff; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #eee; }
  th { background: #fafafa; font-weight: 600; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
  .badge.active { background: #d4edda; color: #155724; }
  .badge.error { background: #f8d7da; color: #721c24; }
  .badge.disabled { background: #e2e3e5; color: #383d41; }
  form { background: #fff; padding: 16px; border-radius: 4px; margin-top: 16px; }
  input, select { padding: 6px 10px; margin: 4px 0; border: 1px solid #ddd; border-radius: 4px; }
  button { padding: 6px 14px; background: #007bff; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
</style>
</head>
<body>
<nav>
  <a href="/admin">Overview</a>
  <a href="/admin/usage">Usage</a>
  <a href="/admin/accounts">Accounts</a>
  <a href="/admin/models">Models</a>
  <a href="/admin/quota">Quota</a>
  <a href="/admin/settings">Settings</a>
</nav>
<main>
${body}
</main>
</body>
</html>`;
}
```

- [ ] **Step 2: Write `src/dashboard/pages/overview.ts`**

```ts
import { layout } from "../layout.js";
import { aggregateUsage } from "../../db/repos/requestLogs.js";
import { listAccountsByUser } from "../../db/repos/accounts.js";
import { recentLogs } from "../../db/repos/requestLogs.js";
import type Database from "better-sqlite3";

export function renderOverview(db: Database.Database, userId: number, userName: string): string {
  const agg = aggregateUsage(db, userId, 7);
  const accounts = listAccountsByUser(db, userId);
  const logs = recentLogs(db, userId, 5);
  const body = `
    <h1>Overview</h1>
    <p>Welcome, ${layout.constructor === Object ? "" : userName} (last 7 days)</p>
    <h2>Stats</h2>
    <table>
      <tr><th>Total cost</th><td>$${agg.total_cost.toFixed(4)}</td></tr>
      <tr><th>Total requests</th><td>${agg.total_requests}</td></tr>
      <tr><th>Total tokens</th><td>${agg.total_tokens.toLocaleString()}</td></tr>
      <tr><th>Active accounts</th><td>${accounts.filter(a => a.enabled).length} / ${accounts.length}</td></tr>
    </table>
    <h2>By model</h2>
    <table>
      <tr><th>Model</th><th>Cost</th><th>Requests</th></tr>
      ${agg.by_model.map(m => `<tr><td>${m.model}</td><td>$${m.cost.toFixed(4)}</td><td>${m.requests}</td></tr>`).join("")}
    </table>
    <h2>Recent requests</h2>
    <table>
      <tr><th>Time</th><th>Model</th><th>Status</th><th>Cost</th></tr>
      ${logs.map(l => `<tr><td>${l.created_at}</td><td>${l.model}</td><td>${l.status_code}</td><td>$${l.cost_usd.toFixed(4)}</td></tr>`).join("")}
    </table>
  `;
  return layout("Overview", body);
}
```

- [ ] **Step 3: Write `src/dashboard/pages/usage.ts`**

```ts
import { layout } from "../layout.js";
import { recentLogs, aggregateUsage } from "../../db/repos/requestLogs.js";
import type Database from "better-sqlite3";

export function renderUsage(db: Database.Database, userId: number): string {
  const logs = recentLogs(db, userId, 100);
  const agg = aggregateUsage(db, userId, 30);
  const body = `
    <h1>Usage (last 30 days)</h1>
    <p>Total: $${agg.total_cost.toFixed(4)} | ${agg.total_requests} requests | ${agg.total_tokens.toLocaleString()} tokens</p>
    <table>
      <tr><th>Time</th><th>Model</th><th>Account</th><th>Tokens</th><th>Cost</th><th>Status</th><th>Latency</th></tr>
      ${logs.map(l => `<tr><td>${l.created_at}</td><td>${l.model}</td><td>${l.account_id ?? ""}</td><td>${l.total_tokens}</td><td>$${l.cost_usd.toFixed(4)}</td><td>${l.status_code}</td><td>${l.latency_ms}ms</td></tr>`).join("")}
    </table>
  `;
  return layout("Usage", body);
}
```

- [ ] **Step 4: Write `src/dashboard/pages/accounts.ts`**

```ts
import { layout } from "../layout.js";
import { listAccountsByUser } from "../../db/repos/accounts.js";
import type Database from "better-sqlite3";

export function renderAccounts(db: Database.Database, userId: number): string {
  const accounts = listAccountsByUser(db, userId);
  const body = `
    <h1>Accounts</h1>
    <table>
      <tr><th>ID</th><th>Label</th><th>Credit</th><th>Status</th><th>Last error</th><th>Backoff</th></tr>
      ${accounts.map(a => `
        <tr>
          <td>${a.id}</td>
          <td>${a.label}</td>
          <td>${a.credit_type}</td>
          <td><span class="badge ${a.status}">${a.status}</span></td>
          <td>${a.last_error ? a.last_error.slice(0, 50) : ""}</td>
          <td>${a.backoff_level}</td>
        </tr>
      `).join("")}
    </table>
    <form method="POST" action="/admin/accounts">
      <h2>Add account</h2>
      <label>Label <input name="label" required></label><br>
      <label>Credit type <select name="credit_type"><option value="payg">PAYG</option><option value="token-plan">Token Plan</option></select></label><br>
      <label>API key <input name="api_key" required></label><br>
      <button type="submit">Add</button>
    </form>
  `;
  return layout("Accounts", body);
}
```

- [ ] **Step 5: Write `src/dashboard/pages/models.ts`**

```ts
import { layout } from "../layout.js";
import { listModels } from "../../db/repos/models.js";
import type Database from "better-sqlite3";

export function renderModels(db: Database.Database, _userId: number): string {
  const models = listModels(db, { includeDisabled: true });
  const body = `
    <h1>Models</h1>
    <form method="POST" action="/admin/models/fetch" style="display:inline">
      <button type="submit">Fetch from upstream</button>
    </form>
    <table>
      <tr><th>Name</th><th>Display</th><th>Family</th><th>Context</th><th>Thinking</th><th>Source</th><th>Enabled</th></tr>
      ${models.map(m => `
        <tr>
          <td>${m.name}</td>
          <td>${m.display_name ?? ""}</td>
          <td>${m.family ?? ""}</td>
          <td>${m.context_window ?? ""}</td>
          <td>${m.thinking_enabled ? "yes" : "no"}</td>
          <td>${m.source}</td>
          <td>${m.enabled ? "yes" : "no"}</td>
        </tr>
      `).join("")}
    </table>
  `;
  return layout("Models", body);
}
```

- [ ] **Step 6: Write `src/dashboard/pages/quota.ts`**

```ts
import { layout } from "../layout.js";
import { listAccountsByUser } from "../../db/repos/accounts.js";
import { latestQuotaByAccount } from "../../db/repos/quotaSnapshots.js";
import type Database from "better-sqlite3";

export function renderQuota(db: Database.Database, userId: number): string {
  const accounts = listAccountsByUser(db, userId);
  const body = `
    <h1>Quota</h1>
    ${accounts.map(a => {
      const snaps = latestQuotaByAccount(db, a.id, 2);
      const h5 = snaps.find(s => s.window_type === "5h");
      const wk = snaps.find(s => s.window_type === "weekly");
      return `
        <h2>${a.label} (${a.credit_type})</h2>
        ${h5 ? `<p>5h window: ${h5.used_count ?? 0} / ${h5.total_count ?? 0} used (${h5.remaining_count ?? 0} remaining) — resets ${h5.window_end ?? "?"}</p>` : "<p>5h: no data</p>"}
        ${wk ? `<p>Weekly: ${wk.used_count ?? 0} / ${wk.total_count ?? 0} used (${wk.remaining_count ?? 0} remaining) — resets ${wk.window_end ?? "?"}</p>` : "<p>Weekly: no data</p>"}
      `;
    }).join("")}
  `;
  return layout("Quota", body);
}
```

- [ ] **Step 7: Write `src/dashboard/pages/settings.ts`**

```ts
import { layout } from "../layout.js";
import { getSetting } from "../../db/repos/settings.js";
import type Database from "better-sqlite3";

export function renderSettings(db: Database.Database): string {
  const caveman = getSetting<{ level: string }>(db, "caveman") ?? { level: "off" };
  const rtk = getSetting<{ enabled: boolean }>(db, "rtk") ?? { enabled: true };
  const caching = getSetting<{ autoBreakpoints: boolean }>(db, "caching") ?? { autoBreakpoints: true };
  const body = `
    <h1>Settings</h1>
    <form method="POST" action="/admin/settings/caveman">
      <h2>Caveman</h2>
      <label>Level:
        <select name="level">
          <option value="off" ${caveman.level === "off" ? "selected" : ""}>off</option>
          <option value="terse" ${caveman.level === "terse" ? "selected" : ""}>terse</option>
          <option value="ultra" ${caveman.level === "ultra" ? "selected" : ""}>ultra</option>
        </select>
      </label>
      <button type="submit">Save</button>
    </form>
    <form method="POST" action="/admin/settings/rtk">
      <h2>RTK</h2>
      <label><input type="checkbox" name="enabled" ${rtk.enabled ? "checked" : ""}> Enable tool-output compression</label>
      <button type="submit">Save</button>
    </form>
    <form method="POST" action="/admin/settings/caching">
      <h2>Caching</h2>
      <label><input type="checkbox" name="autoBreakpoints" ${caching.autoBreakpoints ? "checked" : ""}> Auto-inject dual cache_control breakpoints</label>
      <button type="submit">Save</button>
    </form>
  `;
  return layout("Settings", body);
}
```

- [ ] **Step 8: Write failing integration tests**

`src/server.test.ts` (append):
```ts
import { renderOverview } from "./dashboard/pages/overview.js";
import { renderUsage } from "./dashboard/pages/usage.js";
import { renderAccounts } from "./dashboard/pages/accounts.js";
import { renderModels } from "./dashboard/pages/models.js";
import { renderQuota } from "./dashboard/pages/quota.js";
import { renderSettings } from "./dashboard/pages/settings.js";

describe("dashboard pages", () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "dash-")), "t.db");
  });

  it("all pages render for admin user", async () => {
    const db = openDb();
    const u = createUser(db, "admin");
    createAccount(db, { id: "a1", user_id: u.id, label: "L", credit_type: "payg", api_key: "k" });
    const adminHdr = { Authorization: `Bearer ${u.admin_key}` };
    for (const path of ["/admin", "/admin/usage", "/admin/accounts", "/admin/models", "/admin/quota", "/admin/settings"]) {
      const res = await app.request(path, { headers: adminHdr });
      expect(res.status, `path ${path}`).toBe(200);
      const html = await res.text();
      expect(html).toContain("<!DOCTYPE html>");
    }
  });
});
```

- [ ] **Step 9: Run test (expect fail)**

Run: `npm test`
Expected: FAIL — admin routes not wired

- [ ] **Step 10: Add admin routes to `src/server.ts`**

```ts
import { renderOverview } from "./dashboard/pages/overview.js";
import { renderUsage } from "./dashboard/pages/usage.js";
import { renderAccounts } from "./dashboard/pages/accounts.js";
import { renderModels } from "./dashboard/pages/models.js";
import { renderQuota } from "./dashboard/pages/quota.js";
import { renderSettings } from "./dashboard/pages/settings.js";
import { setSetting } from "./db/repos/settings.js";
import { startQuotaPuller } from "./scheduler/quotaPull.js";

app.get("/admin", requireAdmin, (c) => {
  const u = c.get("user");
  return c.html(renderOverview(c.get("db"), u.id, u.name));
});
app.get("/admin/usage", requireAdmin, (c) => c.html(renderUsage(c.get("db"), c.get("user").id)));
app.get("/admin/accounts", requireAdmin, (c) => c.html(renderAccounts(c.get("db"), c.get("user").id)));
app.get("/admin/models", requireAdmin, (c) => c.html(renderModels(c.get("db"), c.get("user").id)));
app.get("/admin/quota", requireAdmin, (c) => c.html(renderQuota(c.get("db"), c.get("user").id)));
app.get("/admin/settings", requireAdmin, (c) => c.html(renderSettings(c.get("db"))));

app.post("/admin/accounts", requireAdmin, async (c) => {
  const body = await c.req.parseBody();
  const u = c.get("user");
  const id = `acc_${Math.random().toString(36).slice(2, 14)}`;
  createAccount(c.get("db"), {
    id, user_id: u.id, label: String(body.label),
    credit_type: String(body.credit_type) as "payg" | "token-plan",
    api_key: String(body.api_key),
  });
  return c.redirect("/admin/accounts");
});

app.post("/admin/settings/caveman", requireAdmin, async (c) => {
  const body = await c.req.parseBody();
  setSetting(c.get("db"), "caveman", { level: String(body.level) });
  return c.redirect("/admin/settings");
});
app.post("/admin/settings/rtk", requireAdmin, async (c) => {
  const body = await c.req.parseBody();
  setSetting(c.get("db"), "rtk", { enabled: body.enabled === "on" || body.enabled === "true" });
  return c.redirect("/admin/settings");
});
app.post("/admin/settings/caching", requireAdmin, async (c) => {
  const body = await c.req.parseBody();
  setSetting(c.get("db"), "caching", { autoBreakpoints: body.autoBreakpoints === "on" });
  return c.redirect("/admin/settings");
});
```

Update listener block:
```ts
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT ?? "20137", 10);
  const hostname = process.env.HOST ?? "127.0.0.1";
  serve({ fetch: app.fetch, port, hostname }, (info) => {
    log.info({ address: info.address, port: info.port }, "router listening");
    startQuotaPuller(db, 5 * 60_000);
  });
}
```

- [ ] **Step 11: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 138 tests (1 new)

- [ ] **Step 12: Commit**

```bash
git add src/dashboard/ src/server.ts src/server.test.ts
git commit -m "feat: 6 dashboard pages + admin POST routes + quota scheduler start"
```

---

## Task 5.6: Phase 5 checkpoint

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: 138+ tests pass

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit + tag**

```bash
git add .
git commit -m "chore: phase 5 v0.5 checkpoint" --allow-empty
git tag v0.5
```

---

**End of Phase 5.** Continue to [Phase 6: v0.6 Transport + Docker](./2026-06-01-minimax-router-phase-6-v06-transport-docker.md).
