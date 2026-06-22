# 2026-06-19: Audit Fixes (Data Correctness + Security)

> **Status:** Draft, awaiting user review.
> **Scope:** 9 verified findings from the 2026-06-19 admin-API/data-layer audit. 6 audit findings were dropped after verification (see "Dropped" appendix) because they matched documented design or were already correct in the code.

## Context

On 2026-06-19 the admin API + data layer was audited against a checklist of common logic-bug patterns (per-provider scope leaks, stale upserts, filter-dropped queries, sequential awaits, comment-vs-code drift). 23 candidate findings were produced by a subagent. Each finding was then re-verified by reading the actual code and project docs (`AGENTS.md`, `ARCHITECTURE.md`, `docs/adr/*.md`). 6 were false positives; 9 are real bugs documented here.

3 of the 9 were fixed in-session (in `src/db/repos/models.ts`, `src/api/admin/usage.ts`, `src/api/admin/models.ts`); the remaining 6 are scoped for this spec.

User-stated principles the design honours:
1. **No false findings.** Every item below is grounded in either a code path that demonstrably misbehaves or a documented invariant the code currently violates. "Looks wrong" is not enough.
2. **No silent regression.** Every fix gets a regression test in the relevant existing test file, asserting both the new behaviour and the previously-broken behaviour.
3. **No doc/code drift.** Where the JSDoc/comment and the code disagree, the code is the source of truth unless the user says otherwise. The fix updates both.

## Approach

Two implementation styles, applied per-section:

- **Section A (data correctness).** Targeted patches in place. Most fixes are 5-20 LOC changes to a single repo function or admin route. Refactor is avoided; the bug class is "the function does the wrong thing" not "the design is wrong." Each fix is paired with a regression test in the existing test file.
- **Section B (security/permission).** Validation at the admin-route boundary. The codebase already uses valibot for body schemas in the larger routes; the fix extends that pattern to the combo/alias write paths so the "name uniqueness across the bare namespace" invariant is enforced symmetrically in both directions.

No new dependencies. No breaking schema changes. All fixes are additive (new column writes, new test cases) or constraining (new input validation that rejects previously-accepted bodies with a 400).

---

## Section A: Data Correctness (7 items)

### A1. `upsertModel` partial-write leaks stale values (HIGH) (**FIXED 2026-06-19**)

**Problem.** `upsertModel` updated only the keys present in the input. A re-seed that stopped emitting a field left the previous value in the row. Worse, the `provider` column was updatable, so a single `name` could silently flip between providers on partial-upsert, breaking routing and per-provider counts.

**Fix (in `src/db/repos/models.ts:48`).** Introduce an `UPSERTABLE_COLUMNS` whitelist. Excluded columns: `name`, `id`, `created_at` (PK / audit), and `provider` (decided at INSERT time, immutable on update). Skip `undefined` values so a partial upsert never overwrites real data with `NULL`.

**Test.** New case in `src/db/repos/models.test.ts` covering: (a) omit a field → existing value preserved; (b) pass `undefined` for a field → existing value preserved; (c) attempt to change `provider` → existing provider wins; (d) full upsert with all fields → all fields updated.

---

### A2. `/api/admin/models/fetch/:provider` returned global row count (HIGH) (**FIXED 2026-06-19**)

**Problem.** The fetch handler returned `listModels().length` (94 = all models in DB) instead of the count for the fetched provider, so the dashboard's toast claimed "Fetched (94 total)" when the user clicked the MiniMax fetch button.

**Fix (in `src/api/admin/models.ts:273,289,297`).** Add `provider` filter to `listModels` (in `src/db/repos/models.ts:31`) and pass it from all three fetch branches (minimax, pioneer, builtin reseed). Result is now per-provider scoped.

**Test.** New case in `src/api/admin/models.test.ts` mocking the upstream and asserting `r.total` matches the MiniMax family count, not the global count.

---

### A3. `aggregateUsage` ignored all filters except `clientKeyId` (HIGH) (**FIXED 2026-06-19**)

**Problem.** `aggregateUsage(db, { clientKeyId, days })` only applied those two filters. The `usage` route passed them through unchanged and computed the previous-period delta inline with a hand-rolled SQL that ALSO ignored every other filter. Result: a request filtered by `account_id=X` returned the summary for ALL accounts and a meaningless delta.

**Fix (in `src/db/repos/requestLogs.ts:379` + `src/api/admin/usage.ts:71-93`).** Extended `aggregateUsage` signature to accept `accountId`, `model`, `statusCode`, `search`, `fromIso`, `toIso`. The route now passes the same filter set to both current and previous period. The previous period is computed via a second `aggregateUsage` call with `fromIso=prevSince, toIso=since, days=0` to keep the filter logic in one place.

**Test.** New case in `src/api/admin/usage.test.ts` seeding logs across two accounts and asserting: (a) summary matches the filtered subset; (b) delta % matches the prior-period filtered subset; (c) `from`/`to` overrides `days`.

---

### A4. Manual `POST /api/admin/models` omits `family` field (HIGH)

**Problem.** `models.ts:88-97` inserts a row with `display_name`, `context_window`, `pricing_*`, `provider`, `source`, but never `family`. Result: admin-created rows have `family = NULL`, which breaks `ADAPTIVE_THINKING_MODELS` matching in `src/providers/alias.ts:14` and breaks the per-family grouping in the models dashboard table.

**Fix.** Pass `family: body.family ?? null` to the `upsertModel` call. Treat `family` as a free-form user string in the manual path (no enum constraint); the resolver already does string-match.

**Test.** New case in `src/api/admin/models.test.ts` POSTing a model with `family: 'custom'` and asserting the row's `family` column equals `'custom'`. Also assert POSTing without `family` leaves it NULL (current behaviour preserved for back-compat).

---

### A5. `quota.ts` does `await ensureAccessToken` + `await fetchKiroUsage` sequentially per account (HIGH)

**Problem.** `src/api/admin/quota.ts:21-24` loops over enabled Kiro accounts and `await`s each upstream call. With 5 Kiro accounts the dashboard hangs for ~5 round trips per refresh. Worse: if `ensureAccessToken` fails on one account, the whole `quota` request 502s and the user sees zero quota for ALL accounts, not just the broken one.

**Fix.** Replace the sequential loop with `Promise.allSettled` over the per-account `fetchKiroUsage` calls. Return a per-account result shape: `[{ accountId, ok: bool, windows?: ..., error?: ... }]`. The UI can render failures inline per account.

**Test.** New case in `src/api/admin/quota.test.ts` with two accounts where one has a deliberately broken refresh token: assert the response includes the healthy account's quota and a per-account `error` for the broken one (no 502 for the whole endpoint).

---

### A6. Admin cache hides writes for 1 s (MED)

**Problem.** `getAdminCached` / `setAdminCached` (in `src/api/admin/cache.ts:22`) uses a 1 s TTL. A burst of 50 logged requests within the same second is hidden from the overview, usage, and quota pages. The cache was meant to reduce SQLite pressure on dashboard refresh, not to mask live data.

**Fix.** Drop the TTL to 250 ms (refresh feels live to humans) AND add a `bumpAdminCacheVersion()` hook called from `insertRequestLogDeferred` after the deferred-queue flush (in `src/db/repos/requestLogs.ts`). The version bump invalidates the cache immediately on every batch of writes.

**Test.** New case in `src/api/admin/cache.test.ts` asserting: (a) `bumpAdminCacheVersion` makes the next `getAdminCached` miss for any key; (b) within-TTL reads still hit the cache.

---

### A7. `getSettingT` returns `{}` for missing keys, not `null` (MED)

**Problem.** `src/api/admin/settings.ts:14-17` returns `{ caveman: getSettingT(...) ?? { level: 'off' } }` and similar. The default is silently applied at the route layer. The client cannot distinguish "user set this to default" from "key never written." Auditing a user's config requires reading the DB directly.

**Fix.** Return `null` (or `undefined`) when the key is missing; let the client pick the default. Update the client to merge defaults on the read side.

**Test.** New case in `src/api/admin/settings.test.ts` asserting `GET /api/admin/settings` returns `null` for any key that was never written via `POST`. Adjust the existing client test fixtures to merge defaults client-side.

---

## Section B: Security / Permission (2 items)

### B1. Combo/alias name uniqueness enforced one-way only (HIGH)

**Problem.** `src/db/repos/combos.ts:36` `checkAliasConflict` runs on `createCombo` and on combo rename. It blocks creating a combo whose name is already an alias. But `src/db/repos/aliases.ts:47` `upsertAlias` does NOT check whether a combo with the same name already exists. Per `docs/adr/0008-combo-fallback-chains.md` (the "Combo names must not shadow aliases" decision), the invariant is "names are unique across the bare namespace." Inserting combo first, then inserting an alias with the same name, silently violates that invariant. Resolution is undefined for the bare-name lookup.

**Fix.** Add a `checkComboConflict(db, name)` mirror in `combos.ts` and call it from `upsertAlias` in `aliases.ts:47`. If a combo already owns the name, reject with the same error shape that the reverse direction uses today.

**Test.** New case in `src/db/repos/aliases.test.ts`: (a) create a combo named `my-alias`; (b) attempt `upsertAlias({ aliasName: 'my-alias', ... })`; (c) assert it throws / returns the documented conflict error. Also: existing test for the reverse direction (alias blocks combo) still passes.

---

### B2. `upsertAlias` does not update `source` on existing rows (MED)

**Problem.** `aliases.ts:51-55` `UPDATE` only sets `upstream_model` and `label`. A row created by the seed with `source: 'seed'` and later edited by a user keeps `source: 'seed'`. The Aliases page badges the row as seed-sourced, hiding that the user has overridden it. Audit log noise.

**Fix.** Include `source = ?` in the UPDATE. Pass `args.source ?? 'user'` (so a future seed re-run can re-tag with `'seed'` if the seed itself explicitly passes it; default for user-initiated edits stays `'user'`).

**Test.** New case in `src/db/repos/aliases.test.ts`: (a) insert alias with `source: 'seed'`; (b) call `upsertAlias` with `source: 'user'`; (c) assert the row's `source` column is now `'user'`. Existing tests for the seed-init path still pass.

---

## Cross-cutting

### Testing strategy

- All new test cases live in the existing test file for the module they exercise.
- Each fix is paired with at least one regression test that asserts BOTH the new behaviour and the previously-broken shape (so a future refactor that re-introduces the bug is caught).
- No new test framework / harness. Vitest + happy-dom only (matches existing client + server test setup).

### Out of scope (intentionally not in this spec)

- Refactoring `upsertModel` to a `ModelsService` class. Bug is fixable in place.
- A new `aggregateUsage` SQL builder abstraction. Current extension is small.
- Auth / RBAC. The project is single-user self-host; account-level auth is not in scope.
- Admin UI changes beyond the existing toast text in `ProviderModelsSection.tsx` (already correct after A2).

### Dropped from the original 23-finding audit

| Finding | Why dropped |
|---|---|
| `resolveModel` bare path resolves aliases across providers | **Documented design.** `AGENTS.md:120`: "Unprefixed names resolve only as a combo name or an alias (strict). A bare raw model name is rejected with 400." Aliases are intentionally provider-agnostic per `docs/adr/0008`. |
| Pioneer dedup with repeated `pioneer/` wraps | **Code already correct.** `src/providers/pioneer/models.ts:277` uses `(?:anthropic\/pioneer\/\|pioneer\/)+`; the `+` quantifier handles repeated wraps in one pass. |
| `POST /api/admin/accounts` accepts arbitrary `provider` | **Code already validates.** `src/api/admin/accounts.ts:97-103` rejects with 400 if `provider` is not in `PROVIDER_ALLOWLIST`. |
| `fetchModels` doesn't pass `provider: 'minimax'` | **Not actually a bug.** MiniMax rows are stored bare (no `pioneer/...` prefix), so there's no name collision across providers. The default `'minimax'` insert is correct. |
| `display_name` re-prefixed on every Pioneer re-seed | **Idempotent by design.** The row already says "Pioneer claude-opus-4-8"; re-running with the same name produces the same string. |
| `requestLogs` deferred queue drops oldest | **Correct FIFO.** `queue.shift()` removes the oldest entry to make room. The newest entry (most likely the one we just tried to insert) is preserved. |

---

## Files touched (planned)

- `src/db/repos/models.ts` (A1 done)
- `src/api/admin/models.ts` (A2 done, A4)
- `src/db/repos/requestLogs.ts` (A3 done, A6 hook)
- `src/api/admin/usage.ts` (A3 done)
- `src/api/admin/quota.ts` (A5)
- `src/api/admin/cache.ts` (A6)
- `src/api/admin/settings.ts` (A7)
- `client/src/components/settings/SettingsPanel.tsx` (A7: default-merge on read side; specific file to be confirmed by impl)
- `src/db/repos/combos.ts` (B1)
- `src/db/repos/aliases.ts` (B1, B2)
- Test files for each module above (one new case per fix)

No new files. No new dependencies. No schema migration.

## Open questions for the user

None. Spec is ready for review. If you want to defer A6 (cache TTL) or A7 (settings defaults) to a follow-up spec, say so and I'll split them out.
