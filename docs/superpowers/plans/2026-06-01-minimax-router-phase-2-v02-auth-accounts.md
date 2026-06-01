# Phase 2: v0.2 — Auth + Multi-Account State

> Part of [Master Plan](./2026-06-01-minimax-router.md). Requires Phase 1 done.
> Spec: `docs/spec/IMPLEMENTATION.md` §6 v0.2
> Target: 3-4h

**Goal:** SQLite-backed users + accounts. Real `requireApiKey` (proxy) + `requireAdmin` (admin, separate key) middleware. Multi-account state machine: sticky + round-robin, exponential backoff, per-model locks, 5h/weekly window reset.

**Done when:** CLI scripts create user + account, requests pick account per mode, simulated 429 marks cooldown + backoff_level, next request falls back to different account.

---

## Task 2.1: DB open + migrations

**Files:**
- Create: `src/db/index.ts`
- Create: `src/db/index.test.ts`
- Create: `src/db/migrations/index.ts`
- Create: `src/db/migrations/001-initial.ts`
- Create: `src/db/migrations/002-admin-key.ts`

- [ ] **Step 1: Write failing test for db open + migrate**

`src/db/index.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "./index.js";

let tmp: string;
let prevPath: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "router-test-"));
  prevPath = process.env.ROUTER_DB_PATH;
  process.env.ROUTER_DB_PATH = join(tmp, "test.db");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  if (prevPath === undefined) delete process.env.ROUTER_DB_PATH;
  else process.env.ROUTER_DB_PATH = prevPath;
});

describe("openDb", () => {
  it("creates tables from migration 001", () => {
    const db = openDb();
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain("users");
    expect(names).toContain("accounts");
    expect(names).toContain("account_model_locks");
    expect(names).toContain("request_logs");
    expect(names).toContain("quota_snapshots");
    expect(names).toContain("models");
    expect(names).toContain("user_settings");
    expect(names).toContain("settings");
  });

  it("seeds default settings rows", () => {
    const db = openDb();
    const rows = db.prepare(`SELECT key FROM settings ORDER BY key`).all() as { key: string }[];
    const keys = rows.map(r => r.key);
    expect(keys).toContain("rtk");
    expect(keys).toContain("caveman");
    expect(keys).toContain("caching");
    expect(keys).toContain("transport");
    expect(keys).toContain("build");
  });

  it("seeds 11 default MiniMax models", () => {
    const db = openDb();
    const rows = db.prepare(`SELECT name FROM models ORDER BY name`).all() as { name: string }[];
    const names = rows.map(r => r.name);
    expect(names).toContain("MiniMax-M3");
    expect(names).toContain("MiniMax-M3-thinking");
    expect(names).toContain("MiniMax-M2.7");
    expect(names).toContain("MiniMax-M2.7-thinking");
    expect(names).toContain("MiniMax-M2.7-highspeed");
    expect(names).toContain("MiniMax-M2.5");
    expect(names).toContain("MiniMax-M2.5-highspeed");
    expect(names).toContain("MiniMax-M2.1");
    expect(names).toContain("MiniMax-M2.1-highspeed");
    expect(names).toContain("MiniMax-M2");
    expect(names).toContain("MiniMax-M2-her");
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

Run: `npm test`
Expected: FAIL — `./index.js` not found

- [ ] **Step 3: Write `src/db/migrations/001-initial.ts`**

```ts
export const migration_001 = {
  id: 1,
  name: "initial",
  sql: `
    CREATE TABLE users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      api_key     TEXT NOT NULL UNIQUE,
      admin_key   TEXT UNIQUE,
      enabled     BOOLEAN NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE accounts (
      id                  TEXT PRIMARY KEY,
      user_id             INTEGER NOT NULL,
      label               TEXT NOT NULL,
      provider            TEXT NOT NULL DEFAULT 'minimax',
      credit_type         TEXT NOT NULL,
      api_key             TEXT NOT NULL,
      base_url            TEXT,
      enabled             BOOLEAN NOT NULL DEFAULT 1,
      rate_limited_until  TEXT,
      backoff_level       INTEGER NOT NULL DEFAULT 0,
      last_error          TEXT,
      status              TEXT NOT NULL DEFAULT 'active',
      position            INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_accounts_user ON accounts(user_id, position);

    CREATE TABLE account_model_locks (
      account_id    TEXT NOT NULL,
      model         TEXT NOT NULL,
      locked_until  TEXT NOT NULL,
      PRIMARY KEY (account_id, model),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE request_logs (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id                 INTEGER NOT NULL,
      account_id              TEXT,
      model                   TEXT NOT NULL,
      endpoint                TEXT NOT NULL,
      format                  TEXT NOT NULL,
      prompt_tokens           INTEGER NOT NULL DEFAULT 0,
      completion_tokens       INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens   INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens       INTEGER NOT NULL DEFAULT 0,
      total_tokens            INTEGER NOT NULL DEFAULT 0,
      cost_usd                REAL NOT NULL DEFAULT 0,
      latency_ms              INTEGER NOT NULL,
      ttft_ms                 INTEGER,
      status_code             INTEGER NOT NULL,
      base_resp_code          INTEGER,
      stream                  BOOLEAN NOT NULL DEFAULT 0,
      relay_path              TEXT,
      proxy_path              TEXT,
      rtk_bytes_saved         INTEGER NOT NULL DEFAULT 0,
      caveman_level           TEXT,
      error_message           TEXT,
      created_at              TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
    );
    CREATE INDEX idx_logs_user_created ON request_logs(user_id, created_at DESC);
    CREATE INDEX idx_logs_account_created ON request_logs(account_id, created_at DESC);
    CREATE INDEX idx_logs_model_created ON request_logs(model, created_at DESC);
    CREATE INDEX idx_logs_status ON request_logs(status_code, created_at DESC);

    CREATE TABLE quota_snapshots (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id        TEXT NOT NULL,
      source            TEXT NOT NULL,
      total_count       INTEGER,
      remaining_count   INTEGER,
      used_count        INTEGER,
      window_type       TEXT,
      window_start      TEXT,
      window_end        TEXT,
      raw_response      TEXT,
      fetched_at        TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_quota_account_fetched ON quota_snapshots(account_id, fetched_at DESC);

    CREATE TABLE models (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      name                  TEXT NOT NULL UNIQUE,
      display_name          TEXT,
      family                TEXT,
      upstream_model        TEXT NOT NULL,
      context_window        INTEGER,
      thinking_enabled      BOOLEAN NOT NULL DEFAULT 0,
      thinking_budget       INTEGER,
      pricing_input         REAL,
      pricing_output        REAL,
      pricing_cache_read    REAL,
      pricing_cache_write   REAL,
      pricing_tiers         TEXT,
      capabilities          TEXT,
      source                TEXT NOT NULL DEFAULT 'manual',
      enabled               BOOLEAN NOT NULL DEFAULT 1,
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_models_family ON models(family, enabled);

    CREATE TABLE user_settings (
      user_id     INTEGER NOT NULL,
      key         TEXT NOT NULL,
      value       TEXT NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO settings (key, value) VALUES
      ('rtk', '{"enabled": true, "minCompressSize": 500, "rawCap": 10485760, "filters": ["smart-truncate", "dedup-log"]}'),
      ('caveman', '{"level": "off"}'),
      ('caching', '{"autoBreakpoints": true, "respectCallerMarkers": true}'),
      ('transport', '{"relay": null, "proxy": null}'),
      ('build', '{"version": "0.2.0", "schemaVersion": 2}');

    INSERT INTO models (name, display_name, family, upstream_model, context_window, thinking_enabled, pricing_input, pricing_output, pricing_cache_read, pricing_cache_write, pricing_tiers, source) VALUES
      ('MiniMax-M3',             'MiniMax M3',             'm3',   'MiniMax-M3',        1000000, 0, 0.60, 2.40, 0.12, NULL,
        '{"base":{"input":0.60,"output":2.40,"cacheRead":0.12,"cacheWrite":null},"high":{"input":1.20,"output":4.80,"cacheRead":0.24,"cacheWrite":null},"promotional":{"input":0.30,"output":1.20,"cacheRead":0.06,"cacheWrite":null}}',
        'builtin'),
      ('MiniMax-M3-thinking',    'MiniMax M3 (thinking)',  'm3',   'MiniMax-M3',        1000000, 1, 0.60, 2.40, 0.12, NULL,
        '{"base":{"input":0.60,"output":2.40,"cacheRead":0.12,"cacheWrite":null},"high":{"input":1.20,"output":4.80,"cacheRead":0.24,"cacheWrite":null},"promotional":{"input":0.30,"output":1.20,"cacheRead":0.06,"cacheWrite":null}}',
        'builtin'),
      ('MiniMax-M2.7',           'MiniMax M2.7',           'm2.7', 'MiniMax-M2.7',      204800,  0, 0.30, 1.20, 0.06, 0.375, NULL, 'builtin'),
      ('MiniMax-M2.7-thinking',  'MiniMax M2.7 (thinking)','m2.7', 'MiniMax-M2.7',      204800,  1, 0.30, 1.20, 0.06, 0.375, NULL, 'builtin'),
      ('MiniMax-M2.7-highspeed', 'MiniMax M2.7 highspeed', 'm2.7', 'MiniMax-M2.7-highspeed', 204800, 0, 0.60, 2.40, 0.06, 0.375, NULL, 'builtin'),
      ('MiniMax-M2.5',           'MiniMax M2.5',           'm2.5', 'MiniMax-M2.5',      204800,  0, 0.30, 1.20, 0.03, 0.375, NULL, 'builtin'),
      ('MiniMax-M2.5-highspeed', 'MiniMax M2.5 highspeed', 'm2.5', 'MiniMax-M2.5-highspeed', 204800, 0, 0.60, 2.40, 0.03, 0.375, NULL, 'builtin'),
      ('MiniMax-M2.1',           'MiniMax M2.1',           'm2.1', 'MiniMax-M2.1',      204800,  0, 0.30, 1.20, 0.03, 0.375, NULL, 'builtin'),
      ('MiniMax-M2.1-highspeed', 'MiniMax M2.1 highspeed', 'm2.1', 'MiniMax-M2.1-highspeed', 204800, 0, 0.60, 2.40, 0.03, 0.375, NULL, 'builtin'),
      ('MiniMax-M2',             'MiniMax M2',             'm2',   'MiniMax-M2',        204800,  0, 0.30, 1.20, 0.03, 0.375, NULL, 'builtin'),
      ('MiniMax-M2-her',         'MiniMax M2-her (roleplay)','m2-her', 'MiniMax-M2-her', 64000, 0, NULL, NULL, NULL, NULL, NULL, 'builtin');
  `,
};
```

- [ ] **Step 4: Write `src/db/migrations/002-admin-key.ts`**

```ts
export const migration_002 = {
  id: 2,
  name: "admin_key",
  sql: `ALTER TABLE users ADD COLUMN admin_key TEXT UNIQUE;`,
};
```

- [ ] **Step 5: Write `src/db/migrations/index.ts`**

```ts
import { migration_001 } from "./001-initial.js";
import { migration_002 } from "./002-admin-key.js";
import type Database from "better-sqlite3";

const ALL_MIGRATIONS = [migration_001, migration_002];

export function migrate(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (const m of ALL_MIGRATIONS) {
    if (m.id > current) {
      try {
        db.exec(m.sql);
        db.pragma(`user_version = ${m.id}`);
        console.log(`[db] applied migration ${m.id}: ${m.name}`);
      } catch (e) {
        console.error(`[db] migration ${m.id} failed:`, e);
        throw e;
      }
    }
  }
}
```

- [ ] **Step 6: Write `src/db/index.ts`**

```ts
import Database from "better-sqlite3";
import { homedir, platform } from "os";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";
import { migrate } from "./migrations/index.js";

function defaultDbPath(): string {
  if (process.env.ROUTER_DB_PATH) return process.env.ROUTER_DB_PATH;
  const home = homedir();
  if (platform === "darwin") {
    return join(home, "Library/Application Support/minimax-router/router.db");
  }
  if (platform === "win32") {
    return join(process.env.APPDATA || home, "minimax-router/router.db");
  }
  return join(process.env.XDG_DATA_HOME || join(home, ".local/share"), "minimax-router/router.db");
}

export function openDb(): Database.Database {
  const dbPath = defaultDbPath();
  const dir = dbPath.substring(0, dbPath.lastIndexOf("/"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.pragma("user_version = 0");

  migrate(db);
  return db;
}
```

- [ ] **Step 7: Install better-sqlite3**

Run: `npm install better-sqlite3 @types/better-sqlite3`
Expected: deps installed

- [ ] **Step 8: Run test (expect pass)**

Run: `npm test`
Expected: 20 tests (3 new)

- [ ] **Step 9: Commit**

```bash
git add src/db/ package.json package-lock.json
git commit -m "feat: db open + 7 tables + 11 seed models + 5 settings"
```

---

## Task 2.2: User + Account repos

**Files:**
- Create: `src/db/repos/users.ts`
- Create: `src/db/repos/accounts.ts`
- Create: `src/db/repos/users.test.ts`
- Create: `src/db/repos/accounts.test.ts`

- [ ] **Step 1: Write failing tests**

`src/db/repos/users.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../index.js";
import { createUser, getUserByApiKey, getUserByAdminKey, listUsers } from "./users.js";

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "u-")), "t.db");
});

describe("users repo", () => {
  it("createUser returns id + api_key + admin_key", () => {
    const db = openDb();
    const u = createUser(db, "alice");
    expect(u.id).toBeTypeOf("number");
    expect(u.api_key).toMatch(/^rk_/);
    expect(u.admin_key).toMatch(/^ak_/);
  });

  it("getUserByApiKey returns user with accounts", () => {
    const db = openDb();
    const u = createUser(db, "bob");
    const found = getUserByApiKey(db, u.api_key);
    expect(found?.name).toBe("bob");
    expect(found?.accounts).toEqual([]);
  });

  it("getUserByAdminKey returns user", () => {
    const db = openDb();
    const u = createUser(db, "carol");
    const found = getUserByAdminKey(db, u.admin_key!);
    expect(found?.name).toBe("carol");
  });

  it("getUserByApiKey returns null on miss", () => {
    const db = openDb();
    expect(getUserByApiKey(db, "rk_nope")).toBeNull();
  });

  it("listUsers returns all users", () => {
    const db = openDb();
    createUser(db, "a");
    createUser(db, "b");
    expect(listUsers(db).length).toBe(2);
  });
});
```

`src/db/repos/accounts.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDb } from "../index.js";
import { createUser } from "./users.js";
import {
  createAccount, getAccount, listAccountsByUser, updateAccount,
  setModelLock, getModelLock, clearExpiredModelLocks,
} from "./accounts.js";

let db: ReturnType<typeof openDb>;
let userId: number;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "a-")), "t.db");
  db = openDb();
  userId = createUser(db, "u").id;
});

describe("accounts repo", () => {
  it("createAccount stores required fields", () => {
    const a = createAccount(db, {
      id: "acc_test1",
      user_id: userId,
      label: "PAYG main",
      credit_type: "payg",
      api_key: "mm_x",
    });
    expect(a.id).toBe("acc_test1");
  });

  it("getAccount returns account by id", () => {
    createAccount(db, { id: "acc_a", user_id: userId, label: "L", credit_type: "payg", api_key: "k" });
    const got = getAccount(db, "acc_a");
    expect(got?.label).toBe("L");
  });

  it("listAccountsByUser returns user's accounts ordered by position", () => {
    createAccount(db, { id: "acc_1", user_id: userId, label: "A", credit_type: "payg", api_key: "k", position: 0 });
    createAccount(db, { id: "acc_2", user_id: userId, label: "B", credit_type: "token-plan", api_key: "k", position: 1 });
    const list = listAccountsByUser(db, userId);
    expect(list.map(a => a.id)).toEqual(["acc_1", "acc_2"]);
  });

  it("updateAccount patches fields", () => {
    createAccount(db, { id: "acc_u", user_id: userId, label: "L", credit_type: "payg", api_key: "k" });
    updateAccount(db, "acc_u", { rate_limited_until: "2099-01-01T00:00:00Z", backoff_level: 3 });
    const got = getAccount(db, "acc_u");
    expect(got?.backoff_level).toBe(3);
    expect(got?.rate_limited_until).toBe("2099-01-01T00:00:00Z");
  });

  it("setModelLock + getModelLock roundtrip", () => {
    createAccount(db, { id: "acc_ml", user_id: userId, label: "L", credit_type: "payg", api_key: "k" });
    setModelLock(db, "acc_ml", "MiniMax-M3", 60_000);
    const lock = getModelLock(db, "acc_ml", "MiniMax-M3");
    expect(lock).toBeTruthy();
    expect(new Date(lock!.locked_until).getTime()).toBeGreaterThan(Date.now());
  });

  it("clearExpiredModelLocks removes past locks", () => {
    createAccount(db, { id: "acc_cl", user_id: userId, label: "L", credit_type: "payg", api_key: "k" });
    db.prepare(`INSERT INTO account_model_locks (account_id, model, locked_until) VALUES (?, ?, ?)`)
      .run("acc_cl", "old-model", "2000-01-01T00:00:00Z");
    clearExpiredModelLocks(db);
    expect(getModelLock(db, "acc_cl", "old-model")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `npm test`
Expected: FAIL — repos don't exist

- [ ] **Step 3: Write `src/db/repos/users.ts`**

```ts
import type Database from "better-sqlite3";
import { randomBytes } from "crypto";

export interface User {
  id: number;
  name: string;
  api_key: string;
  admin_key: string | null;
  enabled: boolean;
  created_at: string;
}

export interface UserWithAccounts extends User {
  accounts: AccountLite[];
}

interface AccountLite {
  id: string;
  label: string;
  provider: string;
  credit_type: string;
  enabled: boolean;
  rate_limited_until: string | null;
  backoff_level: number;
  status: string;
  position: number;
}

function genKey(prefix: string): string {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}

export function createUser(db: Database.Database, name: string): User {
  const apiKey = genKey("rk");
  const adminKey = genKey("ak");
  const info = db.prepare(
    `INSERT INTO users (name, api_key, admin_key) VALUES (?, ?, ?)`
  ).run(name, apiKey, adminKey);
  return {
    id: info.lastInsertRowid as number,
    name,
    api_key: apiKey,
    admin_key: adminKey,
    enabled: true,
    created_at: new Date().toISOString(),
  };
}

function loadAccountsFor(db: Database.Database, userId: number): AccountLite[] {
  return db.prepare(
    `SELECT id, label, provider, credit_type, enabled, rate_limited_until, backoff_level, status, position
     FROM accounts WHERE user_id = ? ORDER BY position`
  ).all(userId) as AccountLite[];
}

export function getUserByApiKey(db: Database.Database, apiKey: string): UserWithAccounts | null {
  const row = db.prepare(`SELECT * FROM users WHERE api_key = ? AND enabled = 1`).get(apiKey) as User | undefined;
  if (!row) return null;
  return { ...row, accounts: loadAccountsFor(db, row.id) };
}

export function getUserByAdminKey(db: Database.Database, adminKey: string): UserWithAccounts | null {
  const row = db.prepare(`SELECT * FROM users WHERE admin_key = ? AND enabled = 1`).get(adminKey) as User | undefined;
  if (!row) return null;
  return { ...row, accounts: loadAccountsFor(db, row.id) };
}

export function listUsers(db: Database.Database): User[] {
  return db.prepare(`SELECT * FROM users ORDER BY id`).all() as User[];
}
```

- [ ] **Step 4: Write `src/db/repos/accounts.ts`**

```ts
import type Database from "better-sqlite3";

export interface Account {
  id: string;
  user_id: number;
  label: string;
  provider: string;
  credit_type: string;
  api_key: string;
  base_url: string | null;
  enabled: boolean;
  rate_limited_until: string | null;
  backoff_level: number;
  last_error: string | null;
  status: string;
  position: number;
  created_at: string;
}

export type AccountCreate = Omit<Account, "provider" | "base_url" | "enabled" | "rate_limited_until" | "backoff_level" | "last_error" | "status" | "position" | "created_at"> & {
  base_url?: string | null;
  enabled?: boolean;
  position?: number;
};

export function createAccount(db: Database.Database, input: AccountCreate): Account {
  db.prepare(`
    INSERT INTO accounts (id, user_id, label, provider, credit_type, api_key, base_url, enabled, position)
    VALUES (?, ?, ?, 'minimax', ?, ?, ?, ?, ?)
  `).run(
    input.id, input.user_id, input.label, input.credit_type, input.api_key,
    input.base_url ?? null, input.enabled === false ? 0 : 1, input.position ?? 0,
  );
  return getAccount(db, input.id)!;
}

export function getAccount(db: Database.Database, id: string): Account | null {
  return db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as Account | null;
}

export function listAccountsByUser(db: Database.Database, userId: number): Account[] {
  return db.prepare(`SELECT * FROM accounts WHERE user_id = ? ORDER BY position`).all(userId) as Account[];
}

export function updateAccount(db: Database.Database, id: string, patch: Partial<Account>): void {
  const keys = Object.keys(patch).filter(k => k !== "id" && k !== "created_at");
  if (keys.length === 0) return;
  const set = keys.map(k => `${k} = ?`).join(", ");
  const values = keys.map(k => (patch as any)[k]);
  db.prepare(`UPDATE accounts SET ${set} WHERE id = ?`).run(...values, id);
}

export interface ModelLock {
  account_id: string;
  model: string;
  locked_until: string;
}

export function setModelLock(db: Database.Database, accountId: string, model: string, cooldownMs: number): void {
  const lockedUntil = new Date(Date.now() + cooldownMs).toISOString();
  db.prepare(`
    INSERT INTO account_model_locks (account_id, model, locked_until)
    VALUES (?, ?, ?)
    ON CONFLICT(account_id, model) DO UPDATE SET locked_until = excluded.locked_until
  `).run(accountId, model, lockedUntil);
}

export function getModelLock(db: Database.Database, accountId: string, model: string): ModelLock | undefined {
  return db.prepare(`SELECT * FROM account_model_locks WHERE account_id = ? AND model = ?`)
    .get(accountId, model) as ModelLock | undefined;
}

export function clearExpiredModelLocks(db: Database.Database): void {
  db.prepare(`DELETE FROM account_model_locks WHERE locked_until < datetime('now')`).run();
}
```

- [ ] **Step 5: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 31 tests (11 new)

- [ ] **Step 6: Commit**

```bash
git add src/db/repos/
git commit -m "feat: users + accounts + model_locks repos"
```

---

## Task 2.3: Account state machine (backoff, errorRules, state)

**Files:**
- Create: `src/accounts/types.ts`
- Create: `src/accounts/backoff.ts`
- Create: `src/accounts/errorRules.ts`
- Create: `src/accounts/state.ts`
- Create: `src/accounts/{backoff,errorRules,state}.test.ts`

- [ ] **Step 1: Write `src/accounts/types.ts`**

```ts
export type CreditType = "payg" | "token-plan";
export type AccountStatus = "active" | "error" | "disabled";
export type SelectionMode = "sticky" | "round-robin";

export interface AccountState {
  id: string;
  backoffLevel: number;
  rateLimitedUntil: string | null;
  lastError: { status: number; message: string; timestamp: string; baseRespCode?: number } | null;
  status: AccountStatus;
  enabled: boolean;
}

export interface ModelLock {
  accountId: string;
  model: string;
  lockedUntil: string;
}
```

- [ ] **Step 2: Write failing test for backoff**

`src/accounts/backoff.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { getQuotaCooldown } from "./backoff.js";

describe("getQuotaCooldown", () => {
  it("level 1 → 1s", () => expect(getQuotaCooldown(1)).toBe(1000));
  it("level 2 → 2s", () => expect(getQuotaCooldown(2)).toBe(2000));
  it("level 3 → 4s", () => expect(getQuotaCooldown(3)).toBe(4000));
  it("level 4 → 8s", () => expect(getQuotaCooldown(4)).toBe(8000));
  it("level 8 → 4 min cap (240000ms)", () => expect(getQuotaCooldown(8)).toBe(240_000));
  it("level 9 → also 4 min cap", () => expect(getQuotaCooldown(9)).toBe(240_000));
  it("level 0 → 0 (no cooldown)", () => expect(getQuotaCooldown(0)).toBe(0));
});
```

- [ ] **Step 3: Run test (expect fail)**

Run: `npm test`
Expected: FAIL

- [ ] **Step 4: Write `src/accounts/backoff.ts`**

```ts
const BASE_MS = 1000;
const MAX_MS = 4 * 60 * 1000;

export function getQuotaCooldown(backoffLevel: number): number {
  if (backoffLevel <= 0) return 0;
  const level = backoffLevel - 1;
  const ms = BASE_MS * Math.pow(2, level);
  return Math.min(ms, MAX_MS);
}

export const BACKOFF_MAX_LEVEL = 8;
```

- [ ] **Step 5: Write failing test for errorRules**

`src/accounts/errorRules.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { checkFallbackError } from "./errorRules.js";

describe("checkFallbackError", () => {
  it("honors Retry-After header on 429 (priority 1)", () => {
    const d = checkFallbackError(429, "rate limit", undefined, 0, undefined, 30);
    expect(d.cooldownMs).toBe(30_000);
    expect(d.source).toBe("rule");
  });

  it("uses window reset for baseResp 2056 (priority 2)", () => {
    const d = checkFallbackError(200, "window exhausted", 2056, 0, 600_000, undefined);
    expect(d.cooldownMs).toBe(600_000);
    expect(d.source).toBe("window-reset");
  });

  it("uses window reset for baseResp 2061 (priority 2)", () => {
    const d = checkFallbackError(200, "window exhausted", 2061, 0, 1_200_000, undefined);
    expect(d.cooldownMs).toBe(1_200_000);
  });

  it("falls back to exponential for text 'rate limit' (priority 3)", () => {
    const d = checkFallbackError(200, "rate limit reached", 1002, 1);
    expect(d.cooldownMs).toBe(2000);
    expect(d.newBackoffLevel).toBe(2);
  });

  it("falls back to exponential for status 429 (priority 3)", () => {
    const d = checkFallbackError(429, "", undefined, 2);
    expect(d.cooldownMs).toBe(4000);
  });

  it("status 401 → no cooldown, mark error", () => {
    const d = checkFallbackError(401, "auth failed", 1004, 0);
    expect(d.cooldownMs).toBe(0);
  });

  it("status 5xx → 5s transient", () => {
    expect(checkFallbackError(500, "", undefined, 0).cooldownMs).toBe(5000);
    expect(checkFallbackError(502, "", undefined, 0).cooldownMs).toBe(5000);
    expect(checkFallbackError(503, "", undefined, 0).cooldownMs).toBe(5000);
    expect(checkFallbackError(504, "", undefined, 0).cooldownMs).toBe(5000);
  });

  it("unknown error → 5s default", () => {
    const d = checkFallbackError(418, "teapot", undefined, 0);
    expect(d.cooldownMs).toBe(5000);
  });
});
```

- [ ] **Step 6: Run test (expect fail)**

Run: `npm test`
Expected: FAIL

- [ ] **Step 7: Write `src/accounts/errorRules.ts`**

```ts
import { getQuotaCooldown, BACKOFF_MAX_LEVEL } from "./backoff.js";

export interface FallbackDecision {
  shouldFallback: boolean;
  cooldownMs: number;
  newBackoffLevel?: number;
  source: "rule" | "default" | "window-reset";
}

interface ErrorRule {
  text?: string;
  status?: number;
  backoff?: boolean;
  cooldownMs?: number;
}

const ERROR_RULES: ErrorRule[] = [
  { text: "rate limit",     backoff: true },
  { text: "rate growth",    backoff: true },
  { text: "window exhausted", cooldownMs: 0 },
  { status: 429,              backoff: true },
  { status: 401,              cooldownMs: 0 },
  { status: 400,              cooldownMs: 0 },
  { status: 500,              cooldownMs: 5000 },
  { status: 502,              cooldownMs: 5000 },
  { status: 503,              cooldownMs: 5000 },
  { status: 504,              cooldownMs: 5000 },
];

export function checkFallbackError(
  status: number,
  errorText: string,
  baseRespCode: number | undefined,
  backoffLevel: number,
  windowResetMs?: number,
  retryAfterHeader?: number,
): FallbackDecision {
  if (status === 429 && retryAfterHeader && retryAfterHeader > 0) {
    return { shouldFallback: true, cooldownMs: retryAfterHeader * 1000, source: "rule" };
  }
  if ((baseRespCode === 2056 || baseRespCode === 2061) && windowResetMs && windowResetMs > 0) {
    return { shouldFallback: true, cooldownMs: windowResetMs, source: "window-reset" };
  }
  const lower = (errorText || "").toLowerCase();
  for (const rule of ERROR_RULES) {
    if (rule.text && lower.includes(rule.text)) {
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_MAX_LEVEL);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel, source: "rule" };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs ?? 0, source: "rule" };
    }
    if (rule.status && rule.status === status) {
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_MAX_LEVEL);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel, source: "rule" };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs ?? 0, source: "rule" };
    }
  }
  return { shouldFallback: true, cooldownMs: 5000, source: "default" };
}
```

- [ ] **Step 8: Write failing test for state**

`src/accounts/state.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { applyErrorState, resetAccountState, isAccountUnavailable, isModelLockActive } from "./state.js";
import type { AccountState, ModelLock } from "./types.js";

const base: AccountState = {
  id: "acc_1", backoffLevel: 0, rateLimitedUntil: null, lastError: null,
  status: "active", enabled: true,
};

describe("state machine", () => {
  it("applyErrorState on 429 sets rateLimitedUntil and bumps backoff", () => {
    const { account, newBackoffLevel } = applyErrorState(base, 429, "rate limit", undefined, undefined, undefined);
    expect(newBackoffLevel).toBe(1);
    expect(new Date(account.rateLimitedUntil!).getTime()).toBeGreaterThan(Date.now());
  });

  it("applyErrorState on 401 sets status=error, no cooldown", () => {
    const { account } = applyErrorState(base, 401, "auth failed", 1004);
    expect(account.status).toBe("error");
    expect(account.rateLimitedUntil).toBeNull();
  });

  it("resetAccountState clears everything", () => {
    const cooled: AccountState = { ...base, backoffLevel: 3, rateLimitedUntil: "2099-01-01", lastError: { status: 429, message: "x", timestamp: "x" }, status: "error" };
    const r = resetAccountState(cooled);
    expect(r.backoffLevel).toBe(0);
    expect(r.rateLimitedUntil).toBeNull();
    expect(r.lastError).toBeNull();
    expect(r.status).toBe("active");
  });

  it("isAccountUnavailable true when rateLimitedUntil in future", () => {
    const a: AccountState = { ...base, rateLimitedUntil: new Date(Date.now() + 60_000).toISOString() };
    expect(isAccountUnavailable(a)).toBe(true);
  });

  it("isAccountUnavailable false when expired", () => {
    const a: AccountState = { ...base, rateLimitedUntil: new Date(Date.now() - 1000).toISOString() };
    expect(isAccountUnavailable(a)).toBe(false);
  });

  it("isModelLockActive respects lockedUntil", () => {
    const l: ModelLock = { accountId: "a", model: "m", lockedUntil: new Date(Date.now() + 60_000).toISOString() };
    expect(isModelLockActive(l)).toBe(true);
    const expired: ModelLock = { ...l, lockedUntil: new Date(Date.now() - 1).toISOString() };
    expect(isModelLockActive(expired)).toBe(false);
  });
});
```

- [ ] **Step 9: Run test (expect fail)**

Run: `npm test`
Expected: FAIL

- [ ] **Step 10: Write `src/accounts/state.ts`**

```ts
import { checkFallbackError } from "./errorRules.js";
import type { AccountState, ModelLock } from "./types.js";

export function applyErrorState(
  account: AccountState,
  status: number,
  errorText: string,
  baseRespCode?: number,
  windowResetMs?: number,
  retryAfterHeader?: number,
): { account: AccountState; newBackoffLevel: number; shouldDisable: boolean } {
  const decision = checkFallbackError(status, errorText, baseRespCode, account.backoffLevel, windowResetMs, retryAfterHeader);
  const newAccount: AccountState = {
    ...account,
    rateLimitedUntil: decision.cooldownMs > 0
      ? new Date(Date.now() + decision.cooldownMs).toISOString()
      : null,
    backoffLevel: decision.newBackoffLevel ?? account.backoffLevel,
    lastError: { status, message: errorText.slice(0, 500), timestamp: new Date().toISOString(), baseRespCode },
    status: status === 401 ? "error" : account.status,
  };
  return { account: newAccount, newBackoffLevel: newAccount.backoffLevel, shouldDisable: false };
}

export function resetAccountState(account: AccountState): AccountState {
  return { ...account, rateLimitedUntil: null, backoffLevel: 0, lastError: null, status: "active" };
}

export function isAccountUnavailable(account: AccountState): boolean {
  if (!account.rateLimitedUntil) return false;
  return new Date(account.rateLimitedUntil).getTime() > Date.now();
}

export function isModelLockActive(lock: ModelLock | undefined): boolean {
  if (!lock) return false;
  return new Date(lock.lockedUntil).getTime() > Date.now();
}

export function filterAvailableAccounts(accounts: AccountState[], excludeId?: string): AccountState[] {
  return accounts.filter(a => {
    if (!a.enabled) return false;
    if (a.status === "disabled") return false;
    if (excludeId && a.id === excludeId) return false;
    if (isAccountUnavailable(a)) return false;
    return true;
  });
}
```

- [ ] **Step 11: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 50 tests (19 new)

- [ ] **Step 12: Commit**

```bash
git add src/accounts/
git commit -m "feat: accounts state machine (backoff + errorRules + state)"
```

---

## Task 2.4: Account selection (sticky + round-robin)

**Files:**
- Create: `src/accounts/selection.ts`
- Create: `src/accounts/selection.test.ts`

- [ ] **Step 1: Write failing test**

`src/accounts/selection.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { selectAccount } from "./selection.js";
import type { AccountState } from "./types.js";

function acc(id: string, level = 0, limited = false): AccountState {
  return {
    id, backoffLevel: level,
    rateLimitedUntil: limited ? new Date(Date.now() + 60_000).toISOString() : null,
    lastError: null, status: "active", enabled: true,
  };
}

describe("selectAccount", () => {
  it("round-robin: returns first available", () => {
    const a = selectAccount([acc("a"), acc("b")], "round-robin");
    expect(a?.id).toBe("a");
  });

  it("round-robin: skips rate-limited account", () => {
    const a = selectAccount([acc("a", 0, true), acc("b")], "round-robin");
    expect(a?.id).toBe("b");
  });

  it("round-robin: returns null if all limited", () => {
    const a = selectAccount([acc("a", 0, true), acc("b", 0, true)], "round-robin");
    expect(a).toBeNull();
  });

  it("sticky: pins to sticky key's account if available", () => {
    const stickyMap = new Map<string, string>([["sess_1", "b"]]);
    const a = selectAccount([acc("a"), acc("b")], "sticky", "sess_1", stickyMap);
    expect(a?.id).toBe("b");
  });

  it("sticky: falls back to any available if pinned is limited", () => {
    const stickyMap = new Map<string, string>([["sess_1", "b"]]);
    const a = selectAccount([acc("a"), acc("b", 0, true)], "sticky", "sess_1", stickyMap);
    expect(a?.id).toBe("a");
  });

  it("sticky without stickyKey behaves like round-robin", () => {
    const a = selectAccount([acc("a"), acc("b")], "sticky");
    expect(a?.id).toBe("a");
  });

  it("picks lowest backoff level", () => {
    const a = selectAccount([acc("a", 3), acc("b", 1), acc("c", 2)], "round-robin");
    expect(a?.id).toBe("b");
  });

  it("skips disabled accounts", () => {
    const a = selectAccount([{ ...acc("a"), enabled: false }, acc("b")], "round-robin");
    expect(a?.id).toBe("b");
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: Write `src/accounts/selection.ts`**

```ts
import { filterAvailableAccounts } from "./state.js";
import type { AccountState, SelectionMode } from "./types.js";

export function selectAccount(
  accounts: AccountState[],
  mode: SelectionMode,
  stickyKey?: string,
  stickyMap?: Map<string, string>,
): AccountState | null {
  const available = filterAvailableAccounts(accounts);
  if (available.length === 0) return null;

  if (mode === "sticky" && stickyKey && stickyMap?.has(stickyKey)) {
    const pinnedId = stickyMap.get(stickyKey)!;
    const pinned = available.find(a => a.id === pinnedId);
    if (pinned) return pinned;
  }

  return available.sort((a, b) => a.backoffLevel - b.backoffLevel)[0];
}
```

- [ ] **Step 4: Run test (expect pass)**

Run: `npm test`
Expected: PASS — 58 tests

- [ ] **Step 5: Commit**

```bash
git add src/accounts/selection.ts src/accounts/selection.test.ts
git commit -m "feat: accounts/selection (sticky + round-robin)"
```

---

## Task 2.5: Auth middleware (requireApiKey + requireAdmin)

**Files:**
- Create: `src/auth.ts`
- Create: `src/auth.test.ts`

- [ ] **Step 1: Write failing tests**

`src/auth.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Hono } from "hono";
import { openDb } from "./db/index.js";
import { createUser } from "./db/repos/users.js";
import { requireApiKey, requireAdmin } from "./auth.js";

let db: ReturnType<typeof openDb>;
let user: { api_key: string; admin_key: string };

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "auth-")), "t.db");
  db = openDb();
  user = createUser(db, "tester");
});

function buildApp() {
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("db", db); await next(); });
  app.get("/p", requireApiKey, (c) => c.json({ user: c.get("user")!.name }));
  app.get("/a", requireAdmin, (c) => c.json({ user: c.get("user")!.name }));
  return app;
}

describe("requireApiKey", () => {
  it("401 when no header", async () => {
    const res = await buildApp().request("/p");
    expect(res.status).toBe(401);
  });

  it("401 when bad key", async () => {
    const res = await buildApp().request("/p", { headers: { Authorization: "Bearer rk_wrong" } });
    expect(res.status).toBe(401);
  });

  it("200 with valid Bearer", async () => {
    const res = await buildApp().request("/p", { headers: { Authorization: `Bearer ${user.api_key}` } });
    expect(res.status).toBe(200);
    expect((await res.json()).user).toBe("tester");
  });

  it("200 with x-api-key header (Anthropic style)", async () => {
    const res = await buildApp().request("/p", { headers: { "x-api-key": user.api_key } });
    expect(res.status).toBe(200);
  });
});

describe("requireAdmin", () => {
  it("403 when proxy api_key (not admin)", async () => {
    const res = await buildApp().request("/a", { headers: { Authorization: `Bearer ${user.api_key}` } });
    expect(res.status).toBe(403);
  });

  it("200 with admin_key", async () => {
    const res = await buildApp().request("/a", { headers: { Authorization: `Bearer ${user.admin_key}` } });
    expect(res.status).toBe(200);
  });

  it("200 with x-admin-key header", async () => {
    const res = await buildApp().request("/a", { headers: { "x-admin-key": user.admin_key } });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: Write `src/auth.ts`**

```ts
import type { Context, Next } from "hono";
import { getUserByApiKey, getUserByAdminKey } from "./db/repos/users.js";
import type { UserWithAccounts } from "./db/repos/users.js";

declare module "hono" {
  interface ContextVariableMap {
    db: import("better-sqlite3").Database.Database;
    user: UserWithAccounts;
  }
}

function extractKey(c: Context): string | null {
  const auth = c.req.header("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return c.req.header("x-api-key") ?? c.req.header("x-admin-key") ?? null;
}

export async function requireApiKey(c: Context, next: Next): Promise<Response | void> {
  const key = extractKey(c);
  if (!key) return c.json({ error: "missing API key" }, 401);
  const db = c.get("db");
  const user = getUserByApiKey(db, key);
  if (!user) return c.json({ error: "invalid API key" }, 401);
  c.set("user", user);
  await next();
}

export async function requireAdmin(c: Context, next: Next): Promise<Response | void> {
  const key = extractKey(c);
  if (!key) return c.json({ error: "missing admin key" }, 401);
  const db = c.get("db");
  const userByAdmin = getUserByAdminKey(db, key);
  if (userByAdmin) {
    c.set("user", userByAdmin);
    await next();
    return;
  }
  const userByApi = getUserByApiKey(db, key);
  if (userByApi) {
    return c.json({ error: "admin endpoint requires admin key" }, 403);
  }
  return c.json({ error: "invalid key" }, 401);
}
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 65 tests (7 new)

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts src/auth.test.ts
git commit -m "feat: auth middleware (apiKey + admin with separate keys)"
```

---

## Task 2.6: CLI scripts (add-user, add-account)

**Files:**
- Create: `scripts/add-user.ts`
- Create: `scripts/add-account.ts`

- [ ] **Step 1: Write `scripts/add-user.ts`**

```ts
#!/usr/bin/env tsx
import { openDb } from "../src/db/index.js";
import { createUser } from "../src/db/repos/users.js";
import { log } from "../src/util/log.js";

const args = process.argv.slice(2);
const nameIdx = args.indexOf("--name");
const name = nameIdx >= 0 ? args[nameIdx + 1] : null;
if (!name) {
  console.error("Usage: add-user.ts --name <name>");
  process.exit(1);
}

const db = openDb();
const user = createUser(db, name);
log.info({ id: user.id, name: user.name }, "user created");
console.log(`User created: ${user.name}`);
console.log(`  api_key:  ${user.api_key}    (use for proxy requests)`);
console.log(`  admin_key: ${user.admin_key}    (use for /admin/* routes)`);
```

- [ ] **Step 2: Write `scripts/add-account.ts`**

```ts
#!/usr/bin/env tsx
import { ulid } from "ulid";
import { openDb } from "../src/db/index.js";
import { createAccount, listAccountsByUser } from "../src/db/repos/accounts.js";
import { log } from "../src/util/log.js";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

const userId = arg("user");
const label = arg("label");
const creditType = arg("credit-type") as "payg" | "token-plan" | null;
const apiKey = arg("api-key");
const baseUrl = arg("base-url");

if (!userId || !label || !creditType || !apiKey) {
  console.error("Usage: add-account.ts --user <id> --label <label> --credit-type payg|token-plan --api-key <key> [--base-url <url>]");
  process.exit(1);
}

const db = openDb();
const existing = listAccountsByUser(db, parseInt(userId, 10));
const account = createAccount(db, {
  id: `acc_${ulid()}`,
  user_id: parseInt(userId, 10),
  label,
  credit_type: creditType,
  api_key: apiKey,
  base_url: baseUrl,
  position: existing.length,
});
log.info({ id: account.id, label }, "account created");
console.log(`Account created: ${account.label} (${account.id})`);
```

- [ ] **Step 3: Install ulid**

Run: `npm install ulid`
Expected: dep added

- [ ] **Step 4: Manual test**

Run: `ROUTER_DB_PATH=/tmp/test-cli.db tsx scripts/add-user.ts --name alice`
Expected: prints api_key + admin_key
Run: `ROUTER_DB_PATH=/tmp/test-cli.db tsx scripts/add-account.ts --user 1 --label "PAYG main" --credit-type payg --api-key mm_test`
Expected: prints account id

- [ ] **Step 5: Commit**

```bash
git add scripts/ package.json package-lock.json
git commit -m "feat: CLI scripts (add-user, add-account)"
```

---

## Task 2.7: Wire multi-account into handleProxy (full integration)

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Write integration test for 503-no-accounts case**

`src/server.test.ts` (append):
```ts
import { openDb } from "./db/index.js";
import { createUser } from "./db/repos/users.js";
import { createAccount } from "./db/repos/accounts.js";

describe("handleProxy with auth + accounts", () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "ha-")), "t.db");
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
    const headers = spy.mock.calls[0][1].headers as any;
    expect(headers.Authorization).toBe("Bearer mm_real_key");
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

Run: `npm test`
Expected: FAIL — server.ts doesn't have auth wired

- [ ] **Step 3: Rewrite `src/server.ts`**

```ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { openDb } from "./db/index.js";
import { requireApiKey, requireAdmin } from "./auth.js";
import { getBaseUrl } from "./providers/baseUrl.js";
import { buildHeaders } from "./providers/headers.js";
import { proxyAwareFetch } from "./transport/proxyFetch.js";
import { selectAccount } from "./accounts/selection.js";
import { checkFallbackError } from "./accounts/errorRules.js";
import { updateAccount } from "./db/repos/accounts.js";
import { log } from "./util/log.js";
import type Database from "better-sqlite3";
import type { AccountState } from "./accounts/types.js";

const db = openDb();
const app = new Hono();
app.use("*", async (c, next) => {
  c.set("db", db);
  c.set("startTime", Date.now());
  await next();
});

app.get("/health", (c) => c.json({ ok: true }));

function userSettings(db: Database.Database, userId: number): { mode: "sticky" | "round-robin"; stickyKey: string } {
  const row = db.prepare(`SELECT value FROM user_settings WHERE user_id = ? AND key = 'account_mode'`).get(userId) as { value: string } | undefined;
  if (!row) return { mode: "round-robin", stickyKey: "x-router-key" };
  return JSON.parse(row.value);
}

async function handleProxy(c: any, format: "openai" | "anthropic", upstreamPath: string): Promise<Response> {
  const user = c.get("user");
  const body = await c.req.json();
  const cfg = userSettings(c.get("db"), user.id);
  const accountStates: AccountState[] = user.accounts.map(a => ({
    id: a.id, backoffLevel: 0, rateLimitedUntil: a.rate_limited_until, lastError: null, status: a.status as any, enabled: !!a.enabled,
  }));
  const stickyKey = c.req.header(cfg.stickyKey);
  const account = selectAccount(accountStates, cfg.mode, stickyKey ?? undefined);
  if (!account) return c.json({ error: "all accounts unavailable" }, 503);

  const acc = user.accounts.find(a => a.id === account.id)!;
  const url = `${getBaseUrl({ provider: "minimax", baseUrl: acc.base_url }, format)}${upstreamPath}`;
  const headers = buildHeaders({ provider: "minimax", apiKey: acc.api_key }, body.stream === true, format);

  try {
    const resp = await proxyAwareFetch(url, { method: "POST", headers, body: JSON.stringify(body) }, { relay: null, proxy: null });
    if (!resp.ok) {
      const errBody = await resp.text();
      let baseRespCode: number | undefined;
      try { baseRespCode = JSON.parse(errBody).base_resp?.status_code; } catch {}
      const decision = checkFallbackError(resp.status, errBody, baseRespCode, 0);
      const rateLimitedUntil = decision.cooldownMs > 0
        ? new Date(Date.now() + decision.cooldownMs).toISOString()
        : null;
      updateAccount(c.get("db"), account.id, {
        rate_limited_until: rateLimitedUntil,
        backoff_level: decision.newBackoffLevel ?? 0,
        last_error: JSON.stringify({ status: resp.status, message: errBody.slice(0, 500), timestamp: new Date().toISOString(), baseRespCode }),
        status: resp.status === 401 ? "error" : "active",
      });
      return c.body(errBody, resp.status as any, {
        "content-type": resp.headers.get("content-type") ?? "application/json",
      });
    }
    updateAccount(c.get("db"), account.id, { rate_limited_until: null, backoff_level: 0, last_error: null, status: "active" });
    return c.body(await resp.text(), resp.status as any, {
      "content-type": resp.headers.get("content-type") ?? "application/json",
    });
  } catch (e: any) {
    log.error({ err: e.message }, "upstream unreachable");
    return c.json({ error: `upstream unreachable: ${e.message}` }, 502);
  }
}

app.post("/v1/chat/completions", requireApiKey, (c) => handleProxy(c, "openai", "/v1/chat/completions"));
app.post("/v1/messages", requireApiKey, (c) => handleProxy(c, "anthropic", "/v1/messages"));
app.post("/v1/messages/count_tokens", requireApiKey, (c) => handleProxy(c, "anthropic", "/v1/messages/count_tokens"));
app.post("/v1/embeddings", requireApiKey, (c) => handleProxy(c, "openai", "/v1/embeddings"));
app.get("/v1/models", requireApiKey, (c) => handleProxy(c, "openai", "/v1/models"));

export { app };

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT ?? "20137", 10);
  const hostname = process.env.HOST ?? "127.0.0.1";
  serve({ fetch: app.fetch, port, hostname }, (info) => {
    log.info({ address: info.address, port: info.port }, "router listening");
  });
}
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `npm test`
Expected: PASS — 67 tests (2 new)

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat: wire auth + account selection into handleProxy"
```

---

## Task 2.8: Phase 2 checkpoint

- [ ] **Step 1: Run full suite**

Run: `npm test`
Expected: 67+ tests pass

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit + tag**

```bash
git add .
git commit -m "chore: phase 2 v0.2 checkpoint" --allow-empty
git tag v0.2
```

---

**End of Phase 2.** Continue to [Phase 3: v0.3 Model Registry](./2026-06-01-minimax-router-phase-3-v03-model-registry.md).
