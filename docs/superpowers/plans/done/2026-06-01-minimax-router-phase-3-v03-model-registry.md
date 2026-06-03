# Phase 3: v0.3 — Model Registry + Alias + Pricing

> Part of [Master Plan](./2026-06-01-minimax-router.md). Requires Phase 2 done.
> Spec: `docs/spec/IMPLEMENTATION.md` §6 v0.3
> Target: 2-3h

**Goal:** Resolve model aliases (M3-thinking injects thinking, M2.7-thinking same), call /v1/models upstream to merge into registry, calculate cost with M3 tiered pricing.

**Done when:** `MiniMax-M3-thinking` body upstream with `thinking.enabled`, M3 > 512k ctx uses high tier, M2-her with NULL pricing logs cost_usd=0 (honest unknown), `/admin/models/fetch` hits upstream and adds new models.

---

## Task 3.1: Models repo (CRUD + fetch-merge)

**Files:**
- Create: `src/db/repos/models.ts`
- Create: `src/db/repos/models.test.ts`

- [x] **Step 1: Write failing tests**

`src/db/repos/models.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../index.js";
import { getModel, listModels, upsertModel, disableModel } from "./models.js";

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "m-")), "t.db");
});

describe("models repo", () => {
  it("getModel returns seed model by name", () => {
    const db = openDb();
    const m = getModel(db, "MiniMax-M3");
    expect(m?.upstream_model).toBe("MiniMax-M3");
    expect(m?.thinking_enabled).toBe(0);
  });

  it("getModel returns null for unknown", () => {
    const db = openDb();
    expect(getModel(db, "nope")).toBeNull();
  });

  it("listModels returns enabled only by default", () => {
    const db = openDb();
    expect(listModels(db).length).toBe(11);
    const all = listModels(db, { includeDisabled: true });
    expect(all.length).toBe(11);
  });

  it("upsertModel inserts new", () => {
    const db = openDb();
    upsertModel(db, { name: "custom-x", upstream_model: "custom-x", display_name: "Custom X", family: "custom", source: "manual" });
    expect(getModel(db, "custom-x")?.display_name).toBe("Custom X");
  });

  it("upsertModel updates existing (name match)", () => {
    const db = openDb();
    upsertModel(db, { name: "MiniMax-M3", upstream_model: "MiniMax-M3", display_name: "Updated", family: "m3", source: "fetched" });
    expect(getModel(db, "MiniMax-M3")?.display_name).toBe("Updated");
  });

  it("disableModel sets enabled=0", () => {
    const db = openDb();
    disableModel(db, "MiniMax-M3");
    expect(getModel(db, "MiniMax-M3")?.enabled).toBe(0);
  });
});
```

- [x] **Step 2: Run tests (expect fail)**

Run: `npm test`
Expected: FAIL

- [x] **Step 3: Write `src/db/repos/models.ts`**

```ts
import type Database from "better-sqlite3";

export interface Model {
  id: number;
  name: string;
  display_name: string | null;
  family: string | null;
  upstream_model: string;
  context_window: number | null;
  thinking_enabled: number;
  thinking_budget: number | null;
  pricing_input: number | null;
  pricing_output: number | null;
  pricing_cache_read: number | null;
  pricing_cache_write: number | null;
  pricing_tiers: string | null;
  capabilities: string | null;
  source: string;
  enabled: number;
  created_at: string;
}

export type ModelUpsert = Pick<Model, "name" | "upstream_model"> & Partial<Model>;

export function getModel(db: Database.Database, name: string): Model | null {
  return db.prepare(`SELECT * FROM models WHERE name = ?`).get(name) as Model | null;
}

export function listModels(db: Database.Database, opts: { includeDisabled?: boolean } = {}): Model[] {
  const sql = opts.includeDisabled
    ? `SELECT * FROM models ORDER BY family, name`
    : `SELECT * FROM models WHERE enabled = 1 ORDER BY family, name`;
  return db.prepare(sql).all() as Model[];
}

export function upsertModel(db: Database.Database, m: ModelUpsert): void {
  const existing = getModel(db, m.name);
  if (existing) {
    const keys = Object.keys(m).filter(k => k !== "name" && k !== "id" && k !== "created_at");
    if (keys.length === 0) return;
    const set = keys.map(k => `${k} = ?`).join(", ");
    const vals = keys.map(k => (m as any)[k]);
    db.prepare(`UPDATE models SET ${set} WHERE name = ?`).run(...vals, m.name);
  } else {
    db.prepare(`
      INSERT INTO models (name, upstream_model, display_name, family, context_window, thinking_enabled, thinking_budget,
                          pricing_input, pricing_output, pricing_cache_read, pricing_cache_write, pricing_tiers, capabilities, source, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      m.name, m.upstream_model,
      m.display_name ?? null, m.family ?? null, m.context_window ?? null,
      m.thinking_enabled ? 1 : 0, m.thinking_budget ?? null,
      m.pricing_input ?? null, m.pricing_output ?? null,
      m.pricing_cache_read ?? null, m.pricing_cache_write ?? null,
      m.pricing_tiers ?? null, m.capabilities ?? null,
      m.source ?? "manual", m.enabled === 0 ? 0 : 1,
    );
  }
}

export function disableModel(db: Database.Database, name: string): void {
  db.prepare(`UPDATE models SET enabled = 0 WHERE name = ?`).run(name);
}
```

- [x] **Step 4: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 73 tests (6 new)

- [x] **Step 5: Commit**

```bash
git add src/db/repos/models.ts src/db/repos/models.test.ts
git commit -m "feat: models repo (CRUD + upsert + disable)"
```

---

## Task 3.2: Model alias resolution + thinking injection

**Files:**
- Create: `src/providers/alias.ts`
- Create: `src/providers/alias.test.ts`

- [x] **Step 1: Write failing tests**

`src/providers/alias.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../db/index.js";
import { resolveModel } from "./alias.js";

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "al-")), "t.db");
});

describe("resolveModel", () => {
  it("M3 → upstream M3, no thinking injected", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M3", messages: [] };
    const r = resolveModel(db, "MiniMax-M3", body);
    expect(r.upstreamModel).toBe("MiniMax-M3");
    r.bodyTransform(body);
    expect(body.thinking).toBeUndefined();
  });

  it("M3-thinking → upstream M3, injects thinking.enabled", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M3-thinking", messages: [] };
    const r = resolveModel(db, "MiniMax-M3-thinking", body);
    expect(r.upstreamModel).toBe("MiniMax-M3");
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
  });

  it("M3-thinking respects caller override of budget_tokens", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M3-thinking", messages: [], thinking: { type: "enabled", budget_tokens: 16384 } };
    const r = resolveModel(db, "MiniMax-M3-thinking", body);
    r.bodyTransform(body);
    expect(body.thinking.budget_tokens).toBe(16384);
  });

  it("M2.7-thinking → upstream M2.7, injects thinking", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M2.7-thinking", messages: [] };
    const r = resolveModel(db, "MiniMax-M2.7-thinking", body);
    expect(r.upstreamModel).toBe("MiniMax-M2.7");
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
  });

  it("M2.7 → no thinking injected", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M2.7", messages: [] };
    const r = resolveModel(db, "MiniMax-M2.7", body);
    r.bodyTransform(body);
    expect(body.thinking).toBeUndefined();
  });

  it("unknown model throws", () => {
    const db = openDb();
    expect(() => resolveModel(db, "totally-fake-model", {})).toThrow(/unknown model/);
  });

  it("disabled model throws", () => {
    const db = openDb();
    db.prepare(`UPDATE models SET enabled = 0 WHERE name = ?`).run("MiniMax-M3");
    expect(() => resolveModel(db, "MiniMax-M3", {})).toThrow(/model disabled/);
  });
});
```

- [x] **Step 2: Run tests (expect fail)**

Run: `npm test`
Expected: FAIL

- [x] **Step 3: Write `src/providers/alias.ts`**

```ts
import type Database from "better-sqlite3";
import { getModel, type Model } from "../db/repos/models.js";

export interface ResolvedModel {
  upstreamModel: string;
  bodyTransform: (body: any) => void;
}

export function resolveModel(db: Database.Database, requestedName: string, _body: any): ResolvedModel {
  const model: Model | null = getModel(db, requestedName);
  if (!model) throw new Error(`unknown model: ${requestedName}`);
  if (!model.enabled) throw new Error(`model disabled: ${requestedName}`);

  return {
    upstreamModel: model.upstream_model,
    bodyTransform: (b: any) => {
      if (model.thinking_enabled && !b.thinking) {
        b.thinking = { type: "enabled", budget_tokens: model.thinking_budget ?? 4096 };
      }
    },
  };
}
```

- [x] **Step 4: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 80 tests (7 new)

- [x] **Step 5: Commit**

```bash
git add src/providers/alias.ts src/providers/alias.test.ts
git commit -m "feat: providers/alias resolves model + injects thinking"
```

---

## Task 3.3: Pricing module (M3 tiered + flat models)

**Files:**
- Create: `src/providers/pricing.ts`
- Create: `src/providers/pricing.test.ts`

- [x] **Step 1: Write failing tests**

`src/providers/pricing.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../db/index.js";
import { resolvePricing, calculateCost } from "./pricing.js";

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "pr-")), "t.db");
});

describe("resolvePricing", () => {
  it("M3 ≤ 512k → base pricing", () => {
    const db = openDb();
    const p = resolvePricing(db, "MiniMax-M3", 100_000);
    expect(p?.input).toBe(0.60);
    expect(p?.output).toBe(2.40);
    expect(p?.cacheRead).toBe(0.12);
  });

  it("M3 > 512k → high pricing (2x)", () => {
    const db = openDb();
    const p = resolvePricing(db, "MiniMax-M3", 600_000);
    expect(p?.input).toBe(1.20);
    expect(p?.output).toBe(4.80);
    expect(p?.cacheRead).toBe(0.24);
  });

  it("M2.7 → flat pricing", () => {
    const db = openDb();
    const p = resolvePricing(db, "MiniMax-M2.7", 50_000);
    expect(p?.input).toBe(0.30);
    expect(p?.output).toBe(1.20);
    expect(p?.cacheRead).toBe(0.06);
    expect(p?.cacheWrite).toBe(0.375);
  });

  it("M2-her with NULL pricing → null", () => {
    const db = openDb();
    expect(resolvePricing(db, "MiniMax-M2-her", 1000)).toBeNull();
  });

  it("unknown model → null", () => {
    const db = openDb();
    expect(resolvePricing(db, "nope", 1000)).toBeNull();
  });
});

describe("calculateCost", () => {
  it("M2.7 with cache_read returns positive cost", () => {
    const db = openDb();
    const c = calculateCost(db, "MiniMax-M2.7", {
      prompt_tokens: 1000, completion_tokens: 500, cache_creation_tokens: 0, cache_read_tokens: 2000,
    });
    const expected = (1000/1e6)*0.30 + (500/1e6)*1.20 + (2000/1e6)*0.06;
    expect(c).toBeCloseTo(expected, 8);
  });

  it("M3 with cache_creation: cacheWrite NULL → cost excludes cache_creation (honest unknown)", () => {
    const db = openDb();
    const c = calculateCost(db, "MiniMax-M3", {
      prompt_tokens: 1000, completion_tokens: 500, cache_creation_tokens: 1000, cache_read_tokens: 0,
    });
    const expected = (1000/1e6)*0.60 + (500/1e6)*2.40;
    expect(c).toBeCloseTo(expected, 8);
  });

  it("unknown model → cost = 0 (caller should log NULL)", () => {
    const db = openDb();
    const c = calculateCost(db, "nope", { prompt_tokens: 100, completion_tokens: 100, cache_creation_tokens: 0, cache_read_tokens: 0 });
    expect(c).toBe(0);
  });
});
```

- [x] **Step 2: Run tests (expect fail)**

Run: `npm test`
Expected: FAIL

- [x] **Step 3: Write `src/providers/pricing.ts`**

```ts
import type Database from "better-sqlite3";
import { getModel, type Model } from "../db/repos/models.js";

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number | null;
}

export interface ModelPricingTiers {
  base: ModelPricing;
  high: ModelPricing;
  promotional?: ModelPricing;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

const HIGH_CONTEXT_THRESHOLD = 512_000;

export function resolvePricing(db: Database.Database, modelName: string, promptTokens: number): ModelPricing | null {
  const model: Model | null = getModel(db, modelName);
  if (!model) return null;

  if (model.pricing_tiers) {
    const tiers: ModelPricingTiers = JSON.parse(model.pricing_tiers);
    if (promptTokens > HIGH_CONTEXT_THRESHOLD) return tiers.high;
    return tiers.promotional ?? tiers.base;
  }

  if (model.pricing_input == null) return null;
  return {
    input: model.pricing_input,
    output: model.pricing_output ?? 0,
    cacheRead: model.pricing_cache_read ?? 0,
    cacheWrite: model.pricing_cache_write,
  };
}

export function calculateCost(db: Database.Database, modelName: string, usage: Usage): number {
  const pricing = resolvePricing(db, modelName, usage.prompt_tokens);
  if (!pricing) return 0;

  const input       = (usage.prompt_tokens         / 1_000_000) * pricing.input;
  const output      = (usage.completion_tokens     / 1_000_000) * pricing.output;
  const cacheCreate = pricing.cacheWrite != null
    ? (usage.cache_creation_tokens / 1_000_000) * pricing.cacheWrite
    : 0;
  const cacheRead   = (usage.cache_read_tokens     / 1_000_000) * pricing.cacheRead;

  return input + output + cacheCreate + cacheRead;
}
```

- [x] **Step 4: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 89 tests (9 new)

- [x] **Step 5: Commit**

```bash
git add src/providers/pricing.ts src/providers/pricing.test.ts
git commit -m "feat: providers/pricing with M3 tiered + cache_write NULL handling"
```

---

## Task 3.4: Live /v1/models fetch + merge

**Files:**
- Create: `src/providers/listModels.ts`
- Create: `src/providers/listModels.test.ts`

- [x] **Step 1: Write failing test**

`src/providers/listModels.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../db/index.js";
import { listModels } from "../db/repos/models.js";
import { fetchModels } from "./listModels.js";

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "lm-")), "t.db");
});

describe("fetchModels", () => {
  it("hits upstream /v1/models and merges new ones", async () => {
    const db = openDb();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        data: [
          { id: "MiniMax-M3" },
          { id: "MiniMax-newmodel" },
          { id: "MiniMax-another" },
        ],
      }), { status: 200 }),
    );

    const count = await fetchModels(db, "mm_test");
    expect(count).toBe(2); // 2 new (M3 already seeded)

    const all = listModels(db, { includeDisabled: true });
    const names = all.map(m => m.name);
    expect(names).toContain("MiniMax-newmodel");
    expect(names).toContain("MiniMax-another");
    expect(names).toContain("MiniMax-M3"); // still there
  });

  it("updates display_name + family on existing models", async () => {
    const db = openDb();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "MiniMax-M3" }] }), { status: 200 }),
    );
    await fetchModels(db, "mm_test");
    const m = listModels(db, { includeDisabled: true }).find(x => x.name === "MiniMax-M3")!;
    expect(m.source).toBe("fetched");
  });

  it("throws on non-2xx", async () => {
    const db = openDb();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("err", { status: 500 }));
    await expect(fetchModels(db, "mm_test")).rejects.toThrow(/fetchModels failed/);
  });
});
```

- [x] **Step 2: Run test (expect fail)**

Run: `npm test`
Expected: FAIL

- [x] **Step 3: Write `src/providers/listModels.ts`**

```ts
import type Database from "better-sqlite3";
import { upsertModel } from "../db/repos/models.js";
import { getBaseUrl } from "./baseUrl.js";
import { buildHeaders } from "./headers.js";

function detectFamily(name: string): string {
  if (name.includes("M3")) return "m3";
  if (name.includes("M2.7")) return "m2.7";
  if (name.includes("M2.5")) return "m2.5";
  if (name.includes("M2.1")) return "m2.1";
  if (name.includes("M2-her")) return "m2-her";
  if (name.includes("M2")) return "m2";
  return "custom";
}

export async function fetchModels(db: Database.Database, apiKey: string): Promise<number> {
  const account = { provider: "minimax" as const, baseUrl: null };
  const url = `${getBaseUrl(account, "openai")}/v1/models`;
  const headers = buildHeaders({ provider: "minimax", apiKey }, false, "openai");
  const resp = await fetch(url, { method: "GET", headers });
  if (!resp.ok) throw new Error(`fetchModels failed: ${resp.status}`);

  const data = await resp.json() as { data: { id: string }[] };
  let added = 0;
  for (const m of data.data ?? []) {
    const existing = db.prepare(`SELECT id FROM models WHERE name = ?`).get(m.id);
    if (!existing) added++;
    upsertModel(db, {
      name: m.id,
      upstream_model: m.id,
      display_name: m.id,
      family: detectFamily(m.id),
      source: "fetched",
      enabled: 1,
    });
  }
  return added;
}
```

- [x] **Step 4: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 92 tests (3 new)

- [x] **Step 5: Commit**

```bash
git add src/providers/listModels.ts src/providers/listModels.test.ts
git commit -m "feat: providers/listModels hits /v1/models and merges"
```

---

## Task 3.5: Wire resolveModel + upstream into handleProxy

**Files:**
- Modify: `src/server.ts`
- Create: `src/db/repos/requestLogs.ts` (stub for next phase; needed here for cost logging)

- [x] **Step 1: Write failing integration test**

`src/server.test.ts` (append):
```ts
import { calculateCost } from "./providers/pricing.js";

describe("model resolution in proxy", () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "mr-")), "t.db");
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
    const sentBody = JSON.parse(spy.mock.calls[0][1].body as string);
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
```

- [x] **Step 2: Run test (expect fail)**

Run: `npm test`
Expected: FAIL

- [x] **Step 3: Update `handleProxy` in `src/server.ts`**

Add at top of function (after user extraction):
```ts
import { resolveModel } from "./providers/alias.js";
```

Replace the line:
```ts
const acc = user.accounts.find(a => a.id === account.id)!;
```

With:
```ts
const acc = user.accounts.find(a => a.id === account.id)!;

let resolved;
try {
  resolved = resolveModel(c.get("db"), body.model ?? "", body);
  body.model = resolved.upstreamModel;
  resolved.bodyTransform(body);
} catch (e: any) {
  return c.json({ error: e.message }, 400);
}
```

- [x] **Step 4: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 94 tests (2 new)

- [x] **Step 5: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat: wire resolveModel + thinking injection into handleProxy"
```

---

## Task 3.6: Admin /admin/models/fetch endpoint

**Files:**
- Modify: `src/server.ts`

- [x] **Step 1: Write failing test**

`src/server.test.ts` (append):
```ts
describe("POST /admin/models/fetch", () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "am-")), "t.db");
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
    expect(body.added).toBe(1); // newly is new
  });
});
```

- [x] **Step 2: Run test (expect fail)**

Run: `npm test`
Expected: FAIL

- [x] **Step 3: Add route to `src/server.ts`**

```ts
import { fetchModels } from "./providers/listModels.js";

app.post("/admin/models/fetch", requireAdmin, async (c) => {
  const user = c.get("user");
  const firstActive = user.accounts.find(a => a.enabled);
  if (!firstActive) return c.json({ error: "no active account" }, 400);
  try {
    const added = await fetchModels(c.get("db"), firstActive.api_key);
    return c.json({ added });
  } catch (e: any) {
    return c.json({ error: e.message }, 502);
  }
});
```

- [x] **Step 4: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 96 tests (2 new)

- [x] **Step 5: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat: POST /admin/models/fetch endpoint"
```

---

## Task 3.7: Phase 3 checkpoint

- [x] **Step 1: Full test suite**

Run: `npm test`
Expected: 96+ tests pass

- [x] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors

- [x] **Step 3: Commit + tag**

```bash
git add .
git commit -m "chore: phase 3 v0.3 checkpoint" --allow-empty
git tag v0.3
```

---

**End of Phase 3.** Continue to [Phase 4: v0.4 RTK + Caveman + Cache](./2026-06-01-minimax-router-phase-4-v04-rtk-caveman-cache.md).
