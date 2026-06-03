# User-Defined Model Aliases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-editable model alias system — admins define `claude-opus-4-8 → MiniMax-M3` (etc.) from a new dashboard page, and the proxy resolves aliases transparently.

**Architecture:** New `model_aliases` table + in-memory alias cache consulted by `resolveModel` + admin API + new `Aliases` dashboard page + alias-count badge on `Models` page. Legacy `LEGACY_MODEL_ALIASES` constant removed (dead code).

**Tech Stack:** Hono, better-sqlite3, Preact + react-query, vitest. TypeScript strict.

---

## File Map

**New files:**
- `src/db/migrations/007-model-aliases.ts` — schema migration
- `src/db/repos/aliases.ts` — repo layer
- `src/providers/aliasCache.ts` — in-memory cache + invalidation
- `src/api/admin/aliases.ts` — admin API routes
- `client/src/pages/Aliases.tsx` — new dashboard page
- `tests/db/migration-007-model-aliases.test.ts` — migration test
- `tests/db/repos/aliases.test.ts` — repo unit tests
- `src/providers/aliasCache.test.ts` — cache unit tests
- `src/providers/alias.test.ts` — extend existing (drop legacy tests, add `requestedModel`)
- `tests/api/admin/aliases.test.ts` — admin API integration tests
- `tests/integration/proxy-alias.test.ts` — end-to-end proxy + log test

**Modified files:**
- `src/db/migrations/index.ts` — register migration 007
- `src/providers/alias.ts` — drop `LEGACY_MODEL_ALIASES` + `warnLegacyOnce`; use `resolveAlias`; add `requestedModel` to `ResolvedModel`
- `src/api/admin/index.ts` — mount `aliasRoutes`
- `src/api/admin/models.ts` — include `aliasCount` per row
- `src/server.ts` — write `resolved.requestedModel` to `request_logs.requested_model`
- `src/db/repos/requestLogs.ts` — accept new optional `requested_model` field
- `client/src/layout/Sidebar.tsx` — add Aliases nav item
- `client/src/layout/AppShell.tsx` — register route + keyboard shortcut + help
- `client/src/pages/Models.tsx` — add Aliases column
- `client/src/components/Icon.tsx` — add `aliases` glyph

---

## Task 1: Migration 007 — `model_aliases` table + `requested_model` column

**Files:**
- Create: `src/db/migrations/007-model-aliases.ts`
- Modify: `src/db/migrations/index.ts:6` (add import + register)
- Test: `tests/db/migration-007-model-aliases.test.ts`

- [ ] **Step 1: Write the failing migration test**

Create `tests/db/migration-007-model-aliases.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { migrate } from "../../src/db/migrations/index.js";

let db: Database.Database;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "router-test-"));
  db = new Database(join(dir, "t.db"));
  db.pragma("foreign_keys = ON");
  migrate(db);
});

afterEach(() => { db.close(); rmSync(dir, { recursive: true }); });

describe("migration 007", () => {
  it("creates model_aliases table with expected columns", () => {
    const cols = db.prepare("PRAGMA table_info(model_aliases)").all() as Array<{ name: string; notnull: number; pk: number }>;
    const names = cols.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(["alias_name", "upstream_model", "label", "source", "created_at"]));
    const pk = cols.find(c => c.name === "alias_name");
    expect(pk?.pk).toBe(1);
  });

  it("creates idx_model_aliases_target index", () => {
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_model_aliases_target'").get();
    expect(idx).toBeDefined();
  });

  it("adds requested_model column to request_logs", () => {
    const cols = db.prepare("PRAGMA table_info(request_logs)").all() as Array<{ name: string }>;
    expect(cols.map(c => c.name)).toContain("requested_model");
  });

  it("FK cascades when upstream model is deleted", () => {
    db.prepare(`INSERT INTO models (name, upstream_model, source) VALUES ('m1', 'm1-up', 'manual')`).run();
    db.prepare(`INSERT INTO model_aliases (alias_name, upstream_model) VALUES ('a1', 'm1-up')`).run();
    db.prepare(`DELETE FROM models WHERE name = 'm1'`).run();
    const row = db.prepare(`SELECT * FROM model_aliases WHERE alias_name = 'a1'`).get();
    expect(row).toBeUndefined();
  });

  it("is idempotent on re-run (migrate twice)", () => {
    const userVersionBefore = Number(db.pragma("user_version", { simple: true }));
    migrate(db);
    const userVersionAfter = Number(db.pragma("user_version", { simple: true }));
    expect(userVersionAfter).toBe(userVersionBefore);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/db/migration-007-model-aliases.test.ts`
Expected: FAIL — module `007-model-aliases` does not exist (or table missing).

- [ ] **Step 3: Create the migration file**

Create `src/db/migrations/007-model-aliases.ts`:

```ts
import type Database from "better-sqlite3";

/**
 * Add the user-defined model alias table and a column on request_logs to
 * preserve the client-requested model name alongside the resolved upstream
 * model. Used by the new Aliases dashboard page.
 */
export const migration_007 = {
  id: 7,
  name: "model_aliases",
  sql: `
    CREATE TABLE IF NOT EXISTS model_aliases (
      alias_name      TEXT PRIMARY KEY,
      upstream_model  TEXT NOT NULL,
      label           TEXT,
      source          TEXT NOT NULL DEFAULT 'user',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (upstream_model) REFERENCES models(upstream_model) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_model_aliases_target ON model_aliases(upstream_model);
    ALTER TABLE request_logs ADD COLUMN requested_model TEXT;
  `,
};
```

- [ ] **Step 4: Register the migration**

Edit `src/db/migrations/index.ts`:

- Replace line 6:
  ```ts
  import { migration_006 } from "./006-drop-thinking-fields.js";
  ```
  with:
  ```ts
  import { migration_006 } from "./006-drop-thinking-fields.js";
  import { migration_007 } from "./007-model-aliases.js";
  ```
- Replace line 14:
  ```ts
  const ALL_MIGRATIONS = [migration_001, migration_002, migration_003, migration_004, migration_005, migration_006];
  ```
  with:
  ```ts
  const ALL_MIGRATIONS = [migration_001, migration_002, migration_003, migration_004, migration_005, migration_006, migration_007];
  ```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/db/migration-007-model-aliases.test.ts`
Expected: 5/5 pass.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/007-model-aliases.ts src/db/migrations/index.ts tests/db/migration-007-model-aliases.test.ts
git -c user.name="kelola-router" -c user.email="bot@local" commit -m "feat(db): migration 007 — model_aliases table + requested_model column"
```

---

## Task 2: Repo layer — `src/db/repos/aliases.ts`

**Files:**
- Create: `src/db/repos/aliases.ts`
- Test: `tests/db/repos/aliases.test.ts`

- [ ] **Step 1: Write the failing repo test**

Create `tests/db/repos/aliases.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { migrate } from "../../../src/db/migrations/index.js";
import { upsertModel } from "../../../src/db/repos/models.js";
import {
  listAliases, getAlias, upsertAlias, deleteAlias, listAliasesForTargets, AliasConflictError,
} from "../../../src/db/repos/aliases.js";

let db: Database.Database;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "alias-repo-"));
  db = new Database(join(dir, "t.db"));
  db.pragma("foreign_keys = ON");
  migrate(db);
  upsertModel(db, { name: "MiniMax-M3", upstream_model: "MiniMax-M3" });
  upsertModel(db, { name: "MiniMax-M2.7", upstream_model: "MiniMax-M2.7" });
});

afterEach(() => { db.close(); rmSync(dir, { recursive: true }); });

describe("aliases repo", () => {
  it("upsertAlias inserts new row and returns it", () => {
    const row = upsertAlias(db, { aliasName: "claude-opus-4-8", upstreamModel: "MiniMax-M3" });
    expect(row.aliasName).toBe("claude-opus-4-8");
    expect(row.upstreamModel).toBe("MiniMax-M3");
    expect(row.source).toBe("user");
    expect(row.createdAt).toBeTruthy();
  });

  it("upsertAlias overwrites existing alias with same name", () => {
    upsertAlias(db, { aliasName: "a1", upstreamModel: "MiniMax-M3" });
    const row = upsertAlias(db, { aliasName: "a1", upstreamModel: "MiniMax-M2.7" });
    expect(row.upstreamModel).toBe("MiniMax-M2.7");
    expect(listAliases(db)).toHaveLength(1);
  });

  it("upsertAlias accepts null label", () => {
    const row = upsertAlias(db, { aliasName: "a1", upstreamModel: "MiniMax-M3", label: null });
    expect(row.label).toBeNull();
  });

  it("upsertAlias rejects alias name that collides with a real model name", () => {
    expect(() => upsertAlias(db, { aliasName: "MiniMax-M3", upstreamModel: "MiniMax-M3" }))
      .toThrow(AliasConflictError);
  });

  it("getAlias returns null for missing", () => {
    expect(getAlias(db, "nope")).toBeNull();
  });

  it("getAlias returns row for hit", () => {
    upsertAlias(db, { aliasName: "a1", upstreamModel: "MiniMax-M3" });
    expect(getAlias(db, "a1")?.upstreamModel).toBe("MiniMax-M3");
  });

  it("listAliases returns all rows", () => {
    upsertAlias(db, { aliasName: "a1", upstreamModel: "MiniMax-M3" });
    upsertAlias(db, { aliasName: "a2", upstreamModel: "MiniMax-M2.7" });
    const rows = listAliases(db);
    expect(rows).toHaveLength(2);
  });

  it("deleteAlias returns true on hit, false on miss", () => {
    upsertAlias(db, { aliasName: "a1", upstreamModel: "MiniMax-M3" });
    expect(deleteAlias(db, "a1")).toBe(true);
    expect(deleteAlias(db, "nope")).toBe(false);
  });

  it("listAliasesForTargets groups by upstream_model", () => {
    upsertAlias(db, { aliasName: "a1", upstreamModel: "MiniMax-M3" });
    upsertAlias(db, { aliasName: "a2", upstreamModel: "MiniMax-M3" });
    upsertAlias(db, { aliasName: "a3", upstreamModel: "MiniMax-M2.7" });
    const grouped = listAliasesForTargets(db, ["MiniMax-M3", "MiniMax-M2.7"]);
    expect(grouped["MiniMax-M3"]).toHaveLength(2);
    expect(grouped["MiniMax-M2.7"]).toHaveLength(1);
  });

  it("listAliasesForTargets with empty input returns empty object", () => {
    upsertAlias(db, { aliasName: "a1", upstreamModel: "MiniMax-M3" });
    expect(listAliasesForTargets(db, [])).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/db/repos/aliases.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the repo implementation**

Create `src/db/repos/aliases.ts`:

```ts
import type Database from "better-sqlite3";
import { getModel } from "./models.js";

export interface ModelAlias {
  aliasName: string;
  upstreamModel: string;
  label: string | null;
  source: string;
  createdAt: string;
}

export class AliasConflictError extends Error {
  constructor(public aliasName: string) {
    super(`alias name conflicts with real model: ${aliasName}`);
    this.name = "AliasConflictError";
  }
}

export interface UpsertAliasArgs {
  aliasName: string;
  upstreamModel: string;
  label?: string | null;
  source?: string;
}

function rowToAlias(r: Record<string, unknown>): ModelAlias {
  return {
    aliasName: r.alias_name as string,
    upstreamModel: r.upstream_model as string,
    label: (r.label as string | null) ?? null,
    source: r.source as string,
    createdAt: r.created_at as string,
  };
}

export function listAliases(db: Database.Database): ModelAlias[] {
  const rows = db.prepare(`SELECT * FROM model_aliases ORDER BY created_at, alias_name`).all() as Record<string, unknown>[];
  return rows.map(rowToAlias);
}

export function getAlias(db: Database.Database, name: string): ModelAlias | null {
  const row = db.prepare(`SELECT * FROM model_aliases WHERE alias_name = ?`).get(name) as Record<string, unknown> | undefined;
  return row ? rowToAlias(row) : null;
}

export function upsertAlias(db: Database.Database, args: UpsertAliasArgs): ModelAlias {
  const name = args.aliasName;
  // Reject if alias name collides with a real model name
  if (getModel(db, name)) {
    throw new AliasConflictError(name);
  }
  const existing = getAlias(db, name);
  if (existing) {
    db.prepare(`
      UPDATE model_aliases
         SET upstream_model = ?, label = ?
       WHERE alias_name = ?
    `).run(args.upstreamModel, args.label ?? null, name);
  } else {
    db.prepare(`
      INSERT INTO model_aliases (alias_name, upstream_model, label, source)
      VALUES (?, ?, ?, ?)
    `).run(name, args.upstreamModel, args.label ?? null, args.source ?? "user");
  }
  const row = getAlias(db, name);
  if (!row) throw new Error("upsertAlias: row missing post-write");
  return row;
}

export function deleteAlias(db: Database.Database, name: string): boolean {
  const r = db.prepare(`DELETE FROM model_aliases WHERE alias_name = ?`).run(name);
  return r.changes > 0;
}

export function listAliasesForTargets(
  db: Database.Database,
  upstreamNames: string[],
): Record<string, ModelAlias[]> {
  const out: Record<string, ModelAlias[]> = {};
  if (upstreamNames.length === 0) return out;
  const placeholders = upstreamNames.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT * FROM model_aliases WHERE upstream_model IN (${placeholders}) ORDER BY alias_name`,
  ).all(...upstreamNames) as Record<string, unknown>[];
  for (const r of rows) {
    const a = rowToAlias(r);
    (out[a.upstreamModel] ??= []).push(a);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/db/repos/aliases.test.ts`
Expected: 10/10 pass.

- [ ] **Step 5: Commit**

```bash
git add src/db/repos/aliases.ts tests/db/repos/aliases.test.ts
git -c user.name="kelola-router" -c user.email="bot@local" commit -m "feat(repo): model_aliases repo with conflict check + group-by-target"
```

---

## Task 3: In-memory cache — `src/providers/aliasCache.ts`

**Files:**
- Create: `src/providers/aliasCache.ts`
- Test: `src/providers/aliasCache.test.ts`

- [ ] **Step 1: Write the failing cache test**

Create `src/providers/aliasCache.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { migrate } from "../db/migrations/index.js";
import { upsertModel } from "../db/repos/models.js";
import { upsertAlias } from "../db/repos/aliases.js";
import { resolveAlias, clearAliasCache } from "./aliasCache.js";

let db: Database.Database;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "alias-cache-"));
  db = new Database(join(dir, "t.db"));
  db.pragma("foreign_keys = ON");
  migrate(db);
  upsertModel(db, { name: "MiniMax-M3", upstream_model: "MiniMax-M3" });
  upsertModel(db, { name: "MiniMax-M2.7", upstream_model: "MiniMax-M2.7" });
  clearAliasCache();
});

afterEach(() => { db.close(); rmSync(dir, { recursive: true }); vi.useRealTimers(); });

describe("aliasCache", () => {
  it("returns input unchanged for unknown name", () => {
    expect(resolveAlias(db, "MiniMax-M3")).toBe("MiniMax-M3");
    expect(resolveAlias(db, "totally-unknown")).toBe("totally-unknown");
  });

  it("resolves alias to its target", () => {
    upsertAlias(db, { aliasName: "claude-opus-4-8", upstreamModel: "MiniMax-M3" });
    clearAliasCache();
    expect(resolveAlias(db, "claude-opus-4-8")).toBe("MiniMax-M3");
  });

  it("caches: second call does not re-query DB", () => {
    upsertAlias(db, { aliasName: "a1", upstreamModel: "MiniMax-M3" });
    clearAliasCache();
    resolveAlias(db, "a1");
    // Mutate DB; cache should still return stale value
    db.prepare(`DELETE FROM model_aliases WHERE alias_name = 'a1'`).run();
    expect(resolveAlias(db, "a1")).toBe("MiniMax-M3");
  });

  it("clearAliasCache forces a reload", () => {
    upsertAlias(db, { aliasName: "a1", upstreamModel: "MiniMax-M3" });
    resolveAlias(db, "a1"); // warm cache
    db.prepare(`DELETE FROM model_aliases WHERE alias_name = 'a1'`).run();
    clearAliasCache();
    expect(resolveAlias(db, "a1")).toBe("a1");
  });

  it("TTL expiry forces a reload", () => {
    upsertAlias(db, { aliasName: "a1", upstreamModel: "MiniMax-M3" });
    resolveAlias(db, "a1"); // warm cache
    db.prepare(`DELETE FROM model_aliases WHERE alias_name = 'a1'`).run();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31_000); // past 30s TTL
    expect(resolveAlias(db, "a1")).toBe("a1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/providers/aliasCache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the cache module**

Create `src/providers/aliasCache.ts`:

```ts
import type Database from "better-sqlite3";
import { listAliases } from "../db/repos/aliases.js";

type Cache = { map: Map<string, string>; loadedAt: number };
let cache: Cache | null = null;
const TTL_MS = 30_000;

export function resolveAlias(db: Database.Database, name: string): string {
  const now = Date.now();
  if (!cache || now - cache.loadedAt > TTL_MS) {
    const map = new Map<string, string>();
    for (const a of listAliases(db)) map.set(a.aliasName, a.upstreamModel);
    cache = { map, loadedAt: now };
  }
  return cache.map.get(name) ?? name;
}

export function clearAliasCache(): void { cache = null; }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/providers/aliasCache.test.ts`
Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/providers/aliasCache.ts src/providers/aliasCache.test.ts
git -c user.name="kelola-router" -c user.email="bot@local" commit -m "feat(cache): in-memory alias cache with TTL + invalidation hook"
```

---

## Task 4: Refactor `src/providers/alias.ts` — drop legacy, use cache, add `requestedModel`

**Files:**
- Modify: `src/providers/alias.ts` (delete `LEGACY_MODEL_ALIASES` + `warnLegacyOnce`; swap to `resolveAlias`; add `requestedModel`)
- Modify/verify: `src/providers/alias.test.ts` (drop legacy tests; add `requestedModel` assertions)
- Run: full test suite to confirm no stragglers reference legacy names

- [ ] **Step 1: Read the existing alias test (if any) and any tests referencing the legacy names**

Run:
```bash
git grep -nE 'LEGACY_MODEL_ALIASES|MiniMax-M[23]\.7?-thinking' src tests scripts
```
Expected output: lists every reference. Most should be in `src/providers/alias.ts`, possibly in `src/providers/alias.test.ts`. Note locations.

If `src/providers/alias.test.ts` doesn't exist, create it fresh in Step 3. If it does, read it first.

- [ ] **Step 2: Write updated `src/providers/alias.test.ts`**

Overwrite `src/providers/alias.test.ts` (or create it):

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { migrate } from "../db/migrations/index.js";
import { upsertModel, enableModel, disableModel } from "../db/repos/models.js";
import { upsertAlias } from "../db/repos/aliases.js";
import { resolveModel } from "./alias.js";
import { clearAliasCache } from "./aliasCache.js";

let db: Database.Database;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "alias-"));
  db = new Database(join(dir, "t.db"));
  db.pragma("foreign_keys = ON");
  migrate(db);
  upsertModel(db, { name: "MiniMax-M3", upstream_model: "MiniMax-M3" });
  upsertModel(db, { name: "MiniMax-M2.7", upstream_model: "MiniMax-M2.7" });
  clearAliasCache();
});

afterEach(() => { db.close(); rmSync(dir, { recursive: true }); });

describe("resolveModel", () => {
  it("resolves direct name and returns requestedModel = input", () => {
    const r = resolveModel(db, "MiniMax-M3", {});
    expect(r.upstreamModel).toBe("MiniMax-M3");
    expect(r.requestedModel).toBe("MiniMax-M3");
  });

  it("resolves alias and returns requestedModel = original alias", () => {
    upsertAlias(db, { aliasName: "claude-opus-4-8", upstreamModel: "MiniMax-M3" });
    clearAliasCache();
    const r = resolveModel(db, "claude-opus-4-8", {});
    expect(r.upstreamModel).toBe("MiniMax-M3");
    expect(r.requestedModel).toBe("claude-opus-4-8");
  });

  it("throws for unknown direct name", () => {
    expect(() => resolveModel(db, "does-not-exist", {})).toThrow(/unknown model/);
  });

  it("throws for unknown alias target", () => {
    upsertAlias(db, { aliasName: "broken", upstreamModel: "does-not-exist" });
    clearAliasCache();
    expect(() => resolveModel(db, "broken", {})).toThrow(/unknown model/);
  });

  it("throws for disabled target model", () => {
    disableModel(db, "MiniMax-M3");
    expect(() => resolveModel(db, "MiniMax-M3", {})).toThrow(/model disabled/);
  });

  it("throws for disabled target model reached via alias", () => {
    upsertAlias(db, { aliasName: "opus", upstreamModel: "MiniMax-M3" });
    clearAliasCache();
    disableModel(db, "MiniMax-M3");
    expect(() => resolveModel(db, "opus", {})).toThrow(/model disabled/);
  });

  it("bodyTransform injects adaptive thinking for known models when client omits thinking", () => {
    const r = resolveModel(db, "MiniMax-M3", {});
    const body: any = {};
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: "adaptive" });
  });

  it("bodyTransform preserves client-supplied thinking", () => {
    const r = resolveModel(db, "MiniMax-M3", {});
    const body: any = { thinking: { type: "disabled" } };
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: "disabled" });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/providers/alias.test.ts`
Expected: FAIL — `resolved.requestedModel` doesn't exist on the old interface.

- [ ] **Step 4: Refactor `src/providers/alias.ts`**

Replace the entire `src/providers/alias.ts` file with:

```ts
import type Database from "better-sqlite3";
import { getModel, type Model } from "../db/repos/models.js";
import { getSetting } from "../db/repos/settings.js";
import { resolveAlias } from "./aliasCache.js";

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

export interface ResolvedModel {
  upstreamModel: string;
  bodyTransform: (body: any) => void;
  requestedModel: string;
}

export function resolveModel(db: Database.Database, requestedName: string, _body: any): ResolvedModel {
  const target = resolveAlias(db, requestedName);
  const model: Model | null = getModel(db, target);
  if (!model) throw new Error(`unknown model: ${requestedName}`);
  if (!model.enabled) throw new Error(`model disabled: ${requestedName}`);

  const minimaxSettings = getSetting<{ m3DefaultMaxCompletionTokens?: number }>(db, "minimax");
  const m3DefaultMax = minimaxSettings?.m3DefaultMaxCompletionTokens ?? 131072;

  return {
    upstreamModel: model.upstream_model,
    requestedModel: requestedName,
    bodyTransform: (b: any) => {
      if (ADAPTIVE_THINKING_MODELS.has(model.upstream_model) && b.thinking === undefined) {
        b.thinking = { type: "adaptive" };
      }
      if (model.name === "MiniMax-M3" && b.max_completion_tokens === undefined && b.max_tokens === undefined) {
        b.max_completion_tokens = m3DefaultMax;
      }
      if (b.thinking && b.reasoning_split === undefined) {
        b.reasoning_split = true;
      }
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/providers/alias.test.ts`
Expected: 8/8 pass.

- [ ] **Step 6: Run the full test suite to catch any stragglers**

Run: `npm test`
Expected: 251 + new tests pass. If anything references the deleted `LEGACY_MODEL_ALIASES` constant, fix it now.

- [ ] **Step 7: Commit**

```bash
git add src/providers/alias.ts src/providers/alias.test.ts
git -c user.name="kelola-router" -c user.email="bot@local" commit -m "refactor(alias): drop LEGACY_MODEL_ALIASES, use DB-backed cache, add requestedModel"
```

---

## Task 5: Admin API — `src/api/admin/aliases.ts`

**Files:**
- Create: `src/api/admin/aliases.ts`
- Modify: `src/api/admin/index.ts:11-12` (import + mount)
- Test: `tests/api/admin/aliases.test.ts`

- [ ] **Step 1: Write the failing API test**

Create `tests/api/admin/aliases.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";
import { migrate } from "../../../src/db/migrations/index.js";
import { adminApi } from "../../../src/api/admin/index.js";
import { setPassword } from "../../../src/auth/password.js";
import { createSession } from "../../../src/auth/session.js";
import { SESSION_COOKIE } from "../../../src/auth.js";
import { upsertModel } from "../../../src/db/repos/models.js";
import { clearAliasCache } from "../../../src/providers/aliasCache.js";

let db: Database.Database;
let dir: string;
let app: Hono;
let cookie: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "alias-api-"));
  db = new Database(join(dir, "t.db"));
  db.pragma("foreign_keys = ON");
  migrate(db);
  upsertModel(db, { name: "MiniMax-M3", upstream_model: "MiniMax-M3" });
  upsertModel(db, { name: "MiniMax-M2.7", upstream_model: "MiniMax-M2.7" });
  setPassword(db, "testpass");
  const sess = createSession(db);
  cookie = `${SESSION_COOKIE}=${sess.id}`;
  app = new Hono();
  app.use("*", async (c, next) => { c.set("db", db); await next(); });
  app.route("/api", adminApi(db));
  clearAliasCache();
});

afterEach(() => { db.close(); rmSync(dir, { recursive: true }); vi.restoreAllMocks(); });

const baseHeaders = () => ({
  cookie,
  origin: "http://localhost:20137",
  host: "localhost:20137",
  "content-type": "application/json",
});

describe("GET /api/admin/aliases", () => {
  it("returns empty list initially", async () => {
    const res = await app.request("/api/admin/aliases", { headers: baseHeaders() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ aliases: [] });
  });
});

describe("POST /api/admin/aliases", () => {
  it("creates a new alias and returns 201 with row", async () => {
    const res = await app.request("/api/admin/aliases", {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ aliasName: "claude-opus-4-8", upstreamModel: "MiniMax-M3" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.aliasName).toBe("claude-opus-4-8");
    expect(body.upstreamModel).toBe("MiniMax-M3");
  });

  it("rejects alias name that collides with a real model (409)", async () => {
    const res = await app.request("/api/admin/aliases", {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ aliasName: "MiniMax-M3", upstreamModel: "MiniMax-M2.7" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("alias_conflicts_with_model");
  });

  it("rejects unknown upstream target (400)", async () => {
    const res = await app.request("/api/admin/aliases", {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ aliasName: "x", upstreamModel: "no-such-model" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("unknown_target_model");
  });

  it("rejects invalid alias name (400)", async () => {
    const res = await app.request("/api/admin/aliases", {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ aliasName: "has spaces", upstreamModel: "MiniMax-M3" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_alias_name");
  });

  it("overwrites existing alias with same name", async () => {
    await app.request("/api/admin/aliases", {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ aliasName: "a1", upstreamModel: "MiniMax-M3" }),
    });
    const res = await app.request("/api/admin/aliases", {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ aliasName: "a1", upstreamModel: "MiniMax-M2.7" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.upstreamModel).toBe("MiniMax-M2.7");
  });
});

describe("PUT /api/admin/aliases/:name", () => {
  it("updates target and label", async () => {
    await app.request("/api/admin/aliases", {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ aliasName: "a1", upstreamModel: "MiniMax-M3" }),
    });
    const res = await app.request("/api/admin/aliases/a1", {
      method: "PUT",
      headers: baseHeaders(),
      body: JSON.stringify({ upstreamModel: "MiniMax-M2.7", label: "v2" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.upstreamModel).toBe("MiniMax-M2.7");
    expect(body.label).toBe("v2");
  });

  it("returns 404 for missing alias", async () => {
    const res = await app.request("/api/admin/aliases/nope", {
      method: "PUT",
      headers: baseHeaders(),
      body: JSON.stringify({ upstreamModel: "MiniMax-M3" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when new target equals a real model name", async () => {
    await app.request("/api/admin/aliases", {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ aliasName: "a1", upstreamModel: "MiniMax-M3" }),
    });
    const res = await app.request("/api/admin/aliases/a1", {
      method: "PUT",
      headers: baseHeaders(),
      body: JSON.stringify({ upstreamModel: "MiniMax-M2.7" }),
    });
    // not 409 — only when the *alias name* would collide. 200 + target change.
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/admin/aliases/:name", () => {
  it("returns 204 and removes the row", async () => {
    await app.request("/api/admin/aliases", {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ aliasName: "a1", upstreamModel: "MiniMax-M3" }),
    });
    const del = await app.request("/api/admin/aliases/a1", { method: "DELETE", headers: baseHeaders() });
    expect(del.status).toBe(204);
    const list = await app.request("/api/admin/aliases", { headers: baseHeaders() });
    expect((await list.json()).aliases).toHaveLength(0);
  });

  it("returns 404 for missing alias", async () => {
    const res = await app.request("/api/admin/aliases/nope", { method: "DELETE", headers: baseHeaders() });
    expect(res.status).toBe(404);
  });
});

describe("CSRF on /api/admin/aliases", () => {
  it("rejects cross-origin POST (403)", async () => {
    const res = await app.request("/api/admin/aliases", {
      method: "POST",
      headers: { ...baseHeaders(), origin: "https://evil.example" },
      body: JSON.stringify({ aliasName: "x", upstreamModel: "MiniMax-M3" }),
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/api/admin/aliases.test.ts`
Expected: FAIL — route does not exist (404 from Hono).

- [ ] **Step 3: Write the route handler**

Create `src/api/admin/aliases.ts`:

```ts
import { Hono } from "hono";
import type Database from "better-sqlite3";
import { listAliases, getAlias, upsertAlias, deleteAlias, AliasConflictError } from "../../db/repos/aliases.js";
import { getModel } from "../../db/repos/models.js";
import { clearAliasCache } from "../../providers/aliasCache.js";
import { ApiError, handleApiError } from "./middleware.js";

export const aliasRoutes = new Hono();

const NAME_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const LABEL_MAX = 200;

function rowToDto(r: ReturnType<typeof getAlias>) {
  if (!r) return null;
  return {
    aliasName: r.aliasName,
    upstreamModel: r.upstreamModel,
    label: r.label,
    source: r.source,
    createdAt: r.createdAt,
  };
}

function validateName(name: unknown): string {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    throw new ApiError("invalid_alias_name", "alias name must match /^[A-Za-z0-9._:-]{1,128}$/", 400);
  }
  return name;
}

function validateTarget(db: Database.Database, target: unknown): string {
  if (typeof target !== "string" || !target.trim()) {
    throw new ApiError("unknown_target_model", "upstreamModel is required", 400);
  }
  const t = target.trim();
  // Check upstream_model exists in any model row
  const row = db.prepare(`SELECT 1 FROM models WHERE upstream_model = ? LIMIT 1`).get(t);
  if (!row) {
    throw new ApiError("unknown_target_model", `target model not found: ${t}`, 400);
  }
  return t;
}

function validateLabel(label: unknown): string | null {
  if (label === undefined || label === null) return null;
  if (typeof label !== "string") {
    throw new ApiError("invalid_input", "label must be a string", 400);
  }
  if (label.length > LABEL_MAX) {
    throw new ApiError("invalid_input", `label max ${LABEL_MAX} chars`, 400);
  }
  return label;
}

aliasRoutes.get("/", (c) => {
  try {
    const db = c.get("db") as Database.Database;
    return c.json({ aliases: listAliases(db).map(rowToDto) });
  } catch (e) { return handleApiError(e); }
});

aliasRoutes.post("/", async (c) => {
  try {
    const db = c.get("db") as Database.Database;
    const body = await c.req.json().catch(() => ({}));
    const aliasName = validateName(body.aliasName);
    const upstreamModel = validateTarget(db, body.upstreamModel);
    const label = validateLabel(body.label);
    let row;
    try {
      row = upsertAlias(db, { aliasName, upstreamModel, label, source: "user" });
    } catch (e) {
      if (e instanceof AliasConflictError) {
        throw new ApiError("alias_conflicts_with_model", e.message, 409);
      }
      throw e;
    }
    clearAliasCache();
    return c.json(rowToDto(row), 201);
  } catch (e) { return handleApiError(e); }
});

aliasRoutes.put("/:name", async (c) => {
  try {
    const db = c.get("db") as Database.Database;
    const name = decodeURIComponent(c.req.param("name"));
    const existing = getAlias(db, name);
    if (!existing) throw new ApiError("alias_not_found", `alias not found: ${name}`, 404);
    const body = await c.req.json().catch(() => ({}));
    const upstreamModel = body.upstreamModel !== undefined
      ? validateTarget(db, body.upstreamModel)
      : existing.upstreamModel;
    const label = body.label !== undefined ? validateLabel(body.label) : existing.label;
    const row = upsertAlias(db, { aliasName: name, upstreamModel, label });
    clearAliasCache();
    return c.json(rowToDto(row));
  } catch (e) { return handleApiError(e); }
});

aliasRoutes.delete("/:name", (c) => {
  try {
    const db = c.get("db") as Database.Database;
    const name = decodeURIComponent(c.req.param("name"));
    const ok = deleteAlias(db, name);
    if (!ok) throw new ApiError("alias_not_found", `alias not found: ${name}`, 404);
    clearAliasCache();
    return new Response(null, { status: 204 });
  } catch (e) { return handleApiError(e); }
});
```

- [ ] **Step 4: Mount the route in `src/api/admin/index.ts`**

Edit `src/api/admin/index.ts`:

- Add to imports (line 12-13, after `modelRoutes`):
  ```ts
  import { modelRoutes } from "./models.js";
  import { aliasRoutes } from "./aliases.js";
  ```
- Add a route mount (after line 26 `app.route("/admin/models", modelRoutes);`):
  ```ts
  app.route("/admin/aliases", aliasRoutes);
  ```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/api/admin/aliases.test.ts`
Expected: 11/11 pass.

- [ ] **Step 6: Commit**

```bash
git add src/api/admin/aliases.ts src/api/admin/index.ts tests/api/admin/aliases.test.ts
git -c user.name="kelola-router" -c user.email="bot@local" commit -m "feat(api): /api/admin/aliases CRUD with validation + cache invalidation"
```

---

## Task 6: `GET /api/admin/models` — include `aliasCount`

**Files:**
- Modify: `src/api/admin/models.ts:8-17` (add aliasCount join)
- Test: extend `tests/api/admin/aliases.test.ts` (or create `tests/api/admin/models.test.ts` if not exists)

- [ ] **Step 1: Check if `tests/api/admin/models.test.ts` exists**

Run:
```bash
ls tests/api/admin/
```
If `models.test.ts` doesn't exist, create the test file in this step. If it does, read it first and extend it.

- [ ] **Step 2: Write the failing test**

Create `tests/api/admin/models.test.ts` (or append to existing):

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";
import { migrate } from "../../../src/db/migrations/index.js";
import { adminApi } from "../../../src/api/admin/index.js";
import { setPassword } from "../../../src/auth/password.js";
import { createSession } from "../../../src/auth/session.js";
import { SESSION_COOKIE } from "../../../src/auth.js";
import { upsertModel } from "../../../src/db/repos/models.js";
import { upsertAlias } from "../../../src/db/repos/aliases.js";
import { clearAliasCache } from "../../../src/providers/aliasCache.js";

let db: Database.Database;
let dir: string;
let app: Hono;
let cookie: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "models-api-"));
  db = new Database(join(dir, "t.db"));
  db.pragma("foreign_keys = ON");
  migrate(db);
  upsertModel(db, { name: "MiniMax-M3", upstream_model: "MiniMax-M3" });
  upsertModel(db, { name: "MiniMax-M2.7", upstream_model: "MiniMax-M2.7" });
  setPassword(db, "testpass");
  const sess = createSession(db);
  cookie = `${SESSION_COOKIE}=${sess.id}`;
  app = new Hono();
  app.use("*", async (c, next) => { c.set("db", db); await next(); });
  app.route("/api", adminApi(db));
  clearAliasCache();
});

afterEach(() => { db.close(); rmSync(dir, { recursive: true }); vi.restoreAllMocks(); });

const authed = () => ({ cookie, host: "localhost:20137" });

describe("GET /api/admin/models — aliasCount", () => {
  it("returns 0 for models with no aliases", async () => {
    const res = await app.request("/api/admin/models", { headers: authed() });
    const rows = await res.json() as Array<{ name: string; aliasCount: number }>;
    expect(rows.find(r => r.name === "MiniMax-M3")?.aliasCount).toBe(0);
  });

  it("increments when alias is created", async () => {
    const headers = { ...authed(), origin: "http://localhost:20137", "content-type": "application/json" };
    await app.request("/api/admin/aliases", {
      method: "POST", headers, body: JSON.stringify({ aliasName: "a1", upstreamModel: "MiniMax-M3" }),
    });
    const res = await app.request("/api/admin/models", { headers: authed() });
    const rows = await res.json() as Array<{ name: string; aliasCount: number }>;
    expect(rows.find(r => r.name === "MiniMax-M3")?.aliasCount).toBe(1);
  });

  it("decrements when alias is deleted", async () => {
    const headers = { ...authed(), origin: "http://localhost:20137", "content-type": "application/json" };
    await app.request("/api/admin/aliases", {
      method: "POST", headers, body: JSON.stringify({ aliasName: "a1", upstreamModel: "MiniMax-M3" }),
    });
    await app.request("/api/admin/aliases/a1", { method: "DELETE", headers });
    const res = await app.request("/api/admin/models", { headers: authed() });
    const rows = await res.json() as Array<{ name: string; aliasCount: number }>;
    expect(rows.find(r => r.name === "MiniMax-M3")?.aliasCount).toBe(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/api/admin/models.test.ts`
Expected: FAIL — `aliasCount` undefined.

- [ ] **Step 4: Update `src/api/admin/models.ts`**

Edit the GET `/` handler. Replace lines 8-17:

```ts
modelRoutes.get("/", (c) => {
  try {
    const db = c.get("db") as Database.Database;
    return c.json(listModels(db, { includeDisabled: true }).map(m => ({
      name: m.name, displayName: m.display_name, family: m.family,
      contextWindow: m.context_window,
      source: m.source, enabled: !!m.enabled,
    })));
  } catch (e) { return handleApiError(e); }
});
```

With:

```ts
modelRoutes.get("/", (c) => {
  try {
    const db = c.get("db") as Database.Database;
    const rows = listModels(db, { includeDisabled: true });
    const targets = [...new Set(rows.map(r => r.upstream_model))];
    const aliasesByTarget = listAliasesForTargets(db, targets);
    return c.json(rows.map(m => ({
      name: m.name, displayName: m.display_name, family: m.family,
      contextWindow: m.context_window,
      source: m.source, enabled: !!m.enabled,
      aliasCount: (aliasesByTarget[m.upstream_model] ?? []).length,
    })));
  } catch (e) { return handleApiError(e); }
});
```

Update the import at line 3 to add `listAliasesForTargets`:

```ts
import { listModels, enableModel, disableModel } from "../../db/repos/models.js";
import { listAliasesForTargets } from "../../db/repos/aliases.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/api/admin/models.test.ts`
Expected: 3/3 pass.

- [ ] **Step 6: Commit**

```bash
git add src/api/admin/models.ts tests/api/admin/models.test.ts
git -c user.name="kelola-router" -c user.email="bot@local" commit -m "feat(api): include aliasCount in /api/admin/models response"
```

---

## Task 7: Proxy integration — write `requested_model` to `request_logs`

**Files:**
- Modify: `src/db/repos/requestLogs.ts` (accept new optional field)
- Modify: `src/server.ts` (capture `resolved.requestedModel`, pass to log)
- Test: `tests/integration/proxy-alias.test.ts`

- [ ] **Step 1: Read `src/db/repos/requestLogs.ts` to find the insert function signature**

Read `src/db/repos/requestLogs.ts` end-to-end. Note the `RequestLog` interface (line 3), `RequestLogInsert` type (line 34), and the `INSERT INTO request_logs (...)` column list inside `insertRequestLog` (line 48). You will add `requested_model?: string | null` to both `RequestLog` and `RequestLogInsert`, and add the column to the `INSERT` statement.

- [ ] **Step 2: Write the failing proxy test**

Create `tests/integration/proxy-alias.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { app, resetDb } from "../../src/server.js";
import { openDb } from "../../src/db/index.js";
import { upsertModel, enableModel } from "../../src/db/repos/models.js";
import { createAccount } from "../../src/db/repos/accounts.js";
import { createClientKey } from "../../src/db/repos/client_keys.js";
import { setSetting, clearCache } from "../../src/db/repos/settings.js";
import { upsertAlias } from "../../src/db/repos/aliases.js";
import { setModelLock } from "../../src/accounts/locks.js";
import { clearAliasCache } from "../../src/providers/aliasCache.js";
import { recentLogs } from "../../src/db/repos/requestLogs.js";
import { _resetRateLimitForTests as resetRateLimit } from "../../src/auth/rateLimit.js";

let dir: string;
let clientKey: string;

beforeEach(() => {
  resetRateLimit();
  dir = mkdtempSync(join(tmpdir(), "proxy-alias-"));
  process.env.ROUTER_DB_PATH = join(dir, "t.db");
  resetDb();
  clearCache();
  const db = openDb();
  upsertModel(db, { name: "MiniMax-M3", upstream_model: "MiniMax-M3" });
  enableModel(db, "MiniMax-M3");
  createAccount(db, { id: "acc1", label: "t", credit_type: "payg", api_key: "mm_test" });
  const ck = createClientKey(db, { label: "t", key: "ck_test_123" });
  clientKey = ck.key;
  setSetting(db, "transport", { relay: null, proxy: null });
  clearCache();
  clearAliasCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetDb();
  rmSync(dir, { recursive: true });
  delete process.env.ROUTER_DB_PATH;
});

const chatBody = (model: string) => ({
  model,
  messages: [{ role: "user", content: "hi" }],
  stream: false,
});

const okUpstream = () => new Response(JSON.stringify({
  id: "x", model: "MiniMax-M3",
  choices: [{ message: { role: "assistant", content: "ok" }, index: 0, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
}), { headers: { "content-type": "application/json" } });

describe("proxy with alias", () => {
  it("resolves alias → upstream and logs both names", async () => {
    const db = openDb();
    upsertAlias(db, { aliasName: "claude-opus-4-8", upstreamModel: "MiniMax-M3" });
    clearAliasCache();

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => okUpstream());

    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${clientKey}`, "content-type": "application/json" },
      body: JSON.stringify(chatBody("claude-opus-4-8")),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const logs = recentLogs(db, { limit: 1 });
    expect(logs[0]?.model).toBe("MiniMax-M3");
    expect((logs[0] as any)?.requested_model).toBe("claude-opus-4-8");
  });

  it("returns 400 for unknown alias target", async () => {
    const db = openDb();
    upsertAlias(db, { aliasName: "broken", upstreamModel: "does-not-exist" });
    clearAliasCache();
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${clientKey}`, "content-type": "application/json" },
      body: JSON.stringify(chatBody("broken")),
    });
    const res = await app.request(req);
    expect(res.status).toBe(400);
  });

  it("lock on upstream model blocks requests sent via alias", async () => {
    const db = openDb();
    upsertAlias(db, { aliasName: "opus", upstreamModel: "MiniMax-M3" });
    clearAliasCache();
    setModelLock(db, "acc1", "MiniMax-M3", 60_000);
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${clientKey}`, "content-type": "application/json" },
      body: JSON.stringify(chatBody("opus")),
    });
    const res = await app.request(req);
    expect(res.status).toBe(429);
  });

  it("cache invalidation: new alias works immediately after POST", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => okUpstream());

    // First request: no alias yet, fails with 400
    const r1 = await app.request(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${clientKey}`, "content-type": "application/json" },
      body: JSON.stringify(chatBody("new-alias")),
    }));
    expect(r1.status).toBe(400);

    // Create alias via API (which calls clearAliasCache)
    await app.request(new Request("http://localhost/api/admin/aliases", {
      method: "POST",
      headers: {
        authorization: `Bearer ${clientKey}`,
        "content-type": "application/json",
        origin: "http://localhost:20137",
        host: "localhost:20137",
      },
      body: JSON.stringify({ aliasName: "new-alias", upstreamModel: "MiniMax-M3" }),
    }));

    // Second request: should now work without TTL wait
    const r2 = await app.request(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${clientKey}`, "content-type": "application/json" },
      body: JSON.stringify(chatBody("new-alias")),
    }));
    expect(r2.status).toBe(200);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/integration/proxy-alias.test.ts`
Expected: FAIL — `requested_model` column does not exist on `request_logs`.

- [ ] **Step 4: Update `src/db/repos/requestLogs.ts` to accept `requested_model`**

In `src/db/repos/requestLogs.ts`:

1. Add `requested_model: string | null` to the `RequestLog` interface (after `model: string`).
2. Add `requested_model?: string | null` to the `RequestLogInsert` type's second part (the part that opts out of `Omit` for additional fields, around line 34).
3. In `insertRequestLog` (line 48), add `requested_model` to the `INSERT INTO request_logs (...)` column list and the matching `VALUES (?, ...)` placeholder, plus the value: `log.requested_model ?? null`.

- [ ] **Step 5: Update `src/server.ts` handleProxy to pass `requestedModel`**

Read `src/server.ts` to find every call site of `insertRequestLog(...)` inside the proxy handler. There should be two — one for the streaming path, one for the buffered path.

In both call sites, add `requested_model: resolved.requestedModel` to the args object.

If `resolved.requestedModel` is not already captured locally, declare `const requestedModel = resolved.requestedModel;` near the existing `resolved` usage.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/integration/proxy-alias.test.ts`
Expected: 4/4 pass.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: 251 + new tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/db/repos/requestLogs.ts src/server.ts tests/integration/proxy-alias.test.ts
git -c user.name="kelola-router" -c user.email="bot@local" commit -m "feat(proxy): log requested_model alongside resolved model"
```

---

## Task 8: Final cleanup verification — grep for stragglers

**Files:** none modified unless stragglers found

- [ ] **Step 1: Grep for legacy references**

Run:
```bash
git grep -nE 'LEGACY_MODEL_ALIASES|MiniMax-M[23]\.7?-thinking|warnLegacyOnce' src tests scripts
```
Expected: no output. If anything matches, delete it.

- [ ] **Step 2: Grep for any other -thinking references that might be dead**

Run:
```bash
git grep -nE '\-thinking' src/db src/providers scripts docs
```
Expected: only `ADAPTIVE_THINKING_MODELS` references remain.

- [ ] **Step 3: If anything was removed, commit it; otherwise skip**

```bash
git add -A
git -c user.name="kelola-router" -c user.email="bot@local" commit -m "chore: remove any remaining legacy alias references" --allow-empty
```

---

## Task 9: UI — new `Aliases` page

**Files:**
- Create: `client/src/pages/Aliases.tsx`

No automated UI test. Visual verification done in Task 11 (smoke test).

- [ ] **Step 1: Create the page**

Create `client/src/pages/Aliases.tsx`:

```tsx
import { useState, useMemo, useEffect } from "preact/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Card } from "../components/Card";
import { TopBar } from "../layout/TopBar";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { Modal } from "../components/Modal";
import { confirmDialog } from "../components/Confirm";
import { useToast } from "../components/ToastProvider";
import { TableSkeleton } from "../components/Skeleton";
import { ErrorState } from "../components/ErrorState";

interface Alias {
  aliasName: string;
  upstreamModel: string;
  label: string | null;
  source: string;
  createdAt: string;
}
interface Model { name: string; enabled: boolean; }

const NAME_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export function Aliases() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: aliases = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["aliases"],
    queryFn: () => apiFetch<{ aliases: Alias[] }>("/api/admin/aliases").then(r => r.aliases),
  });
  const { data: models = [] } = useQuery({
    queryKey: ["models"],
    queryFn: () => apiFetch<Model[]>("/api/admin/models"),
  });

  // Parse ?target=... from hash for filter prefill
  const [search, setSearch] = useState("");
  useEffect(() => {
    const h = location.hash.split("?")[1] ?? "";
    const params = new URLSearchParams(h);
    const t = params.get("target");
    if (t) setSearch(t);
  }, []);

  const [editing, setEditing] = useState<Alias | "new" | null>(null);

  const saveMut = useMutation({
    mutationFn: async (args: { aliasName: string; upstreamModel: string; label: string | null; originalName?: string }) => {
      if (args.originalName) {
        return apiFetch<Alias>(`/api/admin/aliases/${encodeURIComponent(args.originalName)}`, {
          method: "PUT", json: { upstreamModel: args.upstreamModel, label: args.label },
        });
      }
      return apiFetch<Alias>("/api/admin/aliases", {
        method: "POST", json: { aliasName: args.aliasName, upstreamModel: args.upstreamModel, label: args.label },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["aliases"] });
      qc.invalidateQueries({ queryKey: ["models"] });
      setEditing(null);
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message || "Save failed"),
  });

  const deleteMut = useMutation({
    mutationFn: (name: string) => apiFetch(`/api/admin/aliases/${encodeURIComponent(name)}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["aliases"] });
      qc.invalidateQueries({ queryKey: ["models"] });
      toast.success("Deleted");
    },
    onError: (e: Error) => toast.error(e.message || "Delete failed"),
  });

  const filtered = useMemo(() => aliases.filter(a =>
    !search ||
    a.aliasName.toLowerCase().includes(search.toLowerCase()) ||
    a.upstreamModel.toLowerCase().includes(search.toLowerCase()) ||
    (a.label?.toLowerCase().includes(search.toLowerCase()) ?? false)
  ), [aliases, search]);

  return (
    <>
      <TopBar
        title={<>Ali<em>as</em>es</>}
        eyebrow="Catalog / aliases"
        actions={<Button onClick={() => setEditing("new")}>+ New alias</Button>}
      />
      <p class="card-sub">
        User-defined names that resolve to upstream models. Useful for matching client
        expectations (e.g. <code>claude-opus-4-8 → MiniMax-M3</code>).
      </p>
      <Card>
        <input
          type="search"
          placeholder="Filter by alias, target, or label…"
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          style={{ width: "100%", marginBottom: 12, padding: "8px 10px", background: "var(--ink-1)", border: "1px solid var(--ink-3)", color: "var(--text-1)", borderRadius: 4, fontFamily: "inherit", fontSize: 13 }}
        />
        {isError ? <ErrorState error={error as Error} onRetry={() => refetch()} /> :
         isLoading ? <TableSkeleton rows={5} cols={6} /> :
         filtered.length === 0 ? (
          <p class="card-sub">
            {aliases.length === 0
              ? <>No aliases yet. <a href="#" onClick={(e) => { e.preventDefault(); setEditing("new"); }}>Create one →</a></>
              : "No aliases match."}
          </p>
         ) : (
          <table class="tbl">
            <thead><tr><th>Alias</th><th>→ Target</th><th>Label</th><th>Source</th><th>Created</th><th></th></tr></thead>
            <tbody>{filtered.map(a => (
              <tr key={a.aliasName}>
                <td class="mono">{a.aliasName}</td>
                <td class="mono">{a.upstreamModel}</td>
                <td>{a.label ?? "—"}</td>
                <td><Badge variant={a.source === "user" ? "active" : "muted"}>{a.source}</Badge></td>
                <td class="card-sub mono" style={{ fontSize: 12 }}>{a.createdAt}</td>
                <td style={{ textAlign: "right" }}>
                  <Button size="sm" onClick={() => setEditing(a)}>Edit</Button>{" "}
                  <Button size="sm" variant="ghost" onClick={async () => {
                    if (await confirmDialog({ title: "Delete alias", message: `Delete alias "${a.aliasName}"?`, confirmLabel: "Delete", danger: true })) {
                      deleteMut.mutate(a.aliasName);
                    }
                  }}>Delete</Button>
                </td>
              </tr>
            ))}</tbody>
          </table>
         )}
      </Card>

      {editing && (
        <AliasModal
          alias={editing === "new" ? null : editing}
          models={models}
          onClose={() => setEditing(null)}
          onSave={(payload) => saveMut.mutate(payload)}
          saving={saveMut.isPending}
        />
      )}
    </>
  );
}

function AliasModal({ alias, models, onClose, onSave, saving }: {
  alias: Alias | null;
  models: Model[];
  onClose: () => void;
  onSave: (args: { aliasName: string; upstreamModel: string; label: string | null; originalName?: string }) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(alias?.aliasName ?? "");
  const [target, setTarget] = useState(alias?.upstreamModel ?? models[0]?.name ?? "");
  const [label, setLabel] = useState(alias?.label ?? "");
  const enabledModels = models.filter(m => m.enabled);

  const nameValid = NAME_RE.test(name);
  const targetValid = enabledModels.some(m => m.name === target);

  return (
    <Modal open onClose={onClose} title={alias ? `Edit alias: ${alias.aliasName}` : "New alias"} width={480}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          onClick={() => onSave({
            aliasName: name.trim(),
            upstreamModel: target.trim(),
            label: label.trim() || null,
            originalName: alias?.aliasName,
          })}
          disabled={saving || !nameValid || !targetValid}
        >{saving ? "Saving…" : alias ? "Save" : "Create"}</Button>
      </>}>
      <div style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span class="card-sub mono" style={{ fontSize: 12, textTransform: "uppercase" }}>Alias name</span>
          <input
            value={name}
            disabled={!!alias}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            placeholder="claude-opus-4-8"
            style={{ padding: "8px 10px", background: "var(--ink-1)", border: "1px solid var(--ink-3)", color: "var(--text-1)", borderRadius: 4, fontFamily: "inherit", fontSize: 13 }}
          />
          {name && !nameValid && <span style={{ color: "var(--alert)", fontSize: 12 }}>Letters, digits, . _ : - only (1-128 chars)</span>}
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span class="card-sub mono" style={{ fontSize: 12, textTransform: "uppercase" }}>Target upstream model</span>
          <select
            value={target}
            onChange={(e) => setTarget((e.target as HTMLSelectElement).value)}
            style={{ padding: "8px 10px", background: "var(--ink-1)", border: "1px solid var(--ink-3)", color: "var(--text-1)", borderRadius: 4, fontFamily: "inherit", fontSize: 13 }}
          >
            {enabledModels.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span class="card-sub mono" style={{ fontSize: 12, textTransform: "uppercase" }}>Label (optional)</span>
          <input
            value={label}
            onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
            placeholder="Claude Code → M3"
            style={{ padding: "8px 10px", background: "var(--ink-1)", border: "1px solid var(--ink-3)", color: "var(--text-1)", borderRadius: 4, fontFamily: "inherit", fontSize: 13 }}
          />
        </label>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Typecheck the client**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/Aliases.tsx
git -c user.name="kelola-router" -c user.email="bot@local" commit -m "feat(ui): Aliases page with create/edit/delete + ?target= filter"
```

---

## Task 10: UI wiring — Sidebar + AppShell + Models page + Icon

**Files:**
- Modify: `client/src/components/Icon.tsx` (add `aliases` glyph to `IconName` + `paths`)
- Modify: `client/src/layout/Sidebar.tsx:7-15` (add nav item)
- Modify: `client/src/layout/AppShell.tsx:8-17,28-37,55,88-97` (register route + shortcut + help)
- Modify: `client/src/pages/Models.tsx:13,35,43-55` (add aliasCount + Aliases column)

- [ ] **Step 1: Add `aliases` glyph to Icon**

Edit `client/src/components/Icon.tsx`:

- Replace line 3:
  ```ts
  export type IconName = "overview" | "usage" | "client-keys" | "accounts" | "models" | "quota" | "settings" | "search";
  ```
  with:
  ```ts
  export type IconName = "overview" | "usage" | "client-keys" | "accounts" | "models" | "aliases" | "quota" | "settings" | "search";
  ```
- Add a new entry to the `paths` object (after the `"models"` entry on line 10):
  ```ts
  aliases: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
  ```

- [ ] **Step 2: Add Aliases nav item in Sidebar**

Edit `client/src/layout/Sidebar.tsx`:

- Add to the `NAV` array (between `models` line 12 and `quota` line 13):
  ```ts
  { key: "aliases", label: "Aliases", href: "/admin/aliases", icon: "aliases" },
  ```

- [ ] **Step 3: Register route + shortcut in AppShell**

Edit `client/src/layout/AppShell.tsx`:

- Add import (after line 11):
  ```ts
  import { Aliases } from "../pages/Aliases";
  ```
- Replace `KNOWN_ROUTES` (line 17):
  ```ts
  const KNOWN_ROUTES = ["overview", "usage", "client-keys", "accounts", "models", "aliases", "quota", "settings"];
  ```
- Add a case in the switch (after `case "models":` line 32):
  ```ts
  case "aliases": return <Aliases />;
  ```
- Replace `gMap` (line 55):
  ```ts
  const gMap: Record<string, string> = { o: "/admin", u: "/admin/usage", c: "/admin/client-keys", a: "/admin/accounts", m: "/admin/models", l: "/admin/aliases", q: "/admin/quota", s: "/admin/settings" };
  ```
- Add a help modal row (after the `g m` row, around line 94):
  ```tsx
  <div><kbd>g</kbd> then <kbd>l</kbd> — aliases</div>
  ```

- [ ] **Step 4: Add Aliases column to Models page**

Edit `client/src/pages/Models.tsx`:

- Replace the `Model` interface (line 13):
  ```ts
  interface Model { name: string; displayName: string | null; family: string | null; contextWindow: number | null; source: string; enabled: boolean; aliasCount: number; }
  ```
- Replace the table header (line 43):
  ```ts
  <thead><tr><th>Name</th><th>Display</th><th>Family</th><th>Context</th><th>Source</th><th>Aliases</th><th>Status</th></tr></thead>
  ```
- Add a cell to each row (after the Source `<td>` on line 50, before the Status `<td>`):
  ```tsx
  <td>
    {m.aliasCount > 0
      ? <a href={`#/admin/aliases?target=${encodeURIComponent(m.name)}`}>{m.aliasCount} alias{m.aliasCount === 1 ? "" : "es"}</a>
      : <span class="card-sub">—</span>}
  </td>
  ```

- [ ] **Step 5: Typecheck the client**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Icon.tsx client/src/layout/Sidebar.tsx client/src/layout/AppShell.tsx client/src/pages/Models.tsx
git -c user.name="kelola-router" -c user.email="bot@local" commit -m "feat(ui): wire Aliases page into nav, shortcuts, help, and Models badge"
```

---

## Task 11: Build + smoke verification

**Files:** none modified unless build reveals issues

- [ ] **Step 1: Typecheck the server**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Typecheck the client**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: 280+ tests pass (was 251 + ~30 new).

- [ ] **Step 4: Build the client**

Run: `cd client && npm run build`
Expected: builds without errors. Output: `client/dist/` updated.

- [ ] **Step 5: Start the dev server and smoke-test (manual, optional)**

Run in background: `npm run dev`
Then in another terminal:
```bash
# Create an alias
curl -X POST http://localhost:20137/api/admin/aliases \
  -H 'content-type: application/json' \
  -H 'origin: http://localhost:20137' \
  -b "kelola_session=$SESSION" \
  -d '{"aliasName":"claude-opus-4-8","upstreamModel":"MiniMax-M3"}'

# List
curl http://localhost:20137/api/admin/aliases -b "kelola_session=$SESSION"

# Send a proxied request with the alias
curl -X POST http://localhost:20137/v1/chat/completions \
  -H "authorization: Bearer $CLIENT_KEY" \
  -H 'content-type: application/json' \
  -d '{"model":"claude-opus-4-8","messages":[{"role":"user","content":"hi"}]}'
```
Expected: 200 response. Check Usage page in browser at http://localhost:20137 — log row shows `MiniMax-M3` in Model column; query DB to confirm `requested_model = "claude-opus-4-8"`.

- [ ] **Step 6: Stop the dev server if started**

Run: `Ctrl+C` (or `TaskStop` if backgrounded).

- [ ] **Step 7: Commit any build artifacts (none expected) and tag the work**

```bash
git tag v0.12-model-aliases
git log --oneline -12
```

---

## Done

All 11 tasks complete. Verify the final state with:

```bash
npm test                # 280+ pass
npm run typecheck       # clean
cd client && npm run build   # clean
git grep -nE 'LEGACY_MODEL_ALIASES|MiniMax-M[23]\.7?-thinking' src tests scripts   # empty
```
