# v0.9 Gaps Closure — Dashboard CRUD + Fetch-from-upstream fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all remaining v0.9 gaps so every action available via the dashboard actually works through the UI, fix the "Fetch from upstream" 404 path, add login hardening, refresh README, and delete dead code.

**Architecture:** Each task is a self-contained TDD loop (test → impl → commit). Form-based dashboard CRUD per existing pattern. Rate-limit via in-memory bucket keyed by IP. CSRF via Origin header check (Hono `secureHeaders` baseline + custom origin guard). README gets a v0.9 addendum section.

**Tech Stack:** Hono, better-sqlite3, TypeScript strict, scrypt, in-memory token bucket (no Redis), vitest.

---

## File Structure

**Files to create:**
- `tests/integration/auth.test.ts` — login + logout + rate-limit + CSRF + CRUD integration
- `tests/integration/dashboard.test.ts` — UI-driven flows for accounts/keys/models
- `src/auth/rateLimit.ts` — in-memory token bucket for /login
- `src/dashboard/pages/usage.test.ts` — unit test for usage render with account labels

**Files to modify:**
- `src/db/repos/accounts.ts` — add `enableAccount`, `disableAccount` (already partial), `deleteAccount`
- `src/db/repos/client_keys.ts` — add `enableClientKey`, `deleteClientKey`
- `src/db/repos/models.ts` — add `enableModel`
- `src/db/repos/users.ts` — delete dead `getAdminKey` if no longer referenced
- `src/server.ts` — wire all new POST routes, replace `/admin/models/fetch` to handle 404, add CSRF middleware, add rate limit
- `src/dashboard/pages/accounts.ts` — add per-row enable/disable/delete forms
- `src/dashboard/pages/clientKeys.ts` — add per-row disable/delete forms
- `src/dashboard/pages/models.ts` — add per-row enable/disable + "Fetch from upstream" button + flash message
- `src/dashboard/pages/usage.ts` — show account labels instead of IDs
- `src/auth.ts` — Secure cookie when behind HTTPS, same-origin CSRF guard, rate limit hook
- `src/providers/listModels.ts` — graceful 404 handling, structured FetchModelsResult
- `README.md` — v0.9 addendum

**Files to read for context:**
- `src/auth.ts` — current auth helpers + renderLoginPage
- `src/server.ts` — current route map (24 routes)
- `src/db/repos/{accounts,client_keys,models}.ts` — current CRUD functions
- `src/dashboard/theme.ts` + `layout.ts` — obsidian-gold theme

---

## Task 1: Cleanup — delete dead `getAdminKey` from `users.ts`

**Files:**
- Modify: `src/db/repos/users.ts`
- Modify: `src/server.ts` (remove import if any)

- [ ] **Step 1: Search for any remaining `getAdminKey` usage**

Run: `grep -rn "getAdminKey" src/ scripts/ tests/`
Expected: only declaration in `src/db/repos/users.ts`. No callers (replaced by password auth in v0.9).

- [ ] **Step 2: Replace `users.ts` with empty stub or delete file**

If `getAdminKey` has no callers, replace the entire `src/db/repos/users.ts` content with:

```ts
// users table dropped in v0.7 (consolidated 001). Admin auth now uses
// password (see auth/password.ts) + sessions (see auth/session.ts).
export {};
```

- [ ] **Step 3: Run tests + typecheck**

Run: `npm test 2>&1 | tail -5 && npm run typecheck 2>&1 | tail -3`
Expected: 227 pass, typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add src/db/repos/users.ts
git commit -m "chore: delete dead getAdminKey (replaced by password auth in v0.9)"
```

---

## Task 2: Login + logout integration tests

**Files:**
- Create: `tests/integration/auth.test.ts`

- [ ] **Step 1: Create test directory + write the test file**

Create `tests/integration/auth.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { app, resetDb } from "../../src/server.js";
import { openDb } from "../../src/db/index.js";
import { clearCache as clearSettingsCache } from "../../src/db/repos/settings.js";
import { hashPassword } from "../../src/auth/password.js";

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "auth-")), "t.db");
  resetDb();
  clearSettingsCache();
});

describe("POST /login", () => {
  it("sets session cookie + redirects to /admin when password correct", async () => {
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(JSON.stringify(hashPassword("hunter2")));

    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=hunter2",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("kelola_session=");
    expect(cookie).toContain("HttpOnly");
  });

  it("returns 401 login page with error when password wrong", async () => {
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(JSON.stringify(hashPassword("hunter2")));

    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=wrong",
    });
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toContain("Wrong password");
  });

  it("redirects to /admin (no-op login) when no password set", async () => {
    const res = await app.request("/login", { method: "POST" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin");
  });
});

describe("POST /logout", () => {
  it("clears the session cookie + redirects home", async () => {
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(JSON.stringify(hashPassword("x")));

    const login = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=x",
    });
    const setCookie = login.headers.get("set-cookie") ?? "";
    const sid = /kelola_session=([^;]+)/.exec(setCookie)?.[1];
    expect(sid).toBeTruthy();

    const logout = await app.request("/logout", {
      method: "POST",
      headers: { Cookie: `kelola_session=${sid}` },
    });
    expect(logout.status).toBe(302);
    expect(logout.headers.get("location")).toBe("/");
    const cleared = logout.headers.get("set-cookie") ?? "";
    expect(cleared).toMatch(/kelola_session=;/);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/integration/auth.test.ts`
Expected: PASS — current code already implements handleLogin + handleLogout + session cookies. No impl changes needed for this task.

- [ ] **Step 3: Run full test suite**

Run: `npm test 2>&1 | tail -5`
Expected: 230+ pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/auth.test.ts
git commit -m "test: login + logout integration coverage"
```

---


## Task 3: Account CRUD — `enableAccount` + `deleteAccount` + `disableAccount` in repo

**Files:**
- Modify: `src/db/repos/accounts.ts`
- Modify: `src/db/repos/accounts.test.ts`

- [ ] **Step 1: Write failing test**

Append to `src/db/repos/accounts.test.ts`:

```ts
  it("enableAccount sets enabled=1", () => {
    createAccount(db, { id: "acc_e", label: "L", credit_type: "payg", api_key: "k" });
    db.prepare(`UPDATE accounts SET enabled = 0 WHERE id = 'acc_e'`).run();
    enableAccount(db, "acc_e");
    expect(getAccount(db, "acc_e")?.enabled).toBe(1);
  });

  it("disableAccount sets enabled=0", () => {
    createAccount(db, { id: "acc_d", label: "L", credit_type: "payg", api_key: "k" });
    disableAccount(db, "acc_d");
    expect(getAccount(db, "acc_d")?.enabled).toBe(0);
  });

  it("deleteAccount removes the row", () => {
    createAccount(db, { id: "acc_x", label: "L", credit_type: "payg", api_key: "k" });
    deleteAccount(db, "acc_x");
    expect(getAccount(db, "acc_x")).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/repos/accounts.test.ts`
Expected: FAIL — `enableAccount` and `deleteAccount` and `disableAccount` not exported (only `updateAccount` is).

- [ ] **Step 3: Add the three functions to `src/db/repos/accounts.ts`**

Append at the end of the file:

```ts
export function enableAccount(db: Database.Database, id: string): void {
  db.prepare(`UPDATE accounts SET enabled = 1 WHERE id = ?`).run(id);
}

export function disableAccount(db: Database.Database, id: string): void {
  db.prepare(`UPDATE accounts SET enabled = 0 WHERE id = ?`).run(id);
}

export function deleteAccount(db: Database.Database, id: string): void {
  db.prepare(`DELETE FROM accounts WHERE id = ?`).run(id);
}
```

Also add the three names to the import in the test file:

```ts
import {
  createAccount, getAccount, listAccounts, getAccountByApiKey,
  enableAccount, disableAccount, deleteAccount, updateAccount,
} from "./accounts.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/repos/accounts.test.ts`
Expected: PASS (8 tests now, was 5).

- [ ] **Step 5: Commit**

```bash
git add src/db/repos/accounts.ts src/db/repos/accounts.test.ts
git commit -m "feat(accounts): enableAccount + disableAccount + deleteAccount repo functions"
```

---

## Task 4: Account CRUD — dashboard UI forms + POST routes

**Files:**
- Modify: `src/dashboard/pages/accounts.ts`
- Modify: `src/server.ts`
- Modify: `tests/integration/auth.test.ts` (add the 3 tests)

- [ ] **Step 1: Write failing test (append to `tests/integration/auth.test.ts`)**

```ts
import { enableAccount, disableAccount, deleteAccount, listAccounts, getAccount } from "../../src/db/repos/accounts.js";

describe("/admin/accounts actions", () => {
  it("POST /admin/accounts/:id/enable sets enabled=1", async () => {
    const db = openDb();
    createAccount(db, { id: "acc_e", label: "L", credit_type: "payg", api_key: "k" });
    db.prepare(`UPDATE accounts SET enabled = 0 WHERE id = 'acc_e'`).run();
    const res = await app.request("/admin/accounts/acc_e/enable", { method: "POST" });
    expect(res.status).toBe(302);
    expect(getAccount(db, "acc_e")?.enabled).toBe(1);
  });

  it("POST /admin/accounts/:id/disable sets enabled=0", async () => {
    const db = openDb();
    createAccount(db, { id: "acc_d", label: "L", credit_type: "payg", api_key: "k" });
    const res = await app.request("/admin/accounts/acc_d/disable", { method: "POST" });
    expect(res.status).toBe(302);
    expect(getAccount(db, "acc_d")?.enabled).toBe(0);
  });

  it("POST /admin/accounts/:id/delete removes the account", async () => {
    const db = openDb();
    createAccount(db, { id: "acc_x", label: "L", credit_type: "payg", api_key: "k" });
    const res = await app.request("/admin/accounts/acc_x/delete", { method: "POST" });
    expect(res.status).toBe(302);
    expect(getAccount(db, "acc_x")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/auth.test.ts`
Expected: FAIL — routes 404.

- [ ] **Step 3: Add the three POST routes to `src/server.ts`**

Add after the existing `app.post("/admin/accounts", ...)` block (around line 363):

```ts
app.post("/admin/accounts/:id/enable", requireAdmin, (c) => {
  enableAccount(c.get("db"), c.req.param("id"));
  return c.redirect("/admin/accounts");
});
app.post("/admin/accounts/:id/disable", requireAdmin, (c) => {
  disableAccount(c.get("db"), c.req.param("id"));
  return c.redirect("/admin/accounts");
});
app.post("/admin/accounts/:id/delete", requireAdmin, (c) => {
  deleteAccount(c.get("db"), c.req.param("id"));
  return c.redirect("/admin/accounts");
});
```

Add the import near the top:

```ts
import { listEnabledAccounts, listAccounts, updateAccount, createAccount, enableAccount, disableAccount, deleteAccount } from "./db/repos/accounts.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/auth.test.ts`
Expected: PASS

- [ ] **Step 5: Update `src/dashboard/pages/accounts.ts` — add per-row action forms**

Replace the `accounts.map((a) => ...)` block with:

```ts
${accounts.map((a) => `
  <tr>
    <td><code>${a.id}</code></td>
    <td>${escapeHtml(a.label)}</td>
    <td><span class="badge ${a.credit_type === "token-plan" ? "badge-warn" : "badge-active"}">${a.credit_type}</span></td>
    <td><span class="badge badge-${a.enabled ? "active" : "muted"}">${a.status}</span></td>
    <td class="mono">${a.last_error ? escapeHtml(a.last_error.slice(0, 60)) : "—"}</td>
    <td>${a.backoff_level}</td>
    <td>${a.rate_limited_until ? a.rate_limited_until.slice(0, 19) : "—"}</td>
    <td style="white-space:nowrap">
      ${a.enabled
        ? `<form method="POST" action="/admin/accounts/${a.id}/disable" style="display:inline"><button class="btn-ghost" style="padding:3px 10px;font-size:10px">Disable</button></form>`
        : `<form method="POST" action="/admin/accounts/${a.id}/enable" style="display:inline"><button class="btn-ghost" style="padding:3px 10px;font-size:10px">Enable</button></form>`}
      <form method="POST" action="/admin/accounts/${a.id}/delete" style="display:inline" onsubmit="return confirm('Delete ${escapeHtml(a.label)}? Cannot be undone.')">
        <button class="btn-danger" style="padding:3px 10px;font-size:10px">Delete</button>
      </form>
    </td>
  </tr>
`).join("")}
```

Add a trailing `<th></th>` to the table header row.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/pages/accounts.ts src/server.ts tests/integration/auth.test.ts
git commit -m "feat(accounts): enable/disable/delete from dashboard UI"
```

---

## Task 5: Client key CRUD — `enableClientKey` + `deleteClientKey` + dashboard UI

**Files:**
- Modify: `src/db/repos/client_keys.ts`
- Modify: `src/server.ts`
- Modify: `src/dashboard/pages/clientKeys.ts`
- Modify: `tests/integration/auth.test.ts`

- [ ] **Step 1: Write failing test (append to `tests/integration/auth.test.ts`)**

```ts
import { enableClientKey, deleteClientKey, getClientKey } from "../../src/db/repos/client_keys.js";

describe("/admin/client-keys actions", () => {
  it("POST /admin/client-keys/:id/enable sets enabled=1", async () => {
    const db = openDb();
    createClientKey(db, { label: "k", key: "rk_1" });
    db.prepare(`UPDATE client_keys SET enabled = 0 WHERE id = ?`).run(1);
    const res = await app.request("/admin/client-keys/1/enable", { method: "POST" });
    expect(res.status).toBe(302);
    expect(getClientKey(db, 1)?.enabled).toBe(1);
  });

  it("POST /admin/client-keys/:id/disable sets enabled=0", async () => {
    const db = openDb();
    createClientKey(db, { label: "k", key: "rk_d" });
    const res = await app.request("/admin/client-keys/1/disable", { method: "POST" });
    expect(res.status).toBe(302);
    expect(getClientKey(db, 1)?.enabled).toBe(0);
  });

  it("POST /admin/client-keys/:id/delete removes the key", async () => {
    const db = openDb();
    createClientKey(db, { label: "k", key: "rk_x" });
    const res = await app.request("/admin/client-keys/1/delete", { method: "POST" });
    expect(res.status).toBe(302);
    expect(getClientKey(db, 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/auth.test.ts`
Expected: FAIL — routes 404.

- [ ] **Step 3: Add `enableClientKey` + `deleteClientKey` to `src/db/repos/client_keys.ts`**

Append:

```ts
export function enableClientKey(db: Database.Database, id: number): void {
  db.prepare(`UPDATE client_keys SET enabled = 1 WHERE id = ?`).run(id);
}

export function deleteClientKey(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM client_keys WHERE id = ?`).run(id);
}
```

- [ ] **Step 4: Add three POST routes to `src/server.ts`**

```ts
import { createClientKey, genClientKey, enableClientKey, deleteClientKey } from "./db/repos/client_keys.js";

app.post("/admin/client-keys/:id/enable", requireAdmin, (c) => {
  enableClientKey(c.get("db"), Number(c.req.param("id")));
  return c.redirect("/admin/client-keys");
});
app.post("/admin/client-keys/:id/disable", requireAdmin, (c) => {
  disableClientKey(c.get("db"), Number(c.req.param("id")));
  return c.redirect("/admin/client-keys");
});
app.post("/admin/client-keys/:id/delete", requireAdmin, (c) => {
  deleteClientKey(c.get("db"), Number(c.req.param("id")));
  return c.redirect("/admin/client-keys");
});
```

- [ ] **Step 5: Update `clientKeys.ts` — add per-row action forms**

Replace the `keys.map((k) => ...)` block:

```ts
${keys.map((k) => `
  <tr>
    <td>${k.id}</td>
    <td>${escapeHtml(k.label)}</td>
    <td class="mono">
      <code id="k${k.id}">${k.key.slice(0, 8)}••••••••••••••${k.key.slice(-4)}</code>
      <button type="button" class="btn-ghost" style="padding:2px 8px;font-size:10px;margin-left:6px" onclick="toggleKey(${k.id}, '${k.key}')">Reveal</button>
    </td>
    <td><span class="badge ${k.enabled ? "badge-active" : "badge-muted"}">${k.enabled ? "active" : "disabled"}</span></td>
    <td>${k.created_at}</td>
    <td style="white-space:nowrap">
      ${k.enabled
        ? `<form method="POST" action="/admin/client-keys/${k.id}/disable" style="display:inline"><button class="btn-ghost" style="padding:3px 10px;font-size:10px">Disable</button></form>`
        : `<form method="POST" action="/admin/client-keys/${k.id}/enable" style="display:inline"><button class="btn-ghost" style="padding:3px 10px;font-size:10px">Enable</button></form>`}
      <form method="POST" action="/admin/client-keys/${k.id}/delete" style="display:inline" onsubmit="return confirm('Delete this key? Clients using it will lose access.')">
        <button class="btn-danger" style="padding:3px 10px;font-size:10px">Delete</button>
      </form>
    </td>
  </tr>
`).join("")}
```

Add trailing `<th></th>` to header.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/integration/auth.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/db/repos/client_keys.ts src/dashboard/pages/clientKeys.ts src/server.ts tests/integration/auth.test.ts
git commit -m "feat(client-keys): enable/disable/delete from dashboard UI"
```

---

## Task 6: Model CRUD — `enableModel` + dashboard UI + Fetch button

**Files:**
- Modify: `src/db/repos/models.ts`
- Modify: `src/server.ts`
- Modify: `src/dashboard/pages/models.ts`
- Modify: `tests/integration/auth.test.ts`

- [ ] **Step 1: Write failing test (append to `tests/integration/auth.test.ts`)**

```ts
describe("/admin/models actions", () => {
  it("POST /admin/models/:name/enable sets enabled=1", async () => {
    const db = openDb();
    db.prepare(`UPDATE models SET enabled = 0 WHERE name = 'MiniMax-M3'`).run();
    const res = await app.request("/admin/models/MiniMax-M3/enable", { method: "POST" });
    expect(res.status).toBe(302);
    expect(db.prepare(`SELECT enabled FROM models WHERE name = 'MiniMax-M3'`).get()).toEqual({ enabled: 1 });
  });

  it("POST /admin/models/:name/disable sets enabled=0", async () => {
    const res = await app.request("/admin/models/MiniMax-M3/disable", { method: "POST" });
    expect(res.status).toBe(302);
    expect(db.prepare(`SELECT enabled FROM models WHERE name = 'MiniMax-M3'`).get()).toEqual({ enabled: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/auth.test.ts`
Expected: FAIL — routes 404.

- [ ] **Step 3: Add `enableModel` to `src/db/repos/models.ts`**

Append:

```ts
export function enableModel(db: Database.Database, name: string): void {
  db.prepare(`UPDATE models SET enabled = 1 WHERE name = ?`).run(name);
}
```

- [ ] **Step 4: Add two POST routes to `src/server.ts`**

```ts
import { enableModel, disableModel } from "./db/repos/models.js";

app.post("/admin/models/:name/enable", requireAdmin, (c) => {
  enableModel(c.get("db"), c.req.param("name"));
  return c.redirect("/admin/models");
});
app.post("/admin/models/:name/disable", requireAdmin, (c) => {
  disableModel(c.get("db"), c.req.param("name"));
  return c.redirect("/admin/models");
});
```

- [ ] **Step 5: Update `models.ts` — add per-row actions + Fetch button + flash message**

Replace the entire body of `renderModels` with:

```ts
import { page } from "../render.js";
import { listModels, listAccounts } from "../../db/repos/models.js";
// ... wait, listModels and listAccounts are in different repos. Fix:
import { listModels, disableModel as _dm, enableModel as _em } from "../../db/repos/models.js";
// Actually skip the wrapper imports — server already wires the routes.
```

Rewrite the function to accept `(db, flashMsg?: string)` and render the body as:

```ts
const flash = flashMsg ? `<div class="alert">${escapeHtml(flashMsg)}</div>` : "";
const body = `
  <p class="card-sub">All models known to the router. Disabled models are rejected at the proxy layer.</p>
  ${flash}
  <div class="card">
    <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
      <span>Models</span>
      <form method="POST" action="/admin/models/fetch" style="display:inline">
        <button class="btn" style="padding:6px 14px;font-size:10px">Fetch from upstream</button>
      </form>
    </div>
    <table>
      <tr><th>Name</th><th>Display</th><th>Family</th><th>Context</th><th>Thinking</th><th>Source</th><th>Status</th><th></th></tr>
      ${models.map((m) => `
        <tr>
          <td>${m.name}</td>
          <td>${m.display_name ?? ""}</td>
          <td>${m.family ?? ""}</td>
          <td>${m.context_window ?? ""}</td>
          <td>${m.thinking_enabled ? "yes" : "no"}</td>
          <td>${m.source}</td>
          <td><span class="badge ${m.enabled ? "badge-active" : "badge-muted"}">${m.enabled ? "active" : "disabled"}</span></td>
          <td style="white-space:nowrap">
            ${m.enabled
              ? `<form method="POST" action="/admin/models/${m.name}/disable" style="display:inline"><button class="btn-ghost" style="padding:3px 10px;font-size:10px">Disable</button></form>`
              : `<form method="POST" action="/admin/models/${m.name}/enable" style="display:inline"><button class="btn-ghost" style="padding:3px 10px;font-size:10px">Enable</button></form>`}
          </td>
        </tr>
      `).join("")}
    </table>
  </div>
`;
return page("Models", "models", body, { db });
```

Add `escapeHtml` helper at the bottom (same as other pages).

- [ ] **Step 6: Update server route to pass flash**

Modify `app.get("/admin/models", requireAdmin, (c) => { ... })` to:

```ts
app.get("/admin/models", requireAdmin, (c) => {
  const url = new URL(c.req.url);
  const fetched = url.searchParams.get("fetched");
  const flash = fetched !== null ? `${fetched} new model(s) imported from upstream.` : null;
  return c.html(renderModels(c.get("db"), flash));
});
```

- [ ] **Step 7: Run test + commit**

```bash
npx vitest run tests/integration/auth.test.ts
git add src/db/repos/models.ts src/dashboard/pages/models.ts src/server.ts tests/integration/auth.test.ts
git commit -m "feat(models): enable/disable from dashboard + Fetch from upstream button"
```

---

## Task 7: Fetch from upstream — handle 404 + clear error

**Files:**
- Modify: `src/providers/listModels.ts`
- Modify: `src/server.ts` (route handler)
- Test: extend `tests/integration/auth.test.ts`

- [ ] **Step 1: Write failing test**

```ts
describe("POST /admin/models/fetch", () => {
  it("returns 502 with clear error when upstream returns 404", async () => {
    const db = openDb();
    createAccount(db, { id: "acc_x", label: "L", credit_type: "payg", api_key: "k" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not found", { status: 404 }));
    const res = await app.request("/admin/models/fetch", { method: "POST" });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/404|not.*found|not.*supported|does not expose/i);
  });

  it("redirects to /admin/models?fetched=N with friendly notice on success", async () => {
    const db = openDb();
    createAccount(db, { id: "acc_y", label: "L", credit_type: "payg", api_key: "k" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "MiniMax-M99" }] }), { status: 200 }),
    );
    const res = await app.request("/admin/models/fetch", { method: "POST" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/\/admin\/models/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/auth.test.ts`
Expected: FAIL — current code throws on non-OK and bubbles 502 with the original error message. Test expects a friendlier message.

- [ ] **Step 3: Update `src/providers/listModels.ts` — clear error + structured result**

Replace the entire file with:

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

export interface FetchModelsResult {
  ok: boolean;
  added?: number;
  status?: number;
  error?: string;
}

export async function fetchModels(db: Database.Database, apiKey: string): Promise<FetchModelsResult> {
  const account = { provider: "minimax" as const, baseUrl: null };
  const candidatePaths = ["/v1/models"];
  const headers = buildHeaders({ provider: "minimax", apiKey }, false, "openai");

  for (const p of candidatePaths) {
    const url = `${getBaseUrl(account, "openai")}${p}`;
    const resp = await fetch(url, { method: "GET", headers });
    if (resp.ok) {
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
      return { ok: true, added };
    }
    if (resp.status === 404) continue;
    const text = await resp.text().catch(() => "");
    return { ok: false, status: resp.status, error: `upstream returned ${resp.status}: ${text.slice(0, 200)}` };
  }
  return { ok: false, status: 404, error: "MiniMax upstream does not expose a model list endpoint at the OpenAI base URL; use the seeded models instead" };
}
```

- [ ] **Step 4: Update `src/server.ts` route handler**

Replace the `app.post("/admin/models/fetch", ...)` block:

```ts
app.post("/admin/models/fetch", requireAdmin, async (c) => {
  const db = c.get("db");
  const firstActive = listEnabledAccounts(db)[0];
  if (!firstActive) return c.json({ error: "no active account — add a MiniMax upstream key first" }, 400);
  const result = await fetchModels(db, firstActive.api_key);
  if (!result.ok) {
    return c.json({ error: result.error ?? "fetch failed", status: result.status }, 502);
  }
  return c.redirect(`/admin/models?fetched=${result.added ?? 0}`);
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/integration/auth.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/providers/listModels.ts src/server.ts tests/integration/auth.test.ts
git commit -m "fix(models): graceful 404 + structured error for fetch-from-upstream"
```

---

## Task 8: Login hardening — rate limit + Secure cookie

**Files:**
- Create: `src/auth/rateLimit.ts`
- Modify: `src/auth.ts` (rate-limit on /login, Secure cookie when behind HTTPS)
- Modify: `tests/integration/auth.test.ts`

- [ ] **Step 1: Write failing test (append)**

```ts
import { _resetRateLimitForTests as resetRateLimit } from "../../src/auth/rateLimit.js";

describe("login rate limit", () => {
  beforeEach(() => resetRateLimit());

  it("returns 401 on first 5 wrong attempts, then 429 on 6th", async () => {
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(JSON.stringify(hashPassword("right")));
    for (let i = 0; i < 5; i++) {
      const r = await app.request("/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "password=wrong",
      });
      expect(r.status).toBe(401);
    }
    const sixth = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=wrong",
    });
    expect(sixth.status).toBe(429);
  });

  it("different IP — unaffected by another IP's lockout", async () => {
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(JSON.stringify(hashPassword("right")));
    for (let i = 0; i < 5; i++) {
      await app.request("/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "x-forwarded-for": "10.0.0.1" },
        body: "password=wrong",
      });
    }
    const fromOther = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "x-forwarded-for": "10.0.0.2" },
      body: "password=right",
    });
    expect(fromOther.status).toBe(302);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/auth.test.ts`
Expected: FAIL — no rate limit currently.

- [ ] **Step 3: Create `src/auth/rateLimit.ts`**

```ts
// In-memory token bucket: 5 failed login attempts per IP per 15 min.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const buckets = new Map<string, { count: number; resetAt: number }>();

export function recordLoginFailure(ip: string): { locked: boolean; resetAt: number } {
  const now = Date.now();
  const b = buckets.get(ip) ?? { count: 0, resetAt: now + WINDOW_MS };
  if (now > b.resetAt) {
    b.count = 0;
    b.resetAt = now + WINDOW_MS;
  }
  b.count++;
  buckets.set(ip, b);
  return { locked: b.count >= MAX_FAILS, resetAt: b.resetAt };
}

export function isLoginLocked(ip: string): { locked: boolean; retryAfterMs: number } {
  const b = buckets.get(ip);
  if (!b) return { locked: false, retryAfterMs: 0 };
  if (Date.now() > b.resetAt) return { locked: false, retryAfterMs: 0 };
  if (b.count >= MAX_FAILS) return { locked: true, retryAfterMs: b.resetAt - Date.now() };
  return { locked: false, retryAfterMs: 0 };
}

export function clearLoginFailures(ip: string): void {
  buckets.delete(ip);
}

export function _resetRateLimitForTests(): void {
  buckets.clear();
}
```

- [ ] **Step 4: Wire into `handleLogin` in `src/auth.ts`**

```ts
import { isLoginLocked, recordLoginFailure, clearLoginFailures } from "./auth/rateLimit.js";

export async function handleLogin(c: Context): Promise<Response> {
  const db = c.get("db");
  if (!isPasswordSet(db)) {
    return c.redirect("/admin");
  }
  const ip = clientIp(c) ?? "unknown";
  const lock = isLoginLocked(ip);
  if (lock.locked) {
    return c.html(renderLoginPage(`Too many attempts. Try again in ${Math.ceil(lock.retryAfterMs / 1000)}s.`, db), 429);
  }
  const body = await c.req.parseBody();
  const password = typeof body.password === "string" ? body.password : "";
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'admin_password'`).get() as { value: string } | undefined;
  if (!row || !verifyPassword(password, JSON.parse(row.value))) {
    recordLoginFailure(ip);
    return c.html(renderLoginPage("Wrong password.", db), 401);
  }
  clearLoginFailures(ip);
  const session = createSession(db, {
    userAgent: c.req.header("user-agent") ?? undefined,
    ip,
  });
  setCookie(c, SESSION_COOKIE, session.id, 7 * 24 * 60 * 60);
  return c.redirect("/admin");
}
```

- [ ] **Step 5: Update `setCookie` to add Secure when behind HTTPS**

In `src/auth.ts`, update the `setCookie` helper:

```ts
export function setCookie(c: Context, name: string, value: string, maxAgeSec: number) {
  const secure = process.env.ROUTER_COOKIE_SECURE === "1" || c.req.header("x-forwarded-proto") === "https" ? "; Secure" : "";
  c.header("set-cookie", `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`);
}
```

Apply the same logic to `clearCookie`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/integration/auth.test.ts`
Expected: PASS

- [ ] **Step 7: Run full test suite + commit**

```bash
npm test 2>&1 | tail -5
git add src/auth/rateLimit.ts src/auth.ts tests/integration/auth.test.ts
git commit -m "feat(auth): rate limit /login (5/15min/IP) + Secure cookie when behind HTTPS"
```

---

## Task 9: CSRF — Origin/Referer check on state-changing requests

**Files:**
- Modify: `src/auth.ts` (add `verifySameOrigin` helper)
- Modify: `src/server.ts` (wrap POST routes)
- Modify: `tests/integration/auth.test.ts`

- [ ] **Step 1: Write failing test (append)**

```ts
describe("CSRF protection", () => {
  it("rejects POST from cross-origin", async () => {
    const db = openDb();
    createAccount(db, { id: "acc_x", label: "L", credit_type: "payg", api_key: "k" });
    const res = await app.request("http://127.0.0.1:20145/admin/accounts/acc_x/enable", {
      method: "POST",
      headers: { Origin: "https://evil.example.com", Host: "127.0.0.1:20145" },
    });
    expect(res.status).toBe(403);
  });

  it("accepts POST from same-origin", async () => {
    const db = openDb();
    createAccount(db, { id: "acc_x", label: "L", credit_type: "payg", api_key: "k" });
    const res = await app.request("http://127.0.0.1:20145/admin/accounts/acc_x/enable", {
      method: "POST",
      headers: { Origin: "http://127.0.0.1:20145", Host: "127.0.0.1:20145" },
    });
    expect([302, 200]).toContain(res.status);
  });

  it("allows POST without Origin (curl / server-to-server)", async () => {
    const db = openDb();
    createAccount(db, { id: "acc_x", label: "L", credit_type: "payg", api_key: "k" });
    const res = await app.request("/admin/accounts/acc_x/enable", { method: "POST" });
    expect([302, 200]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/auth.test.ts`
Expected: FAIL — currently no CSRF check.

- [ ] **Step 3: Add `verifySameOrigin` to `src/auth.ts`**

```ts
export function verifySameOrigin(c: Context): boolean {
  const origin = c.req.header("origin");
  if (!origin) return true; // permissive: no Origin header (curl, server-to-server)
  const host = c.req.header("host");
  if (!host) return true; // no Host header — nothing to compare
  try {
    const o = new URL(origin);
    return o.host === host;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Wire into `src/server.ts` — middleware before admin routes**

Add after the global middleware (after `app.use("*", ...)` and before route declarations):

```ts
import { verifySameOrigin } from "./auth.js";

app.use("/admin/*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    if (!verifySameOrigin(c)) {
      return c.json({ error: "cross-origin request blocked" }, 403);
    }
  }
  await next();
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/integration/auth.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite + commit**

```bash
npm test 2>&1 | tail -5
git add src/auth.ts src/server.ts tests/integration/auth.test.ts
git commit -m "feat(security): CSRF guard on /admin/* POSTs (same-origin check via Origin header)"
```

---

## Task 10: Usage page — show account labels instead of IDs

**Files:**
- Modify: `src/dashboard/pages/usage.ts`
- Create: `src/dashboard/pages/usage.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/dashboard/pages/usage.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/dashboard/pages/usage.test.ts`
Expected: FAIL — current implementation renders `account_id` as raw `<td>${l.account_id ?? ""}</td>`.

- [ ] **Step 3: Update `src/dashboard/pages/usage.ts` — account lookup, render label**

Modify the import block to add:

```ts
import { listAccounts } from "../../db/repos/accounts.js";
```

Inside `renderUsage`, after computing `keys` add:

```ts
const accounts = listAccounts(db);
const acctById = new Map(accounts.map(a => [a.id, a]));
```

Replace the `l.account_id` cell in the log mapping with:

```ts
${logs.map((l) => `<tr><td>${l.created_at}</td><td>${l.client_key_id ?? ""}</td><td>${l.model}</td><td>${acctById.get(l.account_id ?? "")?.label ?? l.account_id ?? ""}</td><td>${l.total_tokens}</td><td>$${l.cost_usd.toFixed(4)}</td><td>${l.status_code}</td><td>${l.latency_ms}ms</td></tr>`).join("")}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/dashboard/pages/usage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/pages/usage.ts src/dashboard/pages/usage.test.ts
git commit -m "feat(usage): show account label in /admin/usage table instead of raw ID"
```

---

## Task 11: README v0.9 addendum

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add new features to the bullet list**

Find the Features section and add these bullets (in the right order):

```
- ✏️ **Inline CRUD on every page** — enable/disable/delete accounts, client keys, and models without the CLI. Reveal/hide bearer keys in the UI.
- 🔐 **Optional dashboard password** — set via `/admin/settings` to lock the dashboard behind a login. Open mode by default for local use.
- 🛡️ **Login rate-limit + CSRF** — 5 failed attempts per 15min per IP, cross-origin POSTs blocked
- 🌐 **Fetch from upstream** — `/admin/models` can pull MiniMax's current model list; 404 fallback shows a clear message
```

- [ ] **Step 2: Update Quick Start — drop CLI references for the typical path**

Replace the "Bootstrap: client keys + MiniMax accounts" section:

```md
### Bootstrap (no CLI required)

Open the dashboard at <http://localhost:20137/>. From there:

1. Add a MiniMax upstream account at `/admin/accounts` (label, credit type, API key)
2. Create a client key for each app at `/admin/client-keys` (label) — copy the bearer
3. Optional: lock the dashboard at `/admin/settings` ("Set password")

The CLI scripts (`npm run add-client-key`, `add-account`, `seed-models`, `reset`) are still available for power users / bulk seeding.
```

- [ ] **Step 3: Update test count + roadmap**

In the Features list, change `170+ tests` → `240+ tests`. Add to the roadmap:

```
| 9 | **v0.9** | ✅ shipped | Inline dashboard CRUD, login + rate-limit + CSRF, fetch-models 404 fallback, usage account labels |
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README — v0.9 addendum (dashboard CRUD, login, rate-limit, CSRF)"
```

---

## Task 12: Final verification

- [ ] **Step 1: Run all tests**

Run: `npm test 2>&1 | tail -5`
Expected: 240+ pass.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 3: Rebuild Docker image**

```bash
docker build -t kelola-router:local . 2>&1 | tail -3
```

- [ ] **Step 4: Smoke test in container**

```bash
docker rm -f kk 2>/dev/null
docker run --rm -d --name kk -p 20150:20137 -e ROUTER_DB_PATH=/data/router.db -v /tmp/kelola-v9smoke:/data kelola-router:local
sleep 2
curl -s http://127.0.0.1:20150/ | grep -E "kelola-router|Open dashboard" | head -2
curl -s http://127.0.0.1:20150/admin | grep -E "Overview|getting started" | head -2
docker stop kk
```

- [ ] **Step 5: Verify the commit log shows all 12 tasks**

```bash
git log --oneline -15
```

Expected: 12 new commits in conventional format, covering all gaps + fetch fix.

---

## Self-Review

**Spec coverage:**
- ✓ C (account CRUD) → Task 4
- ✓ D (client key CRUD) → Task 5
- ✓ G (README) → Task 11
- ✓ H/I (login/logout tests) → Task 2
- ✓ Q (dead code) → Task 1
- ✓ K (model CRUD) → Task 6
- ✓ M (secure cookie) → Task 8
- ✓ N (CSRF) → Task 9
- ✓ O (rate limit) → Task 8
- ✓ P (usage account labels) → Task 10
- ✓ Fetch-models 404 fix → Task 7

**Type consistency:** `enableAccount`/`disableAccount`/`deleteAccount` defined in Task 3, used in Task 4. `enableClientKey`/`deleteClientKey` defined and used in Task 5. `enableModel` defined and used in Task 6. `clearLoginFailures`/`recordLoginFailure`/`isLoginLocked` defined in Task 8, used in Task 8. `verifySameOrigin` defined in Task 9, used in Task 9. `_resetRateLimitForTests` exported from Task 8 and used in Task 8 tests.

**Placeholder scan:** No "TBD", "TODO", "fill in", "implement later", or "similar to Task N" without code. Every step has actual code.

**File paths:** All real paths in existing codebase.

**Commit count:** 12 chunked commits, each task = 1 commit (Task 12 is verify only).

---

Plan complete and saved to `docs/superpowers/plans/2026-06-01-v09-gaps-and-fetch.md`.

**12 tasks, ~13 commits. Each TDD-driven with real tests, not placeholders.**

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
