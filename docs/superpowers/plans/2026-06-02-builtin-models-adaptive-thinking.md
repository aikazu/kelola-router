# Built-in Models: Adaptive Thinking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse built-in `MiniMax-*-thinking` variants into the base model. Router injects `thinking: { type: "adaptive" }` for every model that the MiniMax docs list as thinking-capable, and `reasoning_split: true` follows. Older built-in rows for `M3-thinking` and `M2.7-thinking` get cleaned up. Legacy client requests for `M2.7-thinking` still resolve via alias.

**Architecture:** Hardcoded allowlist const in `src/providers/alias.ts` (driven by what's in `docs/minimax-reference/`) replaces the per-row `thinking_enabled` flag. Schema drops both `thinking_enabled` and `thinking_budget` columns via a new migration. `reasoning_split` no longer reads the global `minimax` setting; it auto-enables when `thinking` is present in the body.

**Tech Stack:** TypeScript strict, vitest, better-sqlite3, Hono, Preact (dashboard).

---

## File Map

| File | Responsibility |
|---|---|
| `src/db/migrations/006-drop-thinking-fields.ts` | New: `ALTER TABLE models DROP COLUMN thinking_enabled; DROP COLUMN thinking_budget;` |
| `src/db/migrations/index.ts` | Register migration 006 |
| `src/db/migrations/001-initial.ts` | Drop 2 columns from `CREATE TABLE`; remove `M3-thinking` and `M2.7-thinking` seed rows |
| `src/db/repos/models.ts` | Drop fields from `Model` interface and `upsertModel` SQL |
| `src/db/repos/models.test.ts` | Drop `thinking_enabled` assertion; `listModels` length → 9 |
| `src/providers/alias.ts` | Replace thinking logic with allowlist + legacy alias map |
| `src/providers/alias.test.ts` | Rewrite tests for adaptive injection + legacy alias |
| `scripts/seed-models.ts` | Drop `M2.7-thinking` row, drop `thinking_enabled` from each entry |
| `src/api/admin/models.ts` | Drop `thinkingEnabled` from response mapper |
| `src/server.ts` | Drop `reasoningSplitDefault` from `POST /admin/settings/minimax` handler |
| `src/server.test.ts` | Update `M3-thinking` rewrite test to expect `type: "adaptive"` |
| `src/db/index.test.ts` | Update "seeds 11 default MiniMax models" → 9, drop `-thinking` assertions |
| `client/src/pages/Models.tsx` | Drop "Thinking" column from UI |

---

### Task 1: Migration `006-drop-thinking-fields`

**Files:**
- Create: `src/db/migrations/006-drop-thinking-fields.ts`
- Modify: `src/db/migrations/index.ts`

- [ ] **Step 1: Create migration file**

Create `src/db/migrations/006-drop-thinking-fields.ts`:

```ts
import type Database from "better-sqlite3";

/**
 * Drop the router-invented `thinking_enabled` and `thinking_budget` columns
 * from the `models` table. Thinking is now driven by an allowlist in
 * `src/providers/alias.ts` and always uses `thinking.type = "adaptive"`.
 *
 * Idempotent: skip if the columns have already been removed (fresh deploys
 * from the updated 001-initial.ts won't have them).
 */
export const migration_006 = {
  id: 6,
  name: "drop_thinking_fields",
  condition: (db: Database.Database) => {
    const cols = db.prepare(`PRAGMA table_info(models)`).all() as { name: string }[];
    return cols.some(c => c.name === "thinking_enabled") || cols.some(c => c.name === "thinking_budget");
  },
  sql: `
    ALTER TABLE models DROP COLUMN thinking_enabled;
    ALTER TABLE models DROP COLUMN thinking_budget;
  `,
};
```

- [ ] **Step 2: Register migration in index**

Edit `src/db/migrations/index.ts`. Replace the import block and the array with:

```ts
import { migration_001 } from "./001-initial.js";
import { migration_002 } from "./002-admin-key.js";
import { migration_003 } from "./003-drop-users.js";
import { migration_004 } from "./004-sessions.js";
import { migration_005 } from "./005-request-bodies.js";
import { migration_006 } from "./006-drop-thinking-fields.js";
import type Database from "better-sqlite3";

const ALL_MIGRATIONS: Array<{
  id: number;
  name: string;
  sql: string;
  condition?: (db: Database.Database) => boolean;
}> = [migration_001, migration_002, migration_003, migration_004, migration_005, migration_006];
```

(The rest of `index.ts` is unchanged.)

- [ ] **Step 3: Update `001-initial.ts` to drop the columns from CREATE TABLE**

Edit `src/db/migrations/001-initial.ts`. In the `models` `CREATE TABLE`, remove the two lines:

```sql
      thinking_enabled      INTEGER NOT NULL DEFAULT 0,
      thinking_budget       INTEGER,
```

The result should be:

```sql
    CREATE TABLE IF NOT EXISTS models (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      name                  TEXT NOT NULL UNIQUE,
      display_name          TEXT,
      family                TEXT,
      upstream_model        TEXT NOT NULL,
      context_window        INTEGER,
      pricing_input         REAL,
      pricing_output        REAL,
      pricing_cache_read    REAL,
      pricing_cache_write   REAL,
      pricing_tiers         TEXT,
      capabilities          TEXT,
      source                TEXT NOT NULL DEFAULT 'manual',
      enabled               INTEGER NOT NULL DEFAULT 1,
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );
```

- [ ] **Step 4: Remove `M3-thinking` and `M2.7-thinking` rows from `001-initial.ts`**

In the same file, edit the seed `INSERT OR IGNORE INTO models (...) VALUES ...` block. Remove the two rows:

```sql
      ('MiniMax-M3-thinking',    'MiniMax M3 (thinking)',  'm3',   'MiniMax-M3',        1000000, 1, 0.60, 2.40, 0.12, NULL,
        '{"base":{"input":0.60,"output":0.60,"cacheRead":0.12,"cacheWrite":null},"high":{"input":1.20,"output":1.20,"cacheRead":0.24,"cacheWrite":null},"promotional":{"input":0.30,"output":0.30,"cacheRead":0.06,"cacheWrite":null}}',
        'builtin'),
      ('MiniMax-M2.7-thinking',  'MiniMax M2.7 (thinking)','m2.7', 'MiniMax-M2.7',      204800,  1, 0.30, 1.20, 0.06, 0.375, NULL, 'builtin'),
```

(Also remove the `thinking_enabled` column reference from the `INSERT OR IGNORE INTO models (...)` column list — drop the `, thinking_enabled` token. The remaining column list should be: `name, display_name, family, upstream_model, context_window, pricing_input, pricing_output, pricing_cache_read, pricing_cache_write, pricing_tiers, source`.)

Also remove the `reasoningSplitDefault` from the `minimax` settings seed row — change that row to:

```sql
      ('minimax', '{"upstreamFormat": "auto", "m3DefaultMaxCompletionTokens": 131072}'),
```

- [ ] **Step 5: Verify by opening a fresh DB**

Run: `npx tsx -e "import {openDb} from './src/db/index.ts'; const db = openDb(); const cols = db.prepare('PRAGMA table_info(models)').all(); console.log(cols);"`
Expected: printout has no `thinking_enabled` or `thinking_budget` keys. The 9 model rows are present (no `-thinking` variants).

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/006-drop-thinking-fields.ts src/db/migrations/index.ts src/db/migrations/001-initial.ts
git commit -m "feat(db): drop thinking_enabled + thinking_budget columns, drop -thinking seed rows"
```

---

### Task 2: Repo `src/db/repos/models.ts` + tests

**Files:**
- Modify: `src/db/repos/models.ts`
- Modify: `src/db/repos/models.test.ts`

- [ ] **Step 1: Update failing test (red)**

Edit `src/db/repos/models.test.ts`. Replace the entire file with:

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
  });

  it("getModel returns null for unknown", () => {
    const db = openDb();
    expect(getModel(db, "nope")).toBeNull();
  });

  it("listModels returns 9 enabled builtins by default", () => {
    const db = openDb();
    expect(listModels(db).length).toBe(9);
    const all = listModels(db, { includeDisabled: true });
    expect(all.length).toBe(9);
  });

  it("seeded models never include -thinking variant", () => {
    const db = openDb();
    const names = listModels(db).map(m => m.name);
    expect(names.some(n => n.endsWith("-thinking"))).toBe(false);
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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/repos/models.test.ts`
Expected: FAIL with `thinking_enabled` not a property / schema mismatch (or `TypeError: Cannot read properties of undefined` because the repo still references the column).

- [ ] **Step 3: Update `Model` interface and `upsertModel`**

Edit `src/db/repos/models.ts`. Replace the entire file with:

```ts
import type Database from "better-sqlite3";

export interface Model {
  id: number;
  name: string;
  display_name: string | null;
  family: string | null;
  upstream_model: string;
  context_window: number | null;
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
  const row = db.prepare(`SELECT * FROM models WHERE name = ?`).get(name) as Model | undefined;
  return row ?? null;
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
    const vals = keys.map(k => (m as Record<string, unknown>)[k]);
    db.prepare(`UPDATE models SET ${set} WHERE name = ?`).run(...vals, m.name);
  } else {
    db.prepare(`
      INSERT INTO models (name, upstream_model, display_name, family, context_window,
                          pricing_input, pricing_output, pricing_cache_read, pricing_cache_write, pricing_tiers, capabilities, source, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      m.name, m.upstream_model,
      m.display_name ?? null, m.family ?? null, m.context_window ?? null,
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

export function enableModel(db: Database.Database, name: string): void {
  db.prepare(`UPDATE models SET enabled = 1 WHERE name = ?`).run(name);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/repos/models.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/db/repos/models.ts src/db/repos/models.test.ts
git commit -m "feat(repo): drop thinking_enabled + thinking_budget from models schema/repo"
```

---

### Task 3: Update `src/db/index.test.ts`

**Files:**
- Modify: `src/db/index.test.ts`

- [ ] **Step 1: Update test assertions (red → green in one go, since it tests integration)**

Edit `src/db/index.test.ts`. Replace the `it("seeds 11 default MiniMax models", ...)` block with:

```ts
  it("seeds 9 default MiniMax models (no -thinking variants)", () => {
    const db = openDb();
    const rows = db.prepare(`SELECT name FROM models ORDER BY name`).all() as { name: string }[];
    const names = rows.map(r => r.name);
    expect(names).toContain("MiniMax-M3");
    expect(names).toContain("MiniMax-M2.7");
    expect(names).toContain("MiniMax-M2.7-highspeed");
    expect(names).toContain("MiniMax-M2.5");
    expect(names).toContain("MiniMax-M2.5-highspeed");
    expect(names).toContain("MiniMax-M2.1");
    expect(names).toContain("MiniMax-M2.1-highspeed");
    expect(names).toContain("MiniMax-M2");
    expect(names).toContain("MiniMax-M2-her");
    expect(names).not.toContain("MiniMax-M3-thinking");
    expect(names).not.toContain("MiniMax-M2.7-thinking");
    expect(rows.length).toBe(9);
  });
```

- [ ] **Step 2: Run test to verify it passes (depends on Task 1 + 2 being merged in working tree)**

Run: `npx vitest run src/db/index.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/db/index.test.ts
git commit -m "test(db): expect 9 default models, no -thinking variants"
```

---

### Task 4: `src/providers/alias.ts` — allowlist + legacy alias

**Files:**
- Modify: `src/providers/alias.ts`
- Modify: `src/providers/alias.test.ts`

- [ ] **Step 1: Update failing tests (red)**

Edit `src/providers/alias.test.ts`. Replace the entire file with:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../db/index.js";
import { resolveModel, ADAPTIVE_THINKING_MODELS, LEGACY_MODEL_ALIASES } from "./alias.js";

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "al-")), "t.db");
});

describe("resolveModel — base behavior", () => {
  it("M3 → upstream M3, no client thinking set → router injects adaptive", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M3", messages: [] };
    const r = resolveModel(db, "MiniMax-M3", body);
    expect(r.upstreamModel).toBe("MiniMax-M3");
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.reasoning_split).toBe(true);
  });

  it("M2.7 → upstream M2.7, no client thinking → adaptive", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M2.7", messages: [] };
    const r = resolveModel(db, "MiniMax-M2.7", body);
    expect(r.upstreamModel).toBe("MiniMax-M2.7");
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.reasoning_split).toBe(true);
  });

  it("M2.7-highspeed → upstream unchanged, adaptive injected", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M2.7-highspeed", messages: [] };
    const r = resolveModel(db, "MiniMax-M2.7-highspeed", body);
    expect(r.upstreamModel).toBe("MiniMax-M2.7-highspeed");
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: "adaptive" });
  });

  it("M2-her → no thinking injection, no reasoning_split", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M2-her", messages: [] };
    const r = resolveModel(db, "MiniMax-M2-her", body);
    expect(r.upstreamModel).toBe("MiniMax-M2-her");
    r.bodyTransform(body);
    expect(body.thinking).toBeUndefined();
    expect(body.reasoning_split).toBeUndefined();
  });
});

describe("resolveModel — caller wins on thinking", () => {
  it("client thinking.type=disabled → router does NOT inject", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M3", messages: [], thinking: { type: "disabled" } };
    resolveModel(db, "MiniMax-M3", body).bodyTransform(body);
    expect(body.thinking).toEqual({ type: "disabled" });
    // reasoning_split still auto-on because thinking is present
    expect(body.reasoning_split).toBe(true);
  });

  it("client thinking.type=adaptive with budget_tokens → router leaves it", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M2.7", messages: [], thinking: { type: "adaptive", budget_tokens: 8192 } };
    resolveModel(db, "MiniMax-M2.7", body).bodyTransform(body);
    expect(body.thinking).toEqual({ type: "adaptive", budget_tokens: 8192 });
  });

  it("client reasoning_split=false + thinking disabled → respects caller", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M3", messages: [], thinking: { type: "disabled" }, reasoning_split: false };
    resolveModel(db, "MiniMax-M3", body).bodyTransform(body);
    expect(body.reasoning_split).toBe(false);
  });
});

describe("resolveModel — legacy aliases", () => {
  it("M2.7-thinking → resolves to M2.7, adaptive injected", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M2.7-thinking", messages: [] };
    const r = resolveModel(db, "MiniMax-M2.7-thinking", body);
    expect(r.upstreamModel).toBe("MiniMax-M2.7");
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.reasoning_split).toBe(true);
  });

  it("M3-thinking → resolves to M3, adaptive injected (legacy compat)", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M3-thinking", messages: [] };
    const r = resolveModel(db, "MiniMax-M3-thinking", body);
    expect(r.upstreamModel).toBe("MiniMax-M3");
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: "adaptive" });
  });

  it("LEGACY_MODEL_ALIASES only contains retired names", () => {
    expect(LEGACY_MODEL_ALIASES["MiniMax-M2.7-thinking"]).toBe("MiniMax-M2.7");
    expect(LEGACY_MODEL_ALIASES["MiniMax-M3-thinking"]).toBe("MiniMax-M3");
  });
});

describe("resolveModel — error paths", () => {
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

describe("ADAPTIVE_THINKING_MODELS allowlist", () => {
  it("contains all MiniMax reference docs thinking-capable models", () => {
    expect(ADAPTIVE_THINKING_MODELS.has("MiniMax-M3")).toBe(true);
    expect(ADAPTIVE_THINKING_MODELS.has("MiniMax-M2.7")).toBe(true);
    expect(ADAPTIVE_THINKING_MODELS.has("MiniMax-M2.7-highspeed")).toBe(true);
    expect(ADAPTIVE_THINKING_MODELS.has("MiniMax-M2.5")).toBe(true);
    expect(ADAPTIVE_THINKING_MODELS.has("MiniMax-M2.5-highspeed")).toBe(true);
    expect(ADAPTIVE_THINKING_MODELS.has("MiniMax-M2.1")).toBe(true);
    expect(ADAPTIVE_THINKING_MODELS.has("MiniMax-M2.1-highspeed")).toBe(true);
    expect(ADAPTIVE_THINKING_MODELS.has("MiniMax-M2")).toBe(true);
  });

  it("does NOT contain M2-her (not in MiniMax docs)", () => {
    expect(ADAPTIVE_THINKING_MODELS.has("MiniMax-M2-her")).toBe(false);
  });
});

describe("M3 max_completion_tokens default", () => {
  it("sets max_completion_tokens=131072 when caller omits it (M3)", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M3", messages: [] };
    resolveModel(db, "MiniMax-M3", body).bodyTransform(body);
    expect(body.max_completion_tokens).toBe(131072);
  });

  it("respects caller-provided max_completion_tokens", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M3", messages: [], max_completion_tokens: 8192 };
    resolveModel(db, "MiniMax-M3", body).bodyTransform(body);
    expect(body.max_completion_tokens).toBe(8192);
  });

  it("does NOT default for non-M3 models", () => {
    const db = openDb();
    const body: any = { model: "MiniMax-M2.7", messages: [] };
    resolveModel(db, "MiniMax-M2.7", body).bodyTransform(body);
    expect(body.max_completion_tokens).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/providers/alias.test.ts`
Expected: FAIL — `ADAPTIVE_THINKING_MODELS` and `LEGACY_MODEL_ALIASES` are not exported, and the `thinking.type` expectation is `"enabled"` from old code, not `"adaptive"`.

- [ ] **Step 3: Rewrite `alias.ts`**

Edit `src/providers/alias.ts`. Replace the entire file with:

```ts
import type Database from "better-sqlite3";
import { getModel, type Model } from "../db/repos/models.js";
import { getSetting } from "../db/repos/settings.js";

/**
 * Models that the MiniMax reference docs (docs/minimax-reference/) list as
 * supporting thinking. The router injects `thinking: { type: "adaptive" }`
 * for these models when the client has not already set `thinking`. Add a
 * model here when upstream ships a new thinking-capable variant.
 */
export const ADAPTIVE_THINKING_MODELS: ReadonlySet<string> = new Set([
  "MiniMax-M3",
  "MiniMax-M2.7",
  "MiniMax-M2.7-highspeed",
  "MiniMax-M2.5",
  "MiniMax-M2.5-highspeed",
  "MiniMax-M2.1",
  "MiniMax-M2.1-highspeed",
  "MiniMax-M2",
]);

/**
 * Retired built-in model names. Requests for these names resolve to their
 * modern equivalent so older clients keep working. Logged at warn-level on
 * first hit per process so production dashboards can surface migrations.
 */
export const LEGACY_MODEL_ALIASES: Record<string, string> = {
  "MiniMax-M2.7-thinking": "MiniMax-M2.7",
  "MiniMax-M3-thinking": "MiniMax-M3",
};

const legacyWarned = new Set<string>();
function warnLegacyOnce(name: string, target: string): void {
  if (legacyWarned.has(name)) return;
  legacyWarned.add(name);
  console.warn(`[alias] legacy model '${name}' → '${target}' (will be removed in a future release)`);
}

export interface ResolvedModel {
  upstreamModel: string;
  bodyTransform: (body: any) => void;
}

export function resolveModel(db: Database.Database, requestedName: string, _body: any): ResolvedModel {
  const target = LEGACY_MODEL_ALIASES[requestedName] ?? requestedName;
  if (target !== requestedName) warnLegacyOnce(requestedName, target);

  const model: Model | null = getModel(db, target);
  if (!model) throw new Error(`unknown model: ${requestedName}`);
  if (!model.enabled) throw new Error(`model disabled: ${requestedName}`);

  const minimaxSettings = getSetting<{ m3DefaultMaxCompletionTokens?: number }>(db, "minimax");
  const m3DefaultMax = minimaxSettings?.m3DefaultMaxCompletionTokens ?? 131072;

  return {
    upstreamModel: model.upstream_model,
    bodyTransform: (b: any) => {
      // Inject adaptive thinking for docs-listed models when the client
      // didn't set `thinking` themselves. The model itself decides whether
      // to think on each turn (per upstream docs).
      if (ADAPTIVE_THINKING_MODELS.has(model.upstream_model) && b.thinking === undefined) {
        b.thinking = { type: "adaptive" };
      }
      // M3: default max_completion_tokens if caller didn't set one
      if (model.name === "MiniMax-M3" && b.max_completion_tokens === undefined && b.max_tokens === undefined) {
        b.max_completion_tokens = m3DefaultMax;
      }
      // reasoning_split auto-on whenever thinking is present (router- or
      // client-injected). Explicit client value still wins.
      if (b.thinking && b.reasoning_split === undefined) {
        b.reasoning_split = true;
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/providers/alias.test.ts`
Expected: PASS — all 16 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/providers/alias.ts src/providers/alias.test.ts
git commit -m "feat(alias): adaptive thinking for docs-listed models, legacy -thinking aliases"
```

---

### Task 5: Admin API + server tests

**Files:**
- Modify: `src/api/admin/models.ts`
- Modify: `src/server.test.ts`

- [ ] **Step 1: Update `src/api/admin/models.ts`**

Edit `src/api/admin/models.ts`. In the `modelRoutes.get("/")` handler, change the response mapper from:

```ts
    return c.json(listModels(db, { includeDisabled: true }).map(m => ({
      name: m.name, displayName: m.display_name, family: m.family,
      contextWindow: m.context_window, thinkingEnabled: !!m.thinking_enabled,
      source: m.source, enabled: !!m.enabled,
    })));
```

to:

```ts
    return c.json(listModels(db, { includeDisabled: true }).map(m => ({
      name: m.name, displayName: m.display_name, family: m.family,
      contextWindow: m.context_window,
      source: m.source, enabled: !!m.enabled,
    })));
```

- [ ] **Step 2: Update `src/server.test.ts` M3-thinking rewrite test**

Edit `src/server.test.ts`. Find the `it("rewrites MiniMax-M3-thinking to upstream MiniMax-M3 with thinking block", ...)` test. Replace its body with:

```ts
  it("rewrites legacy MiniMax-M3-thinking to upstream MiniMax-M3 with adaptive thinking", async () => {
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
    expect(sentBody.thinking).toEqual({ type: "adaptive" });
    expect(sentBody.reasoning_split).toBe(true);
  });
```

- [ ] **Step 3: Run the full server test suite**

Run: `npx vitest run src/server.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 4: Commit**

```bash
git add src/api/admin/models.ts src/server.test.ts
git commit -m "feat(api): drop thinkingEnabled from /api/admin/models; update M3-thinking test to adaptive"
```

---

### Task 6: `src/server.ts` — drop `reasoningSplitDefault` from settings handler

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Edit settings handler**

In `src/server.ts`, find the `app.post("/admin/settings/minimax", requireAdmin, async (c) => { ... })` block. Replace the body with:

```ts
  const body = await c.req.parseBody();
  const current = (getSetting(c.get("db"), "minimax") as Record<string, unknown> | null) ?? {};
  const next = {
    ...current,
    upstreamFormat: String((body as Record<string, string>).upstreamFormat ?? "auto"),
    m3DefaultMaxCompletionTokens: Number((body as Record<string, string>).m3DefaultMaxCompletionTokens ?? 131072),
  };
  setSetting(c.get("db"), "minimax", next);
  return c.redirect("/admin/settings");
```

(Removes the `reasoningSplitDefault` field — the global setting is gone, and the form field no longer exists in the UI.)

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "refactor(server): drop reasoningSplitDefault from /admin/settings/minimax handler"
```

---

### Task 7: `scripts/seed-models.ts` — drop `M2.7-thinking`, drop field

**Files:**
- Modify: `scripts/seed-models.ts`

- [ ] **Step 1: Replace the SEED array**

Edit `scripts/seed-models.ts`. Replace the entire `SEED` array (and only the array) with:

```ts
const SEED: Array<Parameters<typeof upsertModel>[1]> = [
  { name: "MiniMax-M3",            upstream_model: "MiniMax-M3",            display_name: "MiniMax M3",             family: "m3",   context_window: 1000000, pricing_input: 0.60, pricing_output: 2.40, pricing_cache_read: 0.12, pricing_cache_write: null, pricing_tiers: '{"base":{"input":0.60,"output":2.40,"cacheRead":0.12,"cacheWrite":null},"high":{"input":1.20,"output":4.80,"cacheRead":0.24,"cacheWrite":null},"promotional":{"input":0.30,"output":1.20,"cacheRead":0.06,"cacheWrite":null}}', source: "builtin" },
  { name: "MiniMax-M2.7",          upstream_model: "MiniMax-M2.7",          display_name: "MiniMax M2.7",           family: "m2.7", context_window: 204800, pricing_input: 0.30, pricing_output: 1.20, pricing_cache_read: 0.06, pricing_cache_write: 0.375, source: "builtin" },
  { name: "MiniMax-M2.7-highspeed",upstream_model: "MiniMax-M2.7-highspeed",display_name: "MiniMax M2.7 highspeed", family: "m2.7", context_window: 204800, pricing_input: 0.60, pricing_output: 2.40, pricing_cache_read: 0.06, pricing_cache_write: 0.375, source: "builtin" },
  { name: "MiniMax-M2.5",          upstream_model: "MiniMax-M2.5",          display_name: "MiniMax M2.5",           family: "m2.5", context_window: 204800, pricing_input: 0.30, pricing_output: 1.20, pricing_cache_read: 0.03, pricing_cache_write: 0.375, source: "builtin" },
  { name: "MiniMax-M2.5-highspeed",upstream_model: "MiniMax-M2.5-highspeed",display_name: "MiniMax M2.5 highspeed", family: "m2.5", context_window: 204800, pricing_input: 0.60, pricing_output: 2.40, pricing_cache_read: 0.03, pricing_cache_write: 0.375, source: "builtin" },
  { name: "MiniMax-M2.1",          upstream_model: "MiniMax-M2.1",          display_name: "MiniMax M2.1",           family: "m2.1", context_window: 204800, pricing_input: 0.30, pricing_output: 1.20, pricing_cache_read: 0.03, pricing_cache_write: 0.375, source: "builtin" },
  { name: "MiniMax-M2.1-highspeed",upstream_model: "MiniMax-M2.1-highspeed",display_name: "MiniMax M2.1 highspeed", family: "m2.1", context_window: 204800, pricing_input: 0.60, pricing_output: 2.40, pricing_cache_read: 0.03, pricing_cache_write: 0.375, source: "builtin" },
  { name: "MiniMax-M2",            upstream_model: "MiniMax-M2",            display_name: "MiniMax M2",             family: "m2",   context_window: 204800, pricing_input: 0.30, pricing_output: 1.20, pricing_cache_read: 0.03, pricing_cache_write: 0.375, source: "builtin" },
  { name: "MiniMax-M2-her",        upstream_model: "MiniMax-M2-her",        display_name: "MiniMax M2-her (roleplay)", family: "m2-her", context_window: 64000, pricing_input: null as unknown as number, pricing_output: null as unknown as number, pricing_cache_read: null as unknown as number, pricing_cache_write: null as unknown as number, source: "builtin" },
];
```

(The rest of the file is unchanged.)

- [ ] **Step 2: Verify seed count**

Run: `npm run reset && npm run seed-models`
Expected: prints `Seeded 9 models (... new, ... updated).` (exact split depends on existing DB).

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-models.ts
git commit -m "feat(seed): drop M2.7-thinking row, drop thinking_enabled field"
```

---

### Task 8: Frontend `client/src/pages/Models.tsx` — drop Thinking column

**Files:**
- Modify: `client/src/pages/Models.tsx`

- [ ] **Step 1: Update `Model` interface and table**

Edit `client/src/pages/Models.tsx`. Change the `Model` interface to:

```ts
interface Model { name: string; displayName: string | null; family: string | null; contextWindow: number | null; source: string; enabled: boolean; }
```

In the `<thead>`, change the row to:

```tsx
<thead><tr><th>Name</th><th>Display</th><th>Family</th><th>Context</th><th>Source</th><th>Status</th></tr></thead>
```

In the `<tbody>` `<tr>`, change the row to:

```tsx
<tr key={m.name}>
  <td class="mono">{m.name}</td>
  <td>{m.displayName ?? "—"}</td>
  <td>{m.family ?? "—"}</td>
  <td>{m.contextWindow ?? "—"}</td>
  <td><Badge variant={m.source === "builtin" ? "muted" : "active"}>{m.source}</Badge></td>
  <td>
    <Switch checked={m.enabled} onChange={() => toggleMut.mutate({ name: m.name, enabled: m.enabled })} label={m.enabled ? "on" : "off"} />
  </td>
</tr>
```

- [ ] **Step 2: Update skeleton columns**

Change `<TableSkeleton rows={5} cols={7} />` to `<TableSkeleton rows={5} cols={6} />`.

- [ ] **Step 3: Typecheck the client**

Run: `cd client && npm run typecheck`
Expected: PASS (no errors about `thinkingEnabled`).

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Models.tsx
git commit -m "feat(ui): drop Thinking column from Models page"
```

---

### Task 9: Full verification

- [ ] **Step 1: Run the entire test suite**

Run: `npm test`
Expected: all tests pass. The previous test count was 251+; expect 251+ minus the deleted assertions plus new ones. Net: roughly the same.

- [ ] **Step 2: Typecheck everything**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 3: Manual smoke test — confirm a real DB upgrade still works**

Run: `npm run dev` (with an existing `~/.local/share/kelola-router/router.db` if you have one).
Expected: server starts, logs `[db] applied migration 6: drop_thinking_fields` once. Open `GET /api/admin/models` and confirm 9 rows, no `-thinking` suffix anywhere.

If you don't have an existing DB, run `npm run reset && npm run dev` and confirm the same: 9 rows.

- [ ] **Step 4: Manual smoke test — legacy alias still works**

In a fresh terminal, `curl -X POST` against `/v1/chat/completions` with `model: "MiniMax-M2.7-thinking"` (use a real client key). Inspect the upstream body via the response or a network capture. Expect: `model: "MiniMax-M2.7"`, `thinking: { type: "adaptive" }`, `reasoning_split: true`.

- [ ] **Step 5: Final commit if any straggler**

If any docs or straggler files reference `thinking_enabled` / `M2.7-thinking` / `M3-thinking` rows in non-test code, fix and commit. Otherwise, no commit.

---

## Self-Review

**Spec coverage:**
- Drop `M3-thinking` & `M2.7-thinking` built-in rows → Task 1, Task 3, Task 7
- Drop `thinking_enabled` & `thinking_budget` columns → Task 1, Task 2
- Allowlist for adaptive injection → Task 4
- `reasoning_split` auto-on when `thinking` present → Task 4
- Legacy `-thinking` alias → Task 4
- Admin API: drop `thinkingEnabled` → Task 5
- Dashboard UI: drop Thinking column → Task 8
- Server settings handler: drop `reasoningSplitDefault` → Task 6
- Tests updated → Tasks 2, 3, 4, 5
- M3 still gets `max_completion_tokens=131072` default → Task 4 (preserved)

**Placeholder scan:** No TBD/TODO. Every step has concrete code.

**Type consistency:** `ADAPTIVE_THINKING_MODELS`, `LEGACY_MODEL_ALIASES` exported from `alias.ts`; tests import them by the same name. `Model` interface fields match between `models.ts` and `upsertModel` SQL. `M3` detection uses `model.name === "MiniMax-M3"` (unchanged from prior code).

**Risks noted in spec:** All addressed.
