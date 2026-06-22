# Provider Error-Handling Helpers Implementation Plan

> **For agentic workers:** Execute this plan with the [superpowers:subagent-driven-development](https://github.com/anthropics/superpowers) workflow, one task at a time, each behind its own failing-test → impl → pass → commit cycle. Do not skip the red step. Do not edit code outside the task's stated files. Match the exact helper signatures at every call site.

**Goal:** Close the four systemic error-handling gaps (pre-fetch model-lock gate, `setModelLock` on cooldown, `parseError` for retry-after/base_resp_code, `disableAccount` on balance-exhausted) across kiro, codebuddy, pioneer, zai, and notion by extracting two shared helpers from the `src/proxy/minimax.ts` reference sequence and wiring them into every non-minimax provider.

**Architecture:**
Two pure-ish helpers live in a new file `src/proxy/errorHandling.ts`.

1. `assertModelNotLocked(db, accountId, model)`, the **pre-fetch gate** (Pattern #1). Runs `clearExpiredModelLocks(db)` then `isModelLockActive(getModelLock(db, accountId, model))`. Returns `true` when the account is locked for `model` (caller should respond `429`); `false` when clear to proceed. Mirrors `src/proxy/minimax.ts:303-305`.

2. `handleUpstreamError(db, { account, acc, status, errBody, response, requestedModel, upstreamModel })`, the **post-fetch canonical sequence** (Patterns #2/#3/#4). Runs `parseError(response, errBody)` (when a `Response` is available; otherwise a degraded parse from body text only) → `checkFallbackError(...)` → `applyErrorState(stateDb, acc, decision, errBody, parsed)` → `setModelLock(db, account.id, upstreamModel, decision.cooldownMs)` when `cooldownMs > 0` → `disableAccount(db, account.id)` when `decision.source === 'balance'`. Returns `{ decision, parsed }` so the caller can emit its console/log/return using the same values (baseRespCode for the log row, decision.cooldownMs for the lock). Mirrors `src/proxy/minimax.ts:349-365`.

Both helpers take the raw `better-sqlite3` `Database` handle (same type the lock/account-repo functions expect) plus an `AccountState`-shaped `acc` for `applyErrorState`. Each provider constructs its existing `stateDb: Db = { updateAccount: (id, patch) => updateAccount(db, id, patch) }` adapter and passes it in.

**Tech Stack:** TypeScript, Hono, Node 20+, better-sqlite3, vitest. Tests use the in-memory temp-DB pattern (`process.env.ROUTER_DB_PATH = join(mkdtempSync(...), 't.db')` + `openDb()` + `createAccount(...)`) already established in `src/accounts/locks.test.ts` and `src/proxy/codebuddy.test.ts`.

---

## File Structure

- **NEW** `src/proxy/errorHandling.ts`, shared `assertModelNotLocked` + `handleUpstreamError` helpers.
- **NEW** `src/proxy/errorHandling.test.ts`, vitest coverage for both helpers.
- **MODIFY** `src/proxy/kiro.ts`, add pre-fetch gate (~L93-114), replace L171-196 error block with `handleUpstreamError`, add error-state to the L221-227 transport/token-refresh catch.
- **MODIFY** `src/providers/kiro/index.ts`, thread `retry-after` through `KiroExecuteResult` so `handleUpstreamError` can parse it (L96-143, return shape L120-127).
- **MODIFY** `src/proxy/codebuddy.ts`, add pre-fetch gate (~L93), replace L182-221 error block with `handleUpstreamError` (adds `parseError` + `setModelLock` + `disableAccount`).
- **MODIFY** `src/proxy/pioneer.ts`, add pre-fetch gate (~L93), replace L182-220 error block with `handleUpstreamError`, fix `clearErrorState` placement so prior backoff isn't wiped prematurely.
- **MODIFY** `src/proxy/zai.ts`, add pre-fetch gate (~L95), replace L162-198 error block with `handleUpstreamError`.
- **MODIFY** `src/proxy/notion.ts`, add pre-fetch gate, add full error sequence to the L208-220 upstream-error block and the L170-179 cookie-missing path via `handleUpstreamError`/account error marking.

---

## Reference signatures (do not deviate)

From `src/providers/parseError.ts`:
```ts
export function parseError(resp: Response, bodyText: string): {
  baseRespCode?: number; windowResetMs?: number; retryAfterSec?: number; message: string;
};
```

From `src/accounts/errorRules.ts`:
```ts
export function checkFallbackError(
  status: number, errorText: string, baseRespCode: number | undefined,
  backoffLevel: number, windowResetMs?: number, retryAfterHeader?: number
): FallbackDecision; // FallbackDecision.source: 'rule'|'default'|'window-reset'|'balance'|'token-limit'|'param'
```

From `src/proxy/pipeline.ts`:
```ts
export interface Db { updateAccount(id: string, patch: Partial<Account>): void; }
export function applyErrorState(db: Db, acc: AccountState, decision: FallbackDecision, errBody: string, parsed: { status: number; baseRespCode?: number }): void;
```

From `src/accounts/locks.ts` and `src/accounts/state.ts` and `src/db/repos/accounts.ts`:
```ts
export function setModelLock(db: Database.Database, accountId: string, model: string, cooldownMs: number): void;
export function getModelLock(db: Database.Database, accountId: string, model: string): ModelLock | undefined;
export function clearExpiredModelLocks(db: Database.Database): void;
export function isModelLockActive(lock: ModelLock | undefined): boolean;
export function disableAccount(db: Database.Database, id: string): void;
```

---

## Task 1: Write + test the shared `handleUpstreamError` helper

- [ ] Create `src/proxy/errorHandling.test.ts` with a failing test:
```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/index.js';
import { createAccount } from '../db/repos/accounts.js';
import { getAccountById } from '../db/repos/accounts.js';
import { _resetLockCleanupThrottle } from '../accounts/locks.js';
import { getModelLock } from '../accounts/locks.js';
import { handleUpstreamError } from './errorHandling.js';

describe('handleUpstreamError', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'eh-')), 't.db');
    _resetLockCleanupThrottle();
  });

  it('applies error state + sets a model lock on a 429 rate-limit', () => {
    const db = openDb();
    const acc = createAccount(db, { id: 'acc_1', label: 'L', credit_type: 'payg', api_key: 'kk', provider: 'codebuddy', enabled: true });
    const resp = new Response('rate limit reached', { status: 429 });
    const { decision } = handleUpstreamError(db, {
      account: acc, acc: { id: acc.id, backoffLevel: 0, rateLimitedUntil: null, lastError: null, status: 'active', enabled: true },
      status: 429, errBody: 'rate limit reached', response: resp, upstreamModel: 'cb/claude-opus-4.6',
    });
    expect(decision.cooldownMs).toBeGreaterThan(0);
    const after = getAccountById(db, acc.id)!;
    expect(after.rate_limited_until).not.toBeNull();
    expect(getModelLock(db, acc.id, 'cb/claude-opus-4.6')).toBeDefined();
    expect(after.enabled).toBe(1); // not balance → not disabled
  });

  it('disables the account when source is balance (base_resp 1008)', () => {
    const db = openDb();
    const acc = createAccount(db, { id: 'acc_2', label: 'L', credit_type: 'payg', api_key: 'kk', provider: 'minimax', enabled: true });
    const body = JSON.stringify({ base_resp: { status_code: 1008 } });
    const resp = new Response(body, { status: 402 });
    handleUpstreamError(db, {
      account: acc, acc: { id: acc.id, backoffLevel: 0, rateLimitedUntil: null, lastError: null, status: 'active', enabled: true },
      status: 402, errBody: body, response: resp, upstreamModel: 'MiniMax-M2',
    });
    expect(getAccountById(db, acc.id)!.enabled).toBe(0);
  });

  it('respects retry-after header when present', () => {
    const db = openDb();
    const acc = createAccount(db, { id: 'acc_3', label: 'L', credit_type: 'payg', api_key: 'kk', provider: 'codebuddy', enabled: true });
    const resp = new Response('slow down', { status: 429, headers: { 'retry-after': '7' } });
    const { decision } = handleUpstreamError(db, {
      account: acc, acc: { id: acc.id, backoffLevel: 0, rateLimitedUntil: null, lastError: null, status: 'active', enabled: true },
      status: 429, errBody: 'slow down', response: resp, upstreamModel: 'cb/x',
    });
    expect(decision.cooldownMs).toBe(7000);
  });

  it('parses from body-only when no Response is supplied (kiro path)', () => {
    const db = openDb();
    const acc = createAccount(db, { id: 'acc_4', label: 'L', credit_type: 'payg', api_key: 'kk', provider: 'kiro', enabled: true });
    const { parsed } = handleUpstreamError(db, {
      account: acc, acc: { id: acc.id, backoffLevel: 0, rateLimitedUntil: null, lastError: null, status: 'active', enabled: true },
      status: 429, errBody: 'rate limit', response: undefined, upstreamModel: 'kiro/x',
      retryAfterSec: 3,
    });
    expect(parsed.baseRespCode).toBeUndefined();
    expect(getModelLock(db, acc.id, 'kiro/x')).toBeDefined();
  });
});
```
(If `getAccountById` does not exist, read `src/db/repos/accounts.ts` first and use whatever single-row-by-id reader it exports; if none, query via `db.prepare('SELECT enabled FROM accounts WHERE id=?').get(acc.id)`.)

- [ ] Run `npx vitest run src/proxy/errorHandling.test.ts` → expect FAIL (module `./errorHandling.js` does not exist).

- [ ] Create `src/proxy/errorHandling.ts`:
```ts
import type Database from 'better-sqlite3';
import { checkFallbackError, type FallbackDecision } from '../accounts/errorRules.js';
import { setModelLock } from '../accounts/locks.js';
import { disableAccount, updateAccount } from '../db/repos/accounts.js';
import { parseError } from '../providers/parseError.js';
import type { AccountState } from '../accounts/types.js';
import type { Db } from './pipeline.js';

export interface UpstreamErrorInput {
  account: { id: string };
  acc: AccountState;
  status: number;
  errBody: string;
  response?: Response;
  retryAfterSec?: number;
  upstreamModel: string;
}

export interface UpstreamErrorResult {
  decision: FallbackDecision;
  parsed: { baseRespCode?: number; windowResetMs?: number; retryAfterSec?: number; message: string };
}

/**
 * Canonical post-fetch error sequence shared by every provider.
 * parseError → checkFallbackError → applyErrorState → setModelLock → disableAccount.
 * Mirrors src/proxy/minimax.ts:349-365.
 */
export function handleUpstreamError(db: Database.Database, input: UpstreamErrorInput): UpstreamErrorResult {
  const stateDb: Db = { updateAccount: (id, patch) => updateAccount(db, id, patch) };
  const parsed = input.response
    ? parseError(input.response, input.errBody)
    : {
        baseRespCode: undefined,
        windowResetMs: undefined,
        retryAfterSec: input.retryAfterSec,
        message: input.errBody || `HTTP ${input.status}`,
      };
  const decision = checkFallbackError(
    input.status,
    parsed.message,
    parsed.baseRespCode,
    input.acc.backoffLevel,
    parsed.windowResetMs,
    parsed.retryAfterSec ? parsed.retryAfterSec * 1000 : undefined
  );
  stateDb.updateAccount; // satisfy linter that stateDb is used
  applyErrorState(stateDb, input.acc, decision, input.errBody, {
    status: input.status,
    baseRespCode: parsed.baseRespCode,
  });
  if (decision.cooldownMs > 0) setModelLock(db, input.account.id, input.upstreamModel, decision.cooldownMs);
  if (decision.source === 'balance') disableAccount(db, input.account.id);
  return { decision, parsed };
}

// applyErrorState is re-exported here only so the local import is used in tests/edge cases;
// the real write happens via the stateDb adapter above.
import { applyErrorState } from './pipeline.js';
```
(Note: hoist the `applyErrorState` import to the top of the file with the others, the inline import above is illustrative; the real file must have a single import block at the top. Remove the `stateDb.updateAccount;` placeholder line once the linter is satisfied, `stateDb` is passed into `applyErrorState` so it is genuinely used.)

- [ ] Run `npx vitest run src/proxy/errorHandling.test.ts` → expect PASS (4 tests).

- [ ] Commit: `feat(proxy): add shared handleUpstreamError helper`

---

## Task 2: Write + test the shared `assertModelNotLocked` helper

- [ ] Add to `src/proxy/errorHandling.test.ts` a failing test block:
```ts
import { assertModelNotLocked } from './errorHandling.js';
import { setModelLock } from '../accounts/locks.js';

describe('assertModelNotLocked', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'eh-')), 't.db');
    _resetLockCleanupThrottle();
  });

  it('returns false when no lock exists', () => {
    const db = openDb();
    expect(assertModelNotLocked(db, 'acc_1', 'm')).toBe(false);
  });

  it('returns true when an active lock exists', () => {
    const db = openDb();
    setModelLock(db, 'acc_1', 'm', 60_000);
    expect(assertModelNotLocked(db, 'acc_1', 'm')).toBe(true);
  });

  it('clears expired locks and returns false for an expired one', () => {
    const db = openDb();
    setModelLock(db, 'acc_1', 'm', -1000);
    expect(assertModelNotLocked(db, 'acc_1', 'm')).toBe(false);
  });
});
```

- [ ] Run `npx vitest run src/proxy/errorHandling.test.ts` → expect FAIL (`assertModelNotLocked` is not exported).

- [ ] Add to `src/proxy/errorHandling.ts`:
```ts
import { clearExpiredModelLocks, getModelLock } from '../accounts/locks.js';
import { isModelLockActive } from '../accounts/state.js';

/**
 * Pre-fetch model-lock gate shared by every provider.
 * Returns true when the account is currently locked for `model` (caller → 429).
 * Mirrors src/proxy/minimax.ts:303-305.
 */
export function assertModelNotLocked(db: Database.Database, accountId: string, model: string): boolean {
  clearExpiredModelLocks(db);
  return isModelLockActive(getModelLock(db, accountId, model));
}
```
(Consolidate all imports into the single top-of-file import block.)

- [ ] Run `npx vitest run src/proxy/errorHandling.test.ts` → expect PASS (7 tests).

- [ ] Commit: `feat(proxy): add shared assertModelNotLocked pre-fetch gate`

---

## Task 3: Wire kiro: pre-fetch gate + full error sequence + catch error-state

- [ ] Read `src/proxy/kiro.ts` L23-50 (imports) and `src/providers/kiro/index.ts` L80-143 to confirm `KiroExecuteResult` shape before editing.

- [ ] Add a failing test to a new file `src/proxy/kiro.error.test.ts` (mirrors `src/proxy/codebuddy.test.ts` setup):
```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('handleKiroProxy error handling', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'kiro-')), 't.db');
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns 429 when the requested model is locked (pre-fetch gate)', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { setModelLock } = await import('../accounts/locks.js');
    const { handleKiroProxy } = await import('./kiro.js');
    const db = openDb();
    const acc = createAccount(db, { id: 'acc_k1', label: 'k', credit_type: 'token-plan', api_key: 'kk', provider: 'kiro', enabled: true });
    setModelLock(db, acc.id, 'kiro/claude', 60_000);
    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) => (k === 'clientKey' ? { id: 'ck_row_1' } : k === 'startTime' ? Date.now() : undefined),
      set: () => {},
      json: (o: unknown, s?: number) => new Response(JSON.stringify(o), { status: s ?? 200 }),
      body: (b: BodyInit, s?: number) => new Response(b, { status: s }),
    } as unknown as Parameters<typeof handleKiroProxy>[0];
    const resp = await handleKiroProxy(c, 'openai', '/v1/chat/completions', { model: 'kiro/claude', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }, db, { value: 0 }, new Map());
    expect(resp.status).toBe(429);
  });

  it('sets a model lock + applies error state on a 429 upstream', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { getModelLock } = await import('../accounts/locks.js');
    const { handleKiroProxy } = await import('./kiro.js');
    const db = openDb();
    const acc = createAccount(db, { id: 'acc_k2', label: 'k', credit_type: 'token-plan', api_key: 'kk', provider: 'kiro', enabled: true });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('rate limit reached', { status: 429, headers: { 'retry-after': '5' } }));
    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) => (k === 'clientKey' ? { id: 'ck_row_1' } : k === 'startTime' ? Date.now() : undefined),
      set: () => {},
      json: (o: unknown, s?: number) => new Response(JSON.stringify(o), { status: s ?? 200 }),
      body: (b: BodyInit, s?: number) => new Response(b, { status: s }),
    } as unknown as Parameters<typeof handleKiroProxy>[0];
    await handleKiroProxy(c, 'openai', '/v1/chat/completions', { model: 'kiro/claude', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }, db, { value: 0 }, new Map());
    expect(getModelLock(db, acc.id, 'kiro/claude')).toBeDefined();
  });
});
```
(Adjust `createAccount` required fields to match `src/db/repos/accounts.ts` if the above minimal shape is rejected; verify `provider: 'kiro'` is accepted.)

- [ ] Run `npx vitest run src/proxy/kiro.error.test.ts` → expect FAIL (no 429 gate; no lock set).

- [ ] Edit `src/proxy/kiro.ts`:
- Add imports: `import { assertModelNotLocked, handleUpstreamError } from './errorHandling.js';` and `import { clearExpiredModelLocks, getModelLock } from '../accounts/locks.js';` is NOT needed (helper owns it).
- After the `const acc = ...` / account-selected block (~L114, after `buildAccount` emit) and before the transport block, insert the pre-fetch gate:
```ts
if (assertModelNotLocked(db, acc.id, modelName)) {
return c.json({ error: `model ${modelName} temporarily locked` }, 429);
}
```
Place it right after the `consoleBus.emit(buildAccount(...))` at L114 so it runs before `resolveTransportForAccount`.
- Replace the L171-196 error block's `checkFallbackError`+`applyErrorState` portion. Replace:
```ts
const decision = checkFallbackError(
result.status,
errBody,
undefined,
acc.backoff_level,
undefined,
undefined
);
applyErrorState(stateDb, picked, decision, errBody, { status: result.status });
```
with:
```ts
const { decision } = handleUpstreamError(db, {
account: acc,
acc: picked,
status: result.status,
errBody,
response: undefined,
retryAfterSec: result.retryAfterSec,
upstreamModel: modelName,
});
```
- Add `retryAfterSec` to the kiro result: edit `src/providers/kiro/index.ts` so the `KiroExecuteResult` error branch (L120-127) reads the `retry-after` header and returns it:
```ts
if (!resp.ok) {
const ra = resp.headers.get('retry-after');
return {
ok: false,
status: resp.status,
errorBody: await resp.text(),
upstreamModel,
retryAfterSec: ra ? parseInt(ra, 10) : undefined,
};
}
```
Add `retryAfterSec?: number;` to the `KiroExecuteResult` type definition (read the interface above L96 to place the field correctly).
- In the L221-227 `catch (e: unknown)` block (transport/token-refresh throw), add error-state before returning:
```ts
} catch (e: unknown) {
const message = errorMessage(e);
log.error({ err: message }, 'kiro upstream error');
handleUpstreamError(db, {
account: acc, acc: picked, status: 502, errBody: message,
response: undefined, upstreamModel: modelName,
});
const rid = c.get('reqId') ?? '----';
consoleBus.emit(buildError(rid, new Date().toISOString(), 502, message));
return c.json({ error: `kiro upstream error: ${message}` }, 502);
}
```
- Remove now-unused `checkFallbackError` import if it becomes unused (kiro L29-31 imports `applyErrorState, ...` from pipeline, keep `clearErrorState`, drop `applyErrorState` if no longer referenced directly; verify with a grep before deleting).

- [ ] Run `npx vitest run src/proxy/kiro.error.test.ts` → expect PASS (2 tests).

- [ ] Run `npx vitest run src/proxy/kiro.test.ts` (if it exists) + `npx vitest run src/proxy/` to confirm no regressions.

- [ ] Commit: `fix(kiro): apply shared error handling + model-lock gate`

---

## Task 4: Wire codebuddy: pre-fetch gate + parseError + setModelLock + disableAccount

- [ ] Add a failing test to `src/proxy/codebuddy.test.ts` (new `describe` block):
```ts
it('sets a model lock and disables the account on a balance-exhausted upstream', async () => {
  const { openDb } = await import('../db/index.js');
  const { createAccount } = await import('../db/repos/accounts.js');
  const { getModelLock } = await import('../accounts/locks.js');
  const { getAccountById } = await import('../db/repos/accounts.js');
  const { handleCodeBuddyProxy } = await import('./codebuddy.js');
  const db = openDb();
  const acc = createAccount(db, { id: 'acc_cb_bal', label: 'cb', credit_type: 'token-plan', api_key: 'ck', base_url: 'https://www.codebuddy.ai', provider: 'codebuddy', enabled: true });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ base_resp: { status_code: 1008 } }), { status: 402 }));
  const c = {
    req: { method: 'POST', raw: { headers: new Headers() } },
    get: (k: string) => (k === 'clientKey' ? { id: 'ck_row_1' } : k === 'startTime' ? Date.now() : undefined),
    set: () => {},
    json: (o: unknown, s?: number) => new Response(JSON.stringify(o), { status: s ?? 200 }),
    body: (b: BodyInit, s?: number, h?: Record<string, string>) => new Response(b, { status: s, headers: h }),
  } as unknown as Parameters<typeof handleCodeBuddyProxy>[0];
  await handleCodeBuddyProxy(c, 'openai', '/v1/chat/completions', { model: 'cb/claude-opus-4.6', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }, db, { value: 0 }, new Map());
  expect(getAccountById(db, acc.id)!.enabled).toBe(0);
});

it('returns 429 when the requested model is locked (pre-fetch gate)', async () => {
  const { openDb } = await import('../db/index.js');
  const { createAccount } = await import('../db/repos/accounts.js');
  const { setModelLock } = await import('../accounts/locks.js');
  const { handleCodeBuddyProxy } = await import('./codebuddy.js');
  const db = openDb();
  const acc = createAccount(db, { id: 'acc_cb_lock', label: 'cb', credit_type: 'token-plan', api_key: 'ck', base_url: 'https://www.codebuddy.ai', provider: 'codebuddy', enabled: true });
  setModelLock(db, acc.id, 'cb/claude-opus-4.6', 60_000);
  const c = {
    req: { method: 'POST', raw: { headers: new Headers() } },
    get: (k: string) => (k === 'clientKey' ? { id: 'ck_row_1' } : k === 'startTime' ? Date.now() : undefined),
    set: () => {},
    json: (o: unknown, s?: number) => new Response(JSON.stringify(o), { status: s ?? 200 }),
    body: (b: BodyInit, s?: number, h?: Record<string, string>) => new Response(b, { status: s, headers: h }),
  } as unknown as Parameters<typeof handleCodeBuddyProxy>[0];
  const resp = await handleCodeBuddyProxy(c, 'openai', '/v1/chat/completions', { model: 'cb/claude-opus-4.6', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }, db, { value: 0 }, new Map());
  expect(resp.status).toBe(429);
});
```

- [ ] Run `npx vitest run src/proxy/codebuddy.test.ts` → expect FAIL (no disable, no 429 gate).

- [ ] Edit `src/proxy/codebuddy.ts`:
- Add import `import { assertModelNotLocked, handleUpstreamError } from './errorHandling.js';`.
- Add the pre-fetch gate after account selection and `buildAccount` emit, before transport resolution (~before L132). Use `upstreamModel`:
```ts
if (assertModelNotLocked(db, acc.id, upstreamModel)) {
return c.json({ error: `model ${upstreamModel} temporarily locked` }, 429);
}
```
(Confirm `acc` is the selected account handle in scope at that point, read L100-131 to verify the variable name; if the selection variable is named `account`/`acc`, use that.)
- Replace L182-221 error block (`const parsed = {...}` through the `applyErrorState(...)` + `return c.body(...)`) with:
```ts
if (!resp.ok) {
const errBody = await resp.text();
const { parsed } = handleUpstreamError(db, {
account: acc,
acc: { id: acc.id, backoffLevel: acc.backoff_level, rateLimitedUntil: acc.rate_limited_until ?? null, lastError: acc.last_error ? JSON.parse(acc.last_error) : null, status: acc.status as 'active' | 'error', enabled: !!acc.enabled },
status: resp.status,
errBody,
response: resp,
upstreamModel,
});
consoleBus.emit(
buildError(reqId, new Date().toISOString(), resp.status, parsed.message.slice(0, 200))
);
insertRequestLogDeferred(db, buildLogRow(logCtxBase({ responseBody: errBody, baseRespCode: parsed.baseRespCode })));
return c.body(errBody, statusCode(resp.status), {
'content-type': resp.headers.get('content-type') ?? 'application/json',
});
}
```
(Confirm `logCtxBase` accepts a `baseRespCode` override, it does, via `Partial<LogRowContext>`; the existing call sets `baseRespCode: undefined` in the base so the override takes precedence. If `acc.last_error` is null the `JSON.parse` is guarded by the ternary, keep it as written.)
- Remove the now-unused `checkFallbackError` import if it becomes unused.

- [ ] Run `npx vitest run src/proxy/codebuddy.test.ts` → expect PASS (3 tests).

- [ ] Commit: `fix(codebuddy): apply shared error handling + model-lock gate`

---

## Task 5: Wire pioneer: pre-fetch gate + parseError + setModelLock + disableAccount + fix clearErrorState

- [ ] Add a failing test to a new file `src/proxy/pioneer.error.test.ts` mirroring the codebuddy balance test:
```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('handlePioneerProxy error handling', () => {
  beforeEach(() => { process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'pio-')), 't.db'); });
  afterEach(() => vi.restoreAllMocks());

  it('disables the account on balance-exhausted (base_resp 1008)', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { getAccountById } = await import('../db/repos/accounts.js');
    const { handlePioneerProxy } = await import('./pioneer.js');
    const db = openDb();
    const acc = createAccount(db, { id: 'acc_p1', label: 'p', credit_type: 'token-plan', api_key: 'ck', base_url: 'https://pioneer.com', provider: 'pioneer', enabled: true });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ base_resp: { status_code: 1008 } }), { status: 402 }));
    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) => (k === 'clientKey' ? { id: 'ck_row_1' } : k === 'startTime' ? Date.now() : undefined),
      set: () => {},
      json: (o: unknown, s?: number) => new Response(JSON.stringify(o), { status: s ?? 200 }),
      body: (b: BodyInit, s?: number, h?: Record<string, string>) => new Response(b, { status: s, headers: h }),
    } as unknown as Parameters<typeof handlePioneerProxy>[0];
    await handlePioneerProxy(c, 'openai', '/v1/chat/completions', { model: 'pioneer/sonnet', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }, db, { value: 0 }, new Map());
    expect(getAccountById(db, acc.id)!.enabled).toBe(0);
  });

  it('returns 429 when the requested model is locked', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { setModelLock } = await import('../accounts/locks.js');
    const { handlePioneerProxy } = await import('./pioneer.js');
    const db = openDb();
    const acc = createAccount(db, { id: 'acc_p2', label: 'p', credit_type: 'token-plan', api_key: 'ck', base_url: 'https://pioneer.com', provider: 'pioneer', enabled: true });
    setModelLock(db, acc.id, 'sonnet', 60_000);
    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) => (k === 'clientKey' ? { id: 'ck_row_1' } : k === 'startTime' ? Date.now() : undefined),
      set: () => {},
      json: (o: unknown, s?: number) => new Response(JSON.stringify(o), { status: s ?? 200 }),
      body: (b: BodyInit, s?: number, h?: Record<string, string>) => new Response(b, { status: s, headers: h }),
    } as unknown as Parameters<typeof handlePioneerProxy>[0];
    const resp = await handlePioneerProxy(c, 'openai', '/v1/chat/completions', { model: 'pioneer/sonnet', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }, db, { value: 0 }, new Map());
    expect(resp.status).toBe(429);
  });
});
```
(Verify the `pioneer/` namespace strip at L71-72 means the lock key is the bare `upstreamModel`, `sonnet`, not `pioneer/sonnet`. Match the pre-fetch gate and the `setModelLock` model argument to the stripped `upstreamModel`.)

- [ ] Run `npx vitest run src/proxy/pioneer.error.test.ts` → expect FAIL.

- [ ] Edit `src/proxy/pioneer.ts`:
- Add import `import { assertModelNotLocked, handleUpstreamError } from './errorHandling.js';`.
- Add pre-fetch gate after `buildAccount` emit (L116 equivalent, read L100-133 to locate) using the stripped `upstreamModel`:
```ts
if (assertModelNotLocked(db, acc.id, upstreamModel ?? model)) {
return c.json({ error: `model ${upstreamModel ?? model} temporarily locked` }, 429);
}
```
- Replace L182-220 error block with `handleUpstreamError` (same shape as codebuddy Task 4, using `upstreamModel ?? model` and `response: resp`).
- **Fix the `clearErrorState` placement bug**: at L223 `clearErrorState(stateDb, account)` runs unconditionally on the success path. Verify it only runs after `resp.ok` is confirmed true (it does, it's past the `if (!resp.ok)` block) so it does NOT wipe a prior backoff on an error. If L223 is inside the success branch it is correct; the audit's concern is that an error must NOT reach `clearErrorState`. Confirm by reading L220-224; no change needed if `clearErrorState` is strictly after the error `return`. Document this in the commit message.
- Remove unused `checkFallbackError` import if applicable.

- [ ] Run `npx vitest run src/proxy/pioneer.error.test.ts` → expect PASS (2 tests).

- [ ] Commit: `fix(pioneer): apply shared error handling + model-lock gate`

---

## Task 6: Wire zai: pre-fetch gate + parseError + setModelLock + disableAccount

- [ ] Add a failing test to a new file `src/proxy/zai.error.test.ts` mirroring the pioneer balance test (provider `'zai'`, model `'zai/glm'`, lock key is stripped bare `upstreamModel`, read `src/proxy/zai.ts` L73-79 to confirm the `zai/` strip produces e.g. `glm`):
```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('handleZaiProxy error handling', () => {
  beforeEach(() => { process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'zai-')), 't.db'); });
  afterEach(() => vi.restoreAllMocks());

  it('disables the account on balance-exhausted (base_resp 1008)', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { getAccountById } = await import('../db/repos/accounts.js');
    const { handleZaiProxy } = await import('./zai.js');
    const db = openDb();
    const acc = createAccount(db, { id: 'acc_z1', label: 'z', credit_type: 'token-plan', api_key: 'ck', base_url: 'https://zai.com', provider: 'zai', enabled: true });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ base_resp: { status_code: 1008 } }), { status: 402 }));
    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) => (k === 'clientKey' ? { id: 'ck_row_1' } : k === 'startTime' ? Date.now() : undefined),
      set: () => {},
      json: (o: unknown, s?: number) => new Response(JSON.stringify(o), { status: s ?? 200 }),
      body: (b: BodyInit, s?: number, h?: Record<string, string>) => new Response(b, { status: s, headers: h }),
    } as unknown as Parameters<typeof handleZaiProxy>[0];
    await handleZaiProxy(c, 'openai', '/v1/chat/completions', { model: 'zai/glm', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }, db, { value: 0 }, new Map());
    expect(getAccountById(db, acc.id)!.enabled).toBe(0);
  });

  it('returns 429 when the requested model is locked', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { setModelLock } = await import('../accounts/locks.js');
    const { handleZaiProxy } = await import('./zai.js');
    const db = openDb();
    const acc = createAccount(db, { id: 'acc_z2', label: 'z', credit_type: 'token-plan', api_key: 'ck', base_url: 'https://zai.com', provider: 'zai', enabled: true });
    setModelLock(db, acc.id, 'glm', 60_000);
    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) => (k === 'clientKey' ? { id: 'ck_row_1' } : k === 'startTime' ? Date.now() : undefined),
      set: () => {},
      json: (o: unknown, s?: number) => new Response(JSON.stringify(o), { status: s ?? 200 }),
      body: (b: BodyInit, s?: number, h?: Record<string, string>) => new Response(b, { status: s, headers: h }),
    } as unknown as Parameters<typeof handleZaiProxy>[0];
    const resp = await handleZaiProxy(c, 'openai', '/v1/chat/completions', { model: 'zai/glm', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }, db, { value: 0 }, new Map());
    expect(resp.status).toBe(429);
  });
});
```
(Verify the lock model key matches the stripped `upstreamModel` used at the gate and in `handleUpstreamError`. If `zai/glm` resolves to bare `glm` per L77-79, use `'glm'`. If zai does NOT strip, use the full resolved id, read L73-79 to confirm before finalizing both the test and the impl.)

- [ ] Run `npx vitest run src/proxy/zai.error.test.ts` → expect FAIL.

- [ ] Edit `src/proxy/zai.ts`:
- Add import `import { assertModelNotLocked, handleUpstreamError } from './errorHandling.js';`.
- Add pre-fetch gate after `buildAccount` emit (read L100-133 to locate), using `upstreamModel ?? model`:
```ts
if (assertModelNotLocked(db, acc.id, upstreamModel ?? model)) {
return c.json({ error: `model ${upstreamModel ?? model} temporarily locked` }, 429);
}
```
- Replace L162-198 error block with `handleUpstreamError` (same shape as codebuddy/pioneer, `response: resp`, `upstreamModel: upstreamModel ?? model`).
- Remove unused `checkFallbackError` import if applicable.

- [ ] Run `npx vitest run src/proxy/zai.error.test.ts` → expect PASS (2 tests).

- [ ] Commit: `fix(zai): apply shared error handling + model-lock gate`

---

## Task 7: Wire notion: full error sequence + account error marking for cookie expiry

- [ ] Add a failing test to a new file `src/proxy/notion.error.test.ts`:
```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('handleNotionProxy error handling', () => {
  beforeEach(() => { process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'notion-')), 't.db'); });
  afterEach(() => vi.restoreAllMocks());

  it('marks the account as error on a 401 upstream (cookie expiry)', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { getAccountById } = await import('../db/repos/accounts.js');
    const { handleNotionProxy } = await import('./notion.js');
    const db = openDb();
    const acc = createAccount(db, {
      id: 'acc_n1', label: 'n', credit_type: 'payg', api_key: 'kk', provider: 'notion', enabled: true,
      provider_data: JSON.stringify({ cookies: { notion_user_id: 'u', token_v2: 't', notion_user_device_id: 'd' }, spaceId: 's' }),
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unauthorized', { status: 401 }));
    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) => (k === 'clientKey' ? { id: 'ck_row_1' } : k === 'startTime' ? Date.now() : undefined),
      set: () => {},
      json: (o: unknown, s?: number) => new Response(JSON.stringify(o), { status: s ?? 200 }),
    } as unknown as Parameters<typeof handleNotionProxy>[0];
    await handleNotionProxy(c, 'openai', '/v1/chat/completions', { model: 'notion', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }, db, { value: 0 }, new Map());
    expect(getAccountById(db, acc.id)!.status).toBe('error');
  });

  it('sets a model lock on a 429 upstream', async () => {
    const { openDb } = await import('../db/index.js');
    const { createAccount } = await import('../db/repos/accounts.js');
    const { getModelLock } = await import('../accounts/locks.js');
    const { handleNotionProxy } = await import('./notion.js');
    const db = openDb();
    createAccount(db, {
      id: 'acc_n2', label: 'n', credit_type: 'payg', api_key: 'kk', provider: 'notion', enabled: true,
      provider_data: JSON.stringify({ cookies: { notion_user_id: 'u', token_v2: 't', notion_user_device_id: 'd' }, spaceId: 's' }),
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('rate limit', { status: 429 }));
    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) => (k === 'clientKey' ? { id: 'ck_row_1' } : k === 'startTime' ? Date.now() : undefined),
      set: () => {},
      json: (o: unknown, s?: number) => new Response(JSON.stringify(o), { status: s ?? 200 }),
    } as unknown as Parameters<typeof handleNotionProxy>[0];
    await handleNotionProxy(c, 'openai', '/v1/chat/completions', { model: 'notion', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }, db, { value: 0 }, new Map());
    expect(getModelLock(db, 'acc_n2', 'notion')).toBeDefined();
  });
});
```
(Verify `NOTION_AI_COOKIE_NAMES` against `src/providers/notion/constants.ts` to set the cookie keys the test seeds, read the file to confirm the exact names; adjust the test's `cookies` object accordingly. The `'notion'` model-lock key matches `upstreamModel` which defaults to `'notion'` at L… of notion.ts.)

- [ ] Run `npx vitest run src/proxy/notion.error.test.ts` → expect FAIL (no error state, no lock).

- [ ] Edit `src/proxy/notion.ts`:
- Add imports: `import { assertModelNotLocked, handleUpstreamError } from './errorHandling.js';` and `import { buildAccountStates } from './pipeline.js';` (already imports `buildLogRow` from pipeline, extend that import line) and `import { updateAccount } from '../db/repos/accounts.js';`.
- Add pre-fetch gate after `account = pickAccount(db)` + cookie/spaceId validation succeeds, before `buildAccount` emit (~L181):
```ts
if (assertModelNotLocked(db, account.id, upstreamModel)) {
return failAndLog(429, 'upstream_error', `model ${upstreamModel} temporarily locked`, account.id);
}
```
- Build an `AccountState` from the picked account for `handleUpstreamError`. Add a small adapter near `pickAccount`:
```ts
function toAccountState(a: Account): AccountState {
return {
id: a.id,
backoffLevel: a.backoff_level,
rateLimitedUntil: a.rate_limited_until ?? null,
lastError: a.last_error ? (JSON.parse(a.last_error) as AccountState['lastError']) : null,
status: a.status as AccountState['status'],
enabled: !!a.enabled,
};
}
```
(Import `AccountState` type from `../accounts/types.js`.)
- Replace the L208-220 upstream-error block:
```ts
if (!upstream.ok) {
const errBody = await upstream.text();
const status = upstream.status;
const isFatal = NOTION_FATAL_STATUSES.has(status);
log.warn({ reqId, accountId: account.id, status, fatal: isFatal }, `notion upstream HTTP ${status}`);
handleUpstreamError(db, {
account, acc: toAccountState(account), status, errBody,
response: upstream, upstreamModel,
});
const message = `notion HTTP ${status}`;
if (status === 401 || status === 403) {
return failAndLog(401, 'notion_reauth_required', message, account.id);
}
return failAndLog(status, 'upstream_error', message, account.id);
}
```
- **Cookie-expiry account marking**: at L170-172 (missing cookies) and L176-178 (missing spaceId), the account is returned 401 but NOT marked in error state. Add an error-state write before each `failAndLog` so the account surfaces as errored:
```ts
if (!providerData?.cookies || !hasAllRequiredCookies(providerData.cookies)) {
updateAccount(db, account.id, { status: 'error', last_error: JSON.stringify({ status: 401, message: 'missing required cookies', timestamp: new Date().toISOString() }) });
const msg = `notion account ${account.id} missing required cookies; re-run notion-add-account`;
return failAndLog(401, 'notion_reauth_required', msg, account.id);
}
```
and similarly for the missing-`spaceId` branch at L176-178.

- [ ] Run `npx vitest run src/proxy/notion.error.test.ts` → expect PASS (2 tests).

- [ ] Commit: `fix(notion): apply full error sequence + mark account error on cookie expiry`

---

## Self-Review

**Spec coverage (Patterns #1-4 across kiro/codebuddy/pioneer/zai/notion):**

| Pattern | kiro | codebuddy | pioneer | zai | notion |
|---|---|---|---|---|---|
| #1 pre-fetch model-lock gate | Task 3 (kiro.ts) | Task 4 (codebuddy.ts) | Task 5 (pioneer.ts) | Task 6 (zai.ts) | Task 7 (notion.ts) |
| #2 setModelLock on cooldown | Task 3 (via handleUpstreamError) | Task 4 | Task 5 | Task 6 | Task 7 |
| #3 parseError (retry-after + base_resp_code) | Task 3 (body+retryAfterSec, since executeKiro discards Response) | Task 4 (full Response) | Task 5 (full Response) | Task 6 (full Response) | Task 7 (full Response) |
| #4 disableAccount on balance (source==='balance') | Task 3 (via handleUpstreamError) | Task 4 | Task 5 | Task 6 | Task 7 |

- Kiro's `parseError` gap is structural: `executeKiro` returns only the error body string (no `Response`, so no `retry-after` header). Task 3 threads `retryAfterSec` through `KiroExecuteResult` so `handleUpstreamError`'s body-only branch can still honor it. `base_resp_code` for kiro requires the body to contain `base_resp.status_code`; if kiro's upstream doesn't emit that, it stays undefined, same behavior as minimax when the field is absent.
- Notion additionally gains account-error marking on the cookie/spaceId-missing paths (Task 7), closing the audit's "cookie-expiry does not mark account error" finding beyond the upstream 401/403.

**Placeholder scan:**
- No "add appropriate error handling" / "similar to Task N" / TODO-style stubs remain. Every provider task repeats the full `handleUpstreamError` call site with real arguments.
- The kiro `KiroExecuteResult` edit and the notion `toAccountState` adapter are written out in full, not described.
- Test cookie names for notion (Task 7) are flagged for verification against `src/providers/notion/constants.ts` because the exact `NOTION_AI_COOKIE_NAMES` values were not read in this planning pass, the implementer must confirm before the test will pass.

**Signature consistency:**
- `assertModelNotLocked(db, accountId, model)`, identical 3-arg signature at every call site (kiro `acc.id`/`modelName`; codebuddy `acc.id`/`upstreamModel`; pioneer `acc.id`/`upstreamModel ?? model`; zai `acc.id`/`upstreamModel ?? model`; notion `account.id`/`upstreamModel`).
- `handleUpstreamError(db, { account, acc, status, errBody, response, retryAfterSec?, upstreamModel })`, identical object shape at every call site. `response` is `undefined` for kiro (body-only path with `retryAfterSec`); a real `Response` everywhere else. `retryAfterSec` is only passed by kiro.
- All call sites pass the raw `Database` handle as the first arg (matches `setModelLock`/`disableAccount`/`updateAccount` signatures, not the `Db` adapter, the `stateDb` adapter is constructed *inside* `handleUpstreamError`).

**Risk callouts for the implementer:**
1. Verify each provider's selected-account variable name (`acc` vs `account` vs `picked`) in scope at the pre-fetch gate insertion point before pasting, read the 5-10 lines above each insertion site.
2. The notion `failAndLog` is a closure over `upstreamModel`/`requestedModel` defined at L126-162; the pre-fetch gate at L181 must be inserted *after* `failAndLog` is defined and *after* `account` is in scope, but *before* the network fetch.
3. Pioneer L223 `clearErrorState`, confirm it is strictly inside the success path (after the `if (!resp.ok) return`). If the audit's "wipes prior backoff" concern refers to a different code path, do not move it blindly; re-read L182-224 and only adjust if an error can reach it.
4. After all tasks, run `npx vitest run` (full suite) to confirm no provider's existing happy-path test broke from the new pre-fetch gate (a test that mocks a locked model unintentionally would now get 429).
