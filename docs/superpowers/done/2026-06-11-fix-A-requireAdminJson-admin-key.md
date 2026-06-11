# Fix A: requireAdminJson — tambah x-admin-key support

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `requireAdminJson` harus accept `x-admin-key` header dan `ROUTER_ADMIN_KEY` env supaya script/CLI bisa manage combo CRUD ketika password di-set.

**Architecture:** Tambah x-admin-key check di `requireAdminJson` — mirror logika yang sudah ada di `requireAdmin` (src/auth.ts:120-132). Tidak perlu refactor; cukup tambah 6 baris sebelum cookie check fallback.

**Tech Stack:** TypeScript, Hono, better-sqlite3, Vitest

---

### Task 1: Tambah failing test untuk x-admin-key di requireAdminJson

**Files:**
- Modify: `tests/api/admin/middleware.test.ts`

- [ ] **Step 1: Tambah test x-admin-key diterima ketika password set**

Tambah ke dalam `describe('requireAdminJson', ...)` di `tests/api/admin/middleware.test.ts`:

```typescript
it('passes through when x-admin-key matches ROUTER_ADMIN_KEY and password is set', async () => {
  const { hashPassword } = await import('../../../src/auth/password.js');
  db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
    JSON.stringify(hashPassword('secret123'))
  );
  process.env.ROUTER_ADMIN_KEY = 'test-admin-key-123';
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.use('/api/admin/*', requireAdminJson);
  app.get('/api/admin/test', (c) => c.json({ ok: true }));
  const res = await app.request('/api/admin/test', {
    headers: { 'x-admin-key': 'test-admin-key-123' },
  });
  expect(res.status).toBe(200);
  delete process.env.ROUTER_ADMIN_KEY;
});

it('returns 401 when x-admin-key does not match ROUTER_ADMIN_KEY and password is set', async () => {
  const { hashPassword } = await import('../../../src/auth/password.js');
  db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
    JSON.stringify(hashPassword('secret123'))
  );
  process.env.ROUTER_ADMIN_KEY = 'correct-key';
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.use('/api/admin/*', requireAdminJson);
  app.get('/api/admin/test', (c) => c.json({ ok: true }));
  const res = await app.request('/api/admin/test', {
    headers: { 'x-admin-key': 'wrong-key' },
  });
  expect(res.status).toBe(401);
  delete process.env.ROUTER_ADMIN_KEY;
});

it('returns 401 when ROUTER_ADMIN_KEY not set and only x-admin-key provided and password is set', async () => {
  const { hashPassword } = await import('../../../src/auth/password.js');
  db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
    JSON.stringify(hashPassword('secret123'))
  );
  delete process.env.ROUTER_ADMIN_KEY;
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.use('/api/admin/*', requireAdminJson);
  app.get('/api/admin/test', (c) => c.json({ ok: true }));
  const res = await app.request('/api/admin/test', {
    headers: { 'x-admin-key': 'any-key' },
  });
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: Jalankan test, pastikan FAIL**

```bash
npx vitest run tests/api/admin/middleware.test.ts
```

Expected: 3 test baru FAIL — `passes through when x-admin-key...`, dll.

---

### Task 2: Implementasi x-admin-key check di requireAdminJson

**Files:**
- Modify: `src/api/admin/middleware.ts`

- [ ] **Step 1: Update requireAdminJson**

Ganti seluruh fungsi `requireAdminJson` (baris 8-23) dengan:

```typescript
export async function requireAdminJson(c: Context, next: Next): Promise<Response | undefined> {
  const db = c.get('db') as Database.Database;
  const passwordSet = isPasswordSet(db);

  if (!passwordSet) {
    await next();
    return;
  }

  // x-admin-key / ROUTER_ADMIN_KEY (untuk scripts)
  const envKey = process.env.ROUTER_ADMIN_KEY;
  const headerKey = c.req.header('x-admin-key');
  if (envKey && headerKey && headerKey === envKey) {
    await next();
    return;
  }

  // Session cookie (untuk dashboard)
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (!sessionId) {
    return c.json({ error: 'unauthorized', message: 'login required' }, 401);
  }
  const session = validateSession(db, sessionId);
  if (!session) {
    return c.json({ error: 'unauthorized', message: 'session expired' }, 401);
  }
  await next();
}
```

Import `isPasswordSet` sudah ada di baris 4. Tidak ada import baru.

- [ ] **Step 2: Jalankan test, pastikan PASS**

```bash
npx vitest run tests/api/admin/middleware.test.ts
```

Expected: semua test PASS termasuk 3 yang baru.

- [ ] **Step 3: Jalankan full test suite, pastikan tidak ada regresi**

```bash
npm test
```

Expected: semua PASS.

- [ ] **Step 4: Commit**

```bash
git add src/api/admin/middleware.ts tests/api/admin/middleware.test.ts
git commit -m "fix(auth): requireAdminJson accept x-admin-key for script access"
```
