# Fix B: Combo fallback — retry 5xx + account re-select per model

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Combo fallback chain harus (1) retry upstream 5xx errors (502, 503, 504) ke model berikutnya, dan (2) re-select account per iterasi sehingga account diversity dimanfaatkan saat ada rate-limit.

**Architecture:**
- `handleComboProxy` di `src/server.ts` saat ini memilih satu account sebelum loop, dan hanya `continue` pada 429. Dua perubahan independen: (a) perluas kondisi `continue` ke 5xx retryable, (b) pindahkan `selectAccount` ke dalam loop agar tiap model bisa dapat account baru.
- Account re-select di dalam loop menggunakan state DB terbaru (setelah `updateAccount` dari iterasi sebelumnya) sehingga account yang baru dibackoff otomatis ter-skip.

**Tech Stack:** TypeScript, Hono, Vitest, better-sqlite3

---

### Task 1: Test — combo harus retry 5xx ke model berikutnya

**Files:**
- Create: `tests/integration/combo-fallback.test.ts`

- [ ] **Step 1: Tulis failing test**

```typescript
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { createAccount } from '../../src/db/repos/accounts.js';
import { createClientKey } from '../../src/db/repos/client_keys.js';
import { createCombo } from '../../src/db/repos/combos.js';
import { upsertModel } from '../../src/db/repos/models.js';
import { clearCache } from '../../src/db/repos/settings.js';
import { app, resetDb } from '../../src/server.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('combo fallback — retry on 5xx', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'combo-fb-')), 't.db');
    resetDb();
    clearCache();
    const db = openDb();
    createClientKey(db, { label: 'test', key: 'rk_combo_test' });
    createAccount(db, { id: 'acc1', label: 'main', credit_type: 'payg', api_key: 'mm_1' });
    upsertModel(db, {
      name: 'model-a',
      upstream_model: 'model-a',
      provider: 'minimax',
      enabled: 1,
      family: 'test',
    });
    upsertModel(db, {
      name: 'model-b',
      upstream_model: 'model-b',
      provider: 'minimax',
      enabled: 1,
      family: 'test',
    });
    createCombo(db, 'test-combo', ['model-a', 'model-b']);
  });

  it('tries model-b when model-a returns 503', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) => {
        const u = String(url);
        if (u.includes('model-a') || /* first call */ fetchMock.mock.calls.length === 1) {
          return new Response(JSON.stringify({ error: 'overloaded' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({
            id: 'chatcmpl-x',
            object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      });

    const res = await app.request(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer rk_combo_test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'test-combo', messages: [{ role: 'user', content: 'hi' }] }),
      })
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns last error when all models return 503', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'overloaded' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      })
    );

    const res = await app.request(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer rk_combo_test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'test-combo', messages: [{ role: 'user', content: 'hi' }] }),
      })
    );

    // Should return last error (503 or 429 exhausted)
    expect([429, 503]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan FAIL**

```bash
npx vitest run tests/integration/combo-fallback.test.ts
```

Expected: `tries model-b when model-a returns 503` FAIL — test expects 200 but gets 503 (combo tidak retry 5xx).

---

### Task 2: Fix — perluas retry condition ke 5xx retryable di handleComboProxy

**Files:**
- Modify: `src/server.ts:329-347`

- [ ] **Step 1: Update retry condition**

Cari blok ini di `src/server.ts` (sekitar baris 329):

```typescript
        // Only retry on 429 (rate limit). Other errors are non-retryable.
        if (resp.status === 429) {
          log.info(
            { combo: combo.name, model: modelName, status: resp.status },
            'combo: rate limited, trying next model'
          );
          lastErrorResponse = c.body(errBody, statusCode(resp.status), {
            'content-type': resp.headers.get('content-type') ?? 'application/json',
          });
          continue;
        }

        // Non-retryable error — return immediately
        consoleBus.emit(
          buildError(reqId, new Date().toISOString(), resp.status, errBody.slice(0, 200))
        );
        return c.body(errBody, statusCode(resp.status), {
          'content-type': resp.headers.get('content-type') ?? 'application/json',
        });
```

Ganti dengan:

```typescript
        // Retry on 429 (rate limit) and retryable 5xx (502, 503, 504).
        const isRetryable = resp.status === 429 || resp.status === 502 || resp.status === 503 || resp.status === 504;
        if (isRetryable) {
          log.info(
            { combo: combo.name, model: modelName, status: resp.status },
            'combo: retryable error, trying next model'
          );
          lastErrorResponse = c.body(errBody, statusCode(resp.status), {
            'content-type': resp.headers.get('content-type') ?? 'application/json',
          });
          continue;
        }

        // Non-retryable error — return immediately
        consoleBus.emit(
          buildError(reqId, new Date().toISOString(), resp.status, errBody.slice(0, 200))
        );
        return c.body(errBody, statusCode(resp.status), {
          'content-type': resp.headers.get('content-type') ?? 'application/json',
        });
```

- [ ] **Step 2: Jalankan test, pastikan PASS**

```bash
npx vitest run tests/integration/combo-fallback.test.ts
```

Expected: semua test PASS.

- [ ] **Step 3: Commit**

```bash
git add src/server.ts tests/integration/combo-fallback.test.ts
git commit -m "fix(combo): retry 502/503/504 upstream errors in fallback chain"
```

---

### Task 3: Test — combo re-select account per model ketika account ter-backoff

**Files:**
- Modify: `tests/integration/combo-fallback.test.ts`

- [ ] **Step 1: Tambah test account re-select**

Tambah describe block baru di `tests/integration/combo-fallback.test.ts`:

```typescript
describe('combo fallback — account re-select per model', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'combo-acc-')), 't.db');
    resetDb();
    clearCache();
    const db = openDb();
    createClientKey(db, { label: 'test2', key: 'rk_combo_acc' });
    // Two accounts
    createAccount(db, { id: 'acc_a', label: 'acc-a', credit_type: 'payg', api_key: 'mm_a' });
    createAccount(db, { id: 'acc_b', label: 'acc-b', credit_type: 'payg', api_key: 'mm_b' });
    upsertModel(db, {
      name: 'model-x',
      upstream_model: 'model-x',
      provider: 'minimax',
      enabled: 1,
      family: 'test',
    });
    createCombo(db, 'acc-combo', ['model-x']);
  });

  it('re-selects account when first account gets 429 and second account is available', async () => {
    const calledApiKeys: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, init) => {
      const authHeader = (init as RequestInit)?.headers
        ? (init as RequestInit).headers instanceof Headers
          ? (init as RequestInit).headers.get('authorization') ?? ''
          : ((init as RequestInit).headers as Record<string, string>)['authorization'] ?? ''
        : '';
      calledApiKeys.push(authHeader);

      // First call with acc_a key → 429
      if (authHeader.includes('mm_a') && calledApiKeys.filter((k) => k.includes('mm_a')).length === 1) {
        return new Response(JSON.stringify({ error: 'rate limited' }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        });
      }
      // acc_b key → success
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-y',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    const res = await app.request(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer rk_combo_acc',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'acc-combo', messages: [{ role: 'user', content: 'hi' }] }),
      })
    );

    // With account re-select, combo should succeed on second account
    expect(res.status).toBe(200);
    // Both accounts were tried
    expect(calledApiKeys.some((k) => k.includes('mm_a'))).toBe(true);
    expect(calledApiKeys.some((k) => k.includes('mm_b'))).toBe(true);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan FAIL**

```bash
npx vitest run tests/integration/combo-fallback.test.ts -t "re-selects account"
```

Expected: FAIL — saat ini combo pakai satu account, acc_b tidak pernah dicoba.

---

### Task 4: Fix — pindahkan selectAccount ke dalam loop

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Hapus account selection sebelum loop, tambah per-iterasi**

Cari blok ini di `src/server.ts` (sekitar baris 206-229):

```typescript
  // Account pool
  const allAccounts = listEnabledAccounts(db);
  if (allAccounts.length === 0) {
    return c.json({ error: 'no upstream accounts configured' }, 503);
  }
  const accountStates: AccountState[] = allAccounts.map((a) => ({
    id: a.id,
    backoffLevel: a.backoff_level,
    rateLimitedUntil: a.rate_limited_until,
    lastError: a.last_error ? (safeJsonParse(a.last_error) as AccountState['lastError']) : null,
    status: a.status as AccountState['status'],
    enabled: !!a.enabled,
  }));
  const selMode = (getSetting<{ mode: SelectionMode }>(db, 'selection'))?.mode ?? 'lowest-backoff';
  const { account, reason, nextCursor } = selectAccount(accountStates, {
    mode: selMode,
    cursor: rrCursor,
    clientKeyId: clientKey?.id,
    stickyMap,
  });
  if (nextCursor != null) rrCursor = nextCursor;
  if (!account) return c.json({ error: 'all accounts unavailable' }, 503);
  const acc = allAccounts.find((a) => a.id === account.id)!;
  consoleBus.emit(buildAccount(reqId, new Date().toISOString(), acc.label, reason));

  let lastErrorResponse: Response | null = null;

  for (let i = 0; i < combo.models.length; i++) {
```

Ganti dengan:

```typescript
  // Pre-check: ada akun tersedia
  if (listEnabledAccounts(db).length === 0) {
    return c.json({ error: 'no upstream accounts configured' }, 503);
  }

  const selMode = (getSetting<{ mode: SelectionMode }>(db, 'selection'))?.mode ?? 'lowest-backoff';

  let lastErrorResponse: Response | null = null;

  for (let i = 0; i < combo.models.length; i++) {
```

Lalu, di dalam loop tepat setelah `const modelName = combo.models[i]!;`, tambahkan account selection per-iterasi. Cari:

```typescript
    const modelName = combo.models[i]!;
    let resolved;
```

Ganti dengan:

```typescript
    const modelName = combo.models[i]!;

    // Re-select account each iteration so recently-backoffed accounts are skipped
    const allAccounts = listEnabledAccounts(db);
    const accountStates: AccountState[] = allAccounts.map((a) => ({
      id: a.id,
      backoffLevel: a.backoff_level,
      rateLimitedUntil: a.rate_limited_until,
      lastError: a.last_error ? (safeJsonParse(a.last_error) as AccountState['lastError']) : null,
      status: a.status as AccountState['status'],
      enabled: !!a.enabled,
    }));
    const { account, reason, nextCursor } = selectAccount(accountStates, {
      mode: selMode,
      cursor: rrCursor,
      clientKeyId: clientKey?.id,
      stickyMap,
    });
    if (nextCursor != null) rrCursor = nextCursor;
    if (!account) {
      log.warn({ combo: combo.name, model: modelName }, 'combo: no accounts available for this model, trying next');
      continue;
    }
    const acc = allAccounts.find((a) => a.id === account.id)!;
    if (i === 0) {
      consoleBus.emit(buildAccount(reqId, new Date().toISOString(), acc.label, reason));
    }

    let resolved;
```

Catatan: `consoleBus.emit(buildAccount(...))` hanya di iterasi pertama supaya tidak spam console event. Hapus baris `consoleBus.emit(buildAccount(...))` yang lama (baris ~229 setelah blok account selection yang dihapus).

- [ ] **Step 2: Jalankan test**

```bash
npx vitest run tests/integration/combo-fallback.test.ts
```

Expected: semua test PASS termasuk `re-selects account`.

- [ ] **Step 3: Jalankan full test suite**

```bash
npm test
```

Expected: semua PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts tests/integration/combo-fallback.test.ts
git commit -m "fix(combo): re-select account per model iteration for proper account diversity"
```
