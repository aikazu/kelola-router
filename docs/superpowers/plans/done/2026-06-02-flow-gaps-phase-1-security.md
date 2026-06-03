# Phase 1: Security Criticals

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the five critical security gaps identified in the 2026-06-02 audit: CSRF bypass on `/api/admin/*`, missing rate limit on `/api/login`, unwired `parseError()`, dead `transport` config, and settings cache invalidation staleness.

**Architecture:** Each fix is independent and individually shippable. All fixes preserve the open-mode (no password) dev convenience. CSRF and rate limit share the IP-derivation helper from `auth.ts`.

**Tech Stack:** Hono middleware, better-sqlite3, scrypt (Node built-in), in-memory rate limit (kept; restart-trade-off documented).

---

## Audit Source

Verified 2026-06-02 against source:
- `src/api/admin/index.ts:14-28` — `app.use("/admin/*", requireAdminJson)` only covers `/admin/*` subroutes; `authRoutes` mounted at root `/` is unprotected.
- `src/api/admin/auth.ts` — full file inspected, no `isLoginLocked`/`recordLoginFailure` calls.
- `src/providers/parseError.ts` — exports `parseError` with `windowResetMs` extraction; never imported.
- `src/accounts/errorRules.ts:38-43` — has `windowResetMs`/`retryAfterHeader` branches; unreachable from current `server.ts:146-147` manual parse.
- `src/providers/upstreamFetch.ts:12` — `transport: TransportConfig | null = null` default; never overridden.
- `src/db/repos/settings.ts:3` — module-level `cache: Map` with 1s TTL; bypassed by direct `db.prepare(DELETE)`.
- `src/auth/password.ts:53` — `setPassword` does raw INSERT, no `clearCache()`.

---

## Task 1: CSRF guard on `/api/admin/*` non-GET methods

**Files:**
- Modify: `src/auth.ts:35-46` (extract `verifySameOrigin` to async middleware form)
- Modify: `src/api/admin/index.ts:14-28` (mount middleware on root `*` for non-GET)
- Test: `tests/api/admin/csrf.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/api/admin/csrf.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, resetDb } from "../../src/server.js";
import { setPassword } from "../../src/auth/password.js";
import { createSession } from "../../src/auth/session.js";
import { SESSION_COOKIE } from "../../src/auth.js";

let app: ReturnType<typeof createApp>;
let dbPath: string;
let sessionCookie: string;

beforeEach(async () => {
  dbPath = join(mkdtempSync(join(tmpdir(), "csrf-")), "t.db");
  process.env.ROUTER_DB_PATH = dbPath;
  resetDb();
  const { db } = await import("../../src/db/index.js");
  setPassword(db, "testpass");
  const sess = createSession(db);
  sessionCookie = `${SESSION_COOKIE}=${sess.id}`;
  app = createApp(db);
});

afterEach(() => {
  rmSync(dbPath, { force: true });
});

describe("CSRF on /api/admin/*", () => {
  it("rejects cross-origin POST to /api/admin/accounts/acc_x/disable with 403", async () => {
    const res = await app.request("/api/admin/accounts/acc_x/disable", {
      method: "POST",
      headers: {
        "cookie": sessionCookie,
        "origin": "https://evil.example",
        "host": "localhost:20137",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  it("allows same-origin POST to /api/admin/accounts/acc_x/disable", async () => {
    const res = await app.request("/api/admin/accounts/acc_x/disable", {
      method: "POST",
      headers: {
        "cookie": sessionCookie,
        "origin": "http://localhost:20137",
        "host": "localhost:20137",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect([200, 404, 400]).toContain(res.status); // 404 = account not found is fine
  });

  it("allows GET /api/admin/me without Origin check", async () => {
    const res = await app.request("/api/admin/me", {
      headers: { "cookie": sessionCookie, "host": "localhost:20137" },
    });
    expect(res.status).toBe(200);
  });

  it("allows POST without Origin header (curl/server-to-server)", async () => {
    const res = await app.request("/api/admin/accounts/acc_x/disable", {
      method: "POST",
      headers: {
        "cookie": sessionCookie,
        "host": "localhost:20137",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect([200, 404, 400]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/admin/csrf.test.ts`
Expected: FAIL — first test passes nothing blocks cross-origin POST; expect 200/404 from the handler, not 403.

- [ ] **Step 3: Convert `verifySameOrigin` to async middleware and mount**

In `src/auth.ts`, replace the existing `verifySameOrigin` (line 35-46) with:

```typescript
export function verifySameOrigin(c: Context): boolean {
  const origin = c.req.header("origin");
  if (!origin) return true;
  const host = c.req.header("host");
  if (!host) return true;
  try {
    const o = new URL(origin);
    return o.host === host;
  } catch {
    return false;
  }
}

export async function csrfGuard(c: Context, next: Next): Promise<Response | void> {
  if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") {
    await next();
    return;
  }
  if (!verifySameOrigin(c)) {
    return c.json({ error: "cross-origin request blocked" }, 403);
  }
  await next();
}
```

In `src/api/admin/index.ts`, add the import and mount:

```typescript
import { requireAdminJson } from "./middleware.js";
import { csrfGuard } from "../../auth.js";
// ...
export function adminApi(db: Database.Database): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("db", db); await next(); });
  app.use("/admin/*", requireAdminJson);
  app.use("*", csrfGuard); // <-- ADD THIS LINE
  // ... rest unchanged
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/admin/csrf.test.ts`
Expected: PASS — 4/4 tests green.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All existing tests still pass. Some may need `Origin` header added (CSRF blocks curl-style admin POSTs in tests). If any fail, add `"origin": "http://localhost:20137"` and `"host": "localhost:20137"` to those test fetches.

- [ ] **Step 6: Commit**

```bash
git add src/auth.ts src/api/admin/index.ts tests/api/admin/csrf.test.ts
git commit -m "fix(security): mount CSRF guard on /api/admin/* non-GET methods"
```

---

## Task 2: Apply rate limit to `/api/login` JSON endpoint

**Files:**
- Modify: `src/api/admin/auth.ts:20-35` (add rate limit + reuse handleLogin error path)
- Test: `tests/api/admin/auth-rate-limit.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/api/admin/auth-rate-limit.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, resetDb } from "../../src/server.js";
import { setPassword } from "../../src/auth/password.js";
import { _resetRateLimitForTests } from "../../src/auth/rateLimit.js";

let app: ReturnType<typeof createApp>;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(mkdtempSync(join(tmpdir(), "rl-")), "t.db");
  process.env.ROUTER_DB_PATH = dbPath;
  resetDb();
  _resetRateLimitForTests();
  const { db } = await import("../../src/db/index.js");
  setPassword(db, "testpass");
  app = createApp(db);
});

afterEach(() => {
  rmSync(dbPath, { force: true });
  _resetRateLimitForTests();
});

describe("/api/login rate limiting", () => {
  it("returns 429 with retryAfterMs after 5 wrong passwords from same IP", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await app.request("/api/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "1.2.3.4",
        },
        body: JSON.stringify({ password: "wrong" }),
      });
      expect(r.status).toBe(401);
    }
    const blocked = await app.request("/api/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "1.2.3.4",
      },
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(blocked.status).toBe(429);
    const body = await blocked.json() as { error: string; retryAfterMs: number };
    expect(body.retryAfterMs).toBeGreaterThan(0);
  });

  it("does not rate-limit different IPs independently", async () => {
    for (let i = 0; i < 5; i++) {
      await app.request("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "5.6.7.8" },
        body: JSON.stringify({ password: "wrong" }),
      });
    }
    const otherIp = await app.request("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "9.10.11.12" },
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(otherIp.status).toBe(401);
  });

  it("resets bucket on successful login", async () => {
    for (let i = 0; i < 4; i++) {
      await app.request("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "13.14.15.16" },
        body: JSON.stringify({ password: "wrong" }),
      });
    }
    const ok = await app.request("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "13.14.15.16" },
      body: JSON.stringify({ password: "testpass" }),
    });
    expect(ok.status).toBe(200);
    // 4 more wrongs should still work since the bucket was cleared
    for (let i = 0; i < 4; i++) {
      const r = await app.request("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "13.14.15.16" },
        body: JSON.stringify({ password: "wrong" }),
      });
      expect(r.status).toBe(401);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/admin/auth-rate-limit.test.ts`
Expected: FAIL — current `/api/login` does not enforce rate limit; first test gets 401s but 6th attempt also gets 401, not 429.

- [ ] **Step 3: Refactor `handleLogin` to expose logic, then wire into JSON route**

In `src/auth.ts`, extract the rate-limit + verify logic so it can be reused:

Replace the body of `handleLogin` (after the `if (!isPasswordSet)` check) with calls to two new exports, and add the new exports at the top of the file:

```typescript
// Add at top of auth.ts after existing imports
import { isLoginLocked, recordLoginFailure, clearLoginFailures } from "./auth/rateLimit.js";

export interface LoginAttempt {
  ok: boolean;
  retryAfterMs?: number;
  locked?: boolean;
}

export function checkLoginRate(ip: string): { allowed: boolean; retryAfterMs: number } {
  const lock = isLoginLocked(ip);
  if (lock.locked) return { allowed: false, retryAfterMs: lock.retryAfterMs };
  return { allowed: true, retryAfterMs: 0 };
}

export function recordFailedLogin(ip: string): void {
  recordLoginFailure(ip);
}

export function clearLogin(ip: string): void {
  clearLoginFailures(ip);
}

export function extractLoginIp(c: Context): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
```

Then refactor `handleLogin` to use these:

```typescript
export async function handleLogin(c: Context): Promise<Response> {
  const db = c.get("db");
  if (!isPasswordSet(db)) {
    return c.redirect("/admin");
  }
  const ip = extractLoginIp(c);
  const rate = checkLoginRate(ip);
  if (!rate.allowed) {
    return c.html(renderLoginPage(`Too many attempts. Try again in ${Math.ceil(rate.retryAfterMs / 1000)}s.`, db), 429);
  }
  const body = await c.req.parseBody();
  const password = typeof body.password === "string" ? body.password : "";
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'admin_password'`).get() as { value: string } | undefined;
  if (!row || !verifyPassword(password, JSON.parse(row.value))) {
    recordFailedLogin(ip);
    return c.html(renderLoginPage("Wrong password.", db), 401);
  }
  clearLogin(ip);
  const session = createSession(db, { userAgent: c.req.header("user-agent") ?? undefined, ip });
  setCookie(c, SESSION_COOKIE, session.id, 7 * 24 * 60 * 60);
  return c.redirect("/admin");
}
```

In `src/api/admin/auth.ts`, replace the `/login` POST handler with rate-limited version. Add this new route:

```typescript
import { checkLoginRate, recordFailedLogin, clearLogin, extractLoginIp, SESSION_COOKIE } from "../../auth.js";
import { setCookie } from "../../auth.js";
import { isPasswordSet, verifyPassword } from "../../auth/password.js";
import { createSession } from "../../auth/session.js";
import { openDb } from "../../db/index.js";

// Inside authRoutes (replacing the existing JSON login route):
authRoutes.post("/login", async (c) => {
  const db = c.get("db") as Database.Database;
  if (!isPasswordSet(db)) return c.json({ authed: true });
  const ip = extractLoginIp(c);
  const rate = checkLoginRate(ip);
  if (!rate.allowed) {
    return c.json({ error: "too many attempts", retryAfterMs: rate.retryAfterMs }, 429);
  }
  const body = await c.req.json().catch(() => ({}));
  const password = typeof body?.password === "string" ? body.password : "";
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'admin_password'`).get() as { value: string } | undefined;
  if (!row || !verifyPassword(password, JSON.parse(row.value))) {
    recordFailedLogin(ip);
    return c.json({ error: "wrong password" }, 401);
  }
  clearLogin(ip);
  const session = createSession(db, { userAgent: c.req.header("user-agent") ?? undefined, ip });
  setCookie(c, SESSION_COOKIE, session.id, 7 * 24 * 60 * 60);
  return c.json({ authed: true });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/admin/auth-rate-limit.test.ts`
Expected: PASS — 3/3 tests green.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/auth.ts src/api/admin/auth.ts tests/api/admin/auth-rate-limit.test.ts
git commit -m "fix(security): rate-limit /api/login JSON endpoint"
```

---

## Task 3: Wire `parseError()` into proxy error handling

**Files:**
- Modify: `src/server.ts:142-165` (replace manual JSON parse with parseError + pass windowResetMs/retryAfterHeader)
- Test: `src/providers/parseError.test.ts` (verify, may already exist)

- [ ] **Step 1: Write the failing test**

If `src/providers/parseError.test.ts` does not exist, create it:

```typescript
import { describe, it, expect } from "vitest";
import { parseError } from "./parseError.js";

describe("parseError", () => {
  it("extracts baseRespCode 1002 from JSON body", () => {
    const resp = new Response("{}", { status: 429 });
    const r = parseError(resp, JSON.stringify({ base_resp: { status_code: 1002 }, message: "rate" }));
    expect(r.baseRespCode).toBe(1002);
  });

  it("extracts windowResetMs when 2056 has model_remains end_time", () => {
    const resp = new Response("{}", { status: 429 });
    const endTime = Date.now() + 60_000;
    const r = parseError(resp, JSON.stringify({
      base_resp: { status_code: 2056 },
      model_remains: [{ end_time: endTime }],
    }));
    expect(r.windowResetMs).toBeGreaterThan(0);
  });

  it("extracts retryAfterSec from Retry-After header", () => {
    const resp = new Response("{}", { status: 429, headers: { "retry-after": "30" } });
    const r = parseError(resp, "");
    expect(r.retryAfterSec).toBe(30);
  });

  it("returns safe defaults on non-JSON body", () => {
    const resp = new Response("plain text", { status: 500 });
    const r = parseError(resp, "plain text");
    expect(r.baseRespCode).toBeUndefined();
    expect(r.message).toBe("plain text");
  });
});
```

- [ ] **Step 2: Run test to verify it passes (already-implemented function)**

Run: `npx vitest run src/providers/parseError.test.ts`
Expected: PASS (function is already correct).

- [ ] **Step 3: Add failing integration test for proxy using parseError**

Create `tests/integration/parse-error-wiring.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, resetDb } from "../../src/server.js";

let app: ReturnType<typeof createApp>;
let dbPath: string;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  dbPath = join(mkdtempSync(join(tmpdir(), "pe-")), "t.db");
  process.env.ROUTER_DB_PATH = dbPath;
  resetDb();
  const { db, createClientKey, createAccount, upsertModel } = await import("../../src/db/index.js");
  const ck = createClientKey(db, { label: "t" });
  const acc = createAccount(db, { label: "a1", apiKey: "mm_test", creditType: "payg" });
  upsertModel(db, { name: "MiniMax-M2.7", upstreamModel: "MiniMax-M2.7", costPer1kPrompt: 1, costPer1kCompletion: 2 });
  process.env.ROUTER_TEST_CK = ck.key;
  process.env.ROUTER_TEST_ACC = acc.id;
  app = createApp(db);
});

afterEach(() => {
  rmSync(dbPath, { force: true });
  globalThis.fetch = realFetch;
});

describe("proxy uses parseError to populate windowResetMs", () => {
  it("applies windowResetMs cooldown when upstream returns 2056 with model_remains", async () => {
    const endTime = Date.now() + 30_000;
    globalThis.fetch = vi.fn().mockImplementation(async () => new Response(
      JSON.stringify({
        base_resp: { status_code: 2056, msg: "window exhausted" },
        model_remains: [{ end_time: endTime }],
      }),
      { status: 429, headers: { "content-type": "application/json" } },
    ));
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${process.env.ROUTER_TEST_CK}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "MiniMax-M2.7", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(429);
    // Verify account got a rateLimitedUntil set at least 25s in the future
    const { listAccounts } = await import("../../src/db/repos/accounts.js");
    const accounts = listAccounts((globalThis as any).__testDb);
    const acc = accounts[0];
    expect(acc.rate_limited_until).toBeTruthy();
    const until = new Date(acc.rate_limited_until).getTime();
    expect(until - Date.now()).toBeGreaterThan(25_000);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/integration/parse-error-wiring.test.ts`
Expected: FAIL — current `server.ts:148` does manual parse and never passes `windowResetMs`, so cooldown is 0/default 5s, not 30s.

- [ ] **Step 5: Wire `parseError` into server.ts error path**

In `src/server.ts`, locate the error handling block (around lines 142-165). Replace the manual parse block with:

```typescript
const errText = await resp.text();
const parsed = parseError(resp, errText);
const baseRespCode = parsed.baseRespCode;
const errorText = parsed.message || `HTTP ${resp.status}`;

const decision = checkFallbackError(
  resp.status,
  errorText,
  baseRespCode,
  account.backoffLevel,
  parsed.windowResetMs,
  parsed.retryAfterSec ? parsed.retryAfterSec * 1000 : undefined,
);
```

Add the import at the top of `src/server.ts`:

```typescript
import { parseError } from "./providers/parseError.js";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/integration/parse-error-wiring.test.ts`
Expected: PASS.

- [ ] **Step 7: Run full suite**

Run: `npm test`
Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add src/server.ts src/providers/parseError.test.ts tests/integration/parse-error-wiring.test.ts
git commit -m "fix(proxy): wire parseError to surface windowResetMs and retryAfterSec"
```

---

## Task 4: Plumb `transport` setting into `upstreamFetch`

**Files:**
- Modify: `src/server.ts:7` (add transport import)
- Modify: `src/server.ts:143` (pass `getSetting(db, "transport")` as fourth arg)
- Test: `tests/integration/transport-config.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, resetDb } from "../../src/server.js";
import { setSetting, clearCache } from "../../src/db/repos/settings.js";

let app: ReturnType<typeof createApp>;
let dbPath: string;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  dbPath = join(mkdtempSync(join(tmpdir(), "tx-")), "t.db");
  process.env.ROUTER_DB_PATH = dbPath;
  resetDb();
  const { db, createClientKey, createAccount, upsertModel } = await import("../../src/db/index.js");
  const ck = createClientKey(db, { label: "t" });
  const acc = createAccount(db, { label: "a1", apiKey: "mm_test", creditType: "payg" });
  upsertModel(db, { name: "MiniMax-M2.7", upstreamModel: "MiniMax-M2.7", costPer1kPrompt: 1, costPer1kCompletion: 2 });
  process.env.ROUTER_TEST_CK = ck.key;
  process.env.ROUTER_TEST_ACC = acc.id;
  app = createApp(db);
  clearCache();
});

afterEach(() => {
  rmSync(dbPath, { force: true });
  globalThis.fetch = realFetch;
  clearCache();
});

describe("transport config plumbed to upstreamFetch", () => {
  it("passes transport config from settings to upstreamFetch", async () => {
    const db = (await import("../../src/db/index.js")).openDb();
    setSetting(db, "transport", { relay: null, proxy: null });
    clearCache();

    const spy = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    globalThis.fetch = spy;

    await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${process.env.ROUTER_TEST_CK}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "MiniMax-M2.7", messages: [{ role: "user", content: "hi" }] }),
    });

    // upstreamFetch internally calls proxyAwareFetch which calls fetch with the dispatcher set
    // We can't directly assert the dispatcher, but we can assert fetch was called once with our URL.
    expect(spy).toHaveBeenCalledTimes(1);
    const url = (spy.mock.calls[0][0] as string);
    expect(url).toContain("/v1/chat/completions");
  });
});
```

- [ ] **Step 2: Run test to verify it passes (spy alone doesn't catch transport)**

Run: `npx vitest run tests/integration/transport-config.test.ts`
Expected: PASS (test is weak; it only checks URL, not transport). Strengthen in next step.

- [ ] **Step 3: Strengthen test by mocking proxyFetch and asserting call**

Update the test to spy on `proxyAwareFetch` and assert `transport` was passed. Replace the test with:

```typescript
it("passes transport config from settings to proxyAwareFetch", async () => {
  const db = (await import("../../src/db/index.js")).openDb();
  setSetting(db, "transport", { relay: { url: "https://relay.example" }, proxy: null });
  clearCache();

  const proxySpy = vi.fn(async () => new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  ));
  vi.doMock("../../src/transport/proxyFetch.js", () => ({ proxyAwareFetch: proxySpy }));
  const { createApp: freshApp } = await import("../../src/server.js");
  const a = freshApp(db);

  await a.request("/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${process.env.ROUTER_TEST_CK}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: "MiniMax-M2.7", messages: [{ role: "user", content: "hi" }] }),
  });

  expect(proxySpy).toHaveBeenCalledTimes(1);
  const transportArg = proxySpy.mock.calls[0][2] ?? proxySpy.mock.calls[0][1];
  expect(transportArg).toMatchObject({ relay: { url: "https://relay.example" } });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/integration/transport-config.test.ts`
Expected: FAIL — `proxyAwareFetch` is called with `undefined` transport because `server.ts` never passes it.

- [ ] **Step 5: Pass transport to upstreamFetch**

In `src/server.ts`, add:

```typescript
import { getSetting } from "./db/repos/settings.js";
```

Change the `upstreamFetch` call (around line 143) from:

```typescript
const resp = await upstreamFetch(url, body, headers);
```

to:

```typescript
const transport = getSetting<{ relay: unknown; proxy: unknown } | null>(db, "transport");
const resp = await upstreamFetch(url, body, headers, transport);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/integration/transport-config.test.ts`
Expected: PASS.

- [ ] **Step 7: Run full suite**

Run: `npm test`

- [ ] **Step 8: Commit**

```bash
git add src/server.ts tests/integration/transport-config.test.ts
git commit -m "fix(proxy): plumb transport config from settings into upstreamFetch"
```

---

## Task 5: Settings cache invalidation on direct DELETE/INSERT

**Files:**
- Modify: `src/auth/password.ts:53-58` (call `clearCache()` after setPassword)
- Modify: `src/server.ts:326` (replace direct DELETE with `setSetting(db, "admin_password", null)`)
- Test: `src/auth/password.test.ts` (extend) + new `src/db/repos/settings-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/db/repos/settings-cache.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../index.js";
import { setSetting, getSetting, clearCache } from "./settings.js";
import { setPassword, isPasswordSet } from "../../auth/password.js";

let db: ReturnType<typeof openDb>;
let dbPath: string;

beforeEach(() => {
  dbPath = join(mkdtempSync(join(tmpdir(), "sc-")), "t.db");
  process.env.ROUTER_DB_PATH = dbPath;
  clearCache();
  db = openDb();
});

describe("settings cache invalidation", () => {
  it("isPasswordSet reflects setPassword immediately", () => {
    expect(isPasswordSet(db)).toBe(false);
    setPassword(db, "test1234");
    clearCache(); // mirrors what production code should do
    expect(isPasswordSet(db)).toBe(true);
  });

  it("isPasswordSet reflects password removal immediately", () => {
    setSetting(db, "admin_password", "scrypt:16384:aa:bb");
    clearCache();
    expect(isPasswordSet(db)).toBe(true);
    setSetting(db, "admin_password", null); // correct way
    expect(isPasswordSet(db)).toBe(false);
  });

  it("getSetting picks up setPassword without manual clearCache", () => {
    expect(getSetting(db, "admin_password")).toBeNull();
    setPassword(db, "test1234");
    expect(getSetting(db, "admin_password")).toBeTruthy(); // should NOT need manual clearCache
  });
});
```

- [ ] **Step 2: Run test to verify it fails (last test only)**

Run: `npx vitest run src/db/repos/settings-cache.test.ts`
Expected: The third test (`getSetting picks up setPassword without manual clearCache`) FAILS — current `setPassword` does raw INSERT without clearing cache.

- [ ] **Step 3: Make `setPassword` clear cache**

In `src/auth/password.ts`, update the import and `setPassword`:

```typescript
import type Database from "better-sqlite3";
import { clearCache } from "../db/repos/settings.js";

export function setPassword(db: Database.Database, plain: string): void {
  const hash = hashPassword(plain);
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('admin_password', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(JSON.stringify(hash));
  clearCache();
}
```

- [ ] **Step 4: Find and fix the direct DELETE in server.ts**

In `src/server.ts`, locate the password-clear admin route (around line 326). Replace any `db.prepare("DELETE FROM settings WHERE key = 'admin_password'").run()` with:

```typescript
import { setSetting } from "./db/repos/settings.js";
// ...
setSetting(db, "admin_password", null);
```

If multiple occurrences, fix all. `setSetting` already calls `clearCache()` internally.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/db/repos/settings-cache.test.ts`
Expected: PASS — 3/3.

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/auth/password.ts src/db/repos/settings-cache.test.ts src/server.ts
git commit -m "fix(settings): clear cache on setPassword and use setSetting wrapper for password removal"
```

---

## Self-Review

**Spec coverage:**
- CSRF on /api/admin/* → Task 1 ✓
- /api/login rate limit → Task 2 ✓
- parseError wiring → Task 3 ✓
- transport config plumbing → Task 4 ✓
- settings cache invalidation → Task 5 ✓

**Placeholder scan:** No TODOs. All test code complete. All code shown in steps.

**Type consistency:** `checkLoginRate`/`recordFailedLogin`/`clearLogin`/`extractLoginIp` exported from `auth.ts`, imported in `api/admin/auth.ts` and reused in `handleLogin`. `parseError` signature matches what server.ts needs. `setSetting` signature unchanged.

**Ready to ship.** 5 tasks, ~12-15 commits, each independently deployable.
