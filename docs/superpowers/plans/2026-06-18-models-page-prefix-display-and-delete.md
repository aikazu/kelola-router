# Models page (prefix display, fetch, delete, copy) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize Pioneer model seeds from 139 to ~75 (strip `anthropic/pioneer/`
duplicates), clean existing DBs via migration, add per-card upstream fetch, model
delete with alias/combo safety, copy + edit row actions, and surface the client call
string (`pio/...`) in the Models dashboard.

**Architecture:** Backend = Hono JSON routes in `src/api/admin/models.ts` + a new
migration `009` (Pioneer dedup) and `010` (context_output column). Seeder fix in
`src/providers/pioneer/models.ts`. Client = new `providerPrefix.ts` lib + extended
`ProviderModelsSection.tsx` + `Models.tsx`.

**Tech Stack:** Hono, better-sqlite3 (WAL), TypeScript strict, Vitest, Preact +
TanStack Query + Vite, Biome.

**Spec:** `docs/superpowers/specs/2026-06-18-models-page-prefix-display-and-delete-design.md`
(Part A).

**Conventions:**
- Communication with user: Indonesian. Code/comments/commits: English.
- TDD: red test first, then impl, then green.
- Conventional Commits, one logical unit per commit. Never push without asking.
- Run gates before "done": `npm test` + `npm run typecheck` + `cd client && npm run typecheck`.
- `?? null` idiom for undefined→null. `import type` for type-only imports.

---

## File Structure

**Backend — create:**
- `src/db/migrations/009-pioneer-anthropic-dedup.ts` — dedup the 64 leaked rows.
- `src/db/migrations/010-model-context-output.ts` — additive `context_output` column.

**Backend — modify:**
- `src/db/migrations/index.ts` — register migrations 009 + 010.
- `src/providers/pioneer/models.ts` — strip `anthropic/pioneer/` before dedup; seed
  `context_output`.
- `src/db/repos/models.ts` — add `context_output` to `Model` type + `upsertModel` INSERT.
- `src/api/admin/models.ts` — new routes: `fetch/:provider`, `:name/refs`, `DELETE :name`,
  `PATCH :name`; extend list response with `contextOutput` + `comboCount`.

**Client — create:**
- `client/src/lib/providerPrefix.ts` — prefix map + `callName()`.

**Client — modify:**
- `client/src/components/models/types.ts` — add `contextOutput`, `comboCount` to `Model`;
  extend `AddModelForm` (no — Edit uses a separate form; leave AddModelForm as-is).
- `client/src/components/models/ProviderModelsSection.tsx` — add `provider` prop, new
  columns (ID/NAME/CONTEXT IN/CONTEXT OUT/Combo), Copy/Edit/Delete actions, conditional
  Fetch button.
- `client/src/pages/Models.tsx` — pass `provider` prop.
- `client/src/components/models/EditModelModal.tsx` (new) — edit modal for PATCH.

**Tests — create:**
- `src/providers/pioneer/models.test.ts` — seeder dedup case (new file).
- `src/db/migrations/009-pioneer-anthropic-dedup.test.ts` — migration cleans 139→75.
- `src/api/admin/models.partB.test.ts` is NOT this plan (Part B = console).
- `client/src/__tests__/ProviderModelsSection.test.tsx` (or extend existing client tests).

---

## Task 1: Seeder fix — strip `anthropic/pioneer/`

**Files:**
- Modify: `src/providers/pioneer/models.ts:59-71`
- Test: `src/providers/pioneer/models.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/providers/pioneer/models.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../db/index.js';
import { listModels } from '../../db/repos/models.js';
import { fetchAndSeedPioneerModels } from './models.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'pio-')), 't.db');
});
afterEach(() => vi.restoreAllMocks());

describe('fetchAndSeedPioneerModels', () => {
  it('dedups anthropic/pioneer/<id> duplicates against the canonical bare id', async () => {
    const db = openDb();
    // Upstream returns each id in TWO forms: bare + anthropic/pioneer/<bare>.
    const catalogue = {
      data: [
        { id: 'gpt-5.5', max_input_tokens: 1000, max_tokens: 500 },
        { id: 'anthropic/pioneer/gpt-5.5', max_input_tokens: 1000, max_tokens: 500 },
        { id: 'Qwen/Qwen3-32B', max_input_tokens: 2000, max_tokens: 800 },
        { id: 'anthropic/pioneer/Qwen/Qwen3-32B', max_input_tokens: 2000, max_tokens: 800 },
        { id: 'claude-opus-4-8', max_input_tokens: 3000, max_tokens: 1000 },
      ],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(catalogue), { status: 200 })
    );

    const result = await fetchAndSeedPioneerModels(db, 'pio_sk_test');

    expect(result.ok).toBe(true);
    const pioneer = listModels(db, { includeDisabled: true }).filter(
      (m) => m.provider === 'pioneer'
    );
    // 3 canonical ids, NOT 5.
    expect(pioneer).toHaveLength(3);
    const names = pioneer.map((m) => m.name).sort();
    expect(names).toEqual([
      'pioneer/Qwen/Qwen3-32B',
      'pioneer/claude-opus-4-8',
      'pioneer/gpt-5.5',
    ]);
    // upstream_model is the bare canonical id (no anthropic/pioneer/ leak).
    const gpt = pioneer.find((m) => m.name === 'pioneer/gpt-5.5')!;
    expect(gpt.upstream_model).toBe('gpt-5.5');
  });

  it('seeds context_output from max_tokens', async () => {
    const db = openDb();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: 'gpt-5.5', max_input_tokens: 1000, max_tokens: 4096 }],
        }),
        { status: 200 }
      )
    );
    await fetchAndSeedPioneerModels(db, 'pio_sk_test');
    const m = listModels(db, { includeDisabled: true }).find((x) => x.provider === 'pioneer')!;
    expect(m.context_window).toBe(1000);
    expect(m.context_output).toBe(4096);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/providers/pioneer/models.test.ts`
Expected: FAIL — first test expects 3 rows but gets 5 (seeder does not strip
`anthropic/pioneer/`); second test fails on `context_output` (column does not exist yet).
Note: the `context_output` column does not exist until Task 3. If the second test blocks,
run only the first: `npx vitest run src/providers/pioneer/models.test.ts -t "dedups"`.
Both pass after Tasks 1 + 3.

- [ ] **Step 3: Fix the seeder strip + dedup**

In `src/providers/pioneer/models.ts`, replace the bare-id computation (currently around
line 64):

```ts
// Before:
const bareId = m.id.replace(/^pioneer\//, '');
```

with:

```ts
// Strip BOTH a leading `anthropic/pioneer/` (Anthropic-API-compat alias form) and a
// leading `pioneer/` (self-namespaced form) so each model collapses to one canonical
// row. Without the `anthropic/pioneer/` strip the upstream catalogue seeds the same
// model twice (e.g. `gpt-5.5` + `anthropic/pioneer/gpt-5.5`) → 64 phantom rows.
const bareId = m.id.replace(/^anthropic\/pioneer\//, '').replace(/^pioneer\//, '');
```

- [ ] **Step 4: Commit (seeder strip only — context_output comes in Task 3)**

```bash
git add src/providers/pioneer/models.ts src/providers/pioneer/models.test.ts
git commit -m "fix(pioneer): strip anthropic/pioneer/ dup prefix in model seeder"
```

---

## Task 2: Migration 009 — dedup existing DB rows

**Files:**
- Create: `src/db/migrations/009-pioneer-anthropic-dedup.ts`
- Modify: `src/db/migrations/index.ts`
- Test: `src/db/migrations/index.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `src/db/migrations/index.test.ts` a new `describe` block (keep existing tests):

```ts
import { openDb as openDbForMigrations } from '../index.js';

describe('migration 009 pioneer anthropic dedup', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'm9-')), 't.db');
  });

  it('collapses pioneer/anthropic/pioneer/<x> dup rows onto canonical pioneer/<x>', () => {
    const db = openDbForMigrations();
    // Seed a dirty DB: a canonical row + its leaked dup, sharing canonical bare id.
    db.prepare(
      `INSERT INTO models (name, upstream_model, family, source, provider, enabled) VALUES (?, ?, ?, ?, ?, 1)`
    ).run('pioneer/gpt-5.5', 'gpt-5.5', 'pioneer', 'fetched', 'pioneer');
    db.prepare(
      `INSERT INTO models (name, upstream_model, family, source, provider, enabled) VALUES (?, ?, ?, ?, ?, 1)`
    ).run('pioneer/anthropic/pioneer/gpt-5.5', 'anthropic/pioneer/gpt-5.5', 'pioneer', 'fetched', 'pioneer');
    db.prepare(
      `INSERT INTO models (name, upstream_model, family, source, provider, enabled) VALUES (?, ?, ?, ?, ?, 1)`
    ).run('pioneer/claude-opus-4-8', 'claude-opus-4-8', 'pioneer', 'fetched', 'pioneer');

    // Re-run migrations (openDb applies all pending). user_version already >= 9 after
    // openDb on a fresh DB, so run the 009 SQL directly to test idempotency on a dirty DB.
    db.exec(migration_009.sql);

    const rows = db
      .prepare(`SELECT name, upstream_model FROM models WHERE provider = 'pioneer' ORDER BY name`)
      .all() as { name: string; upstream_model: string }[];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name).sort()).toEqual([
      'pioneer/claude-opus-4-8',
      'pioneer/gpt-5.5',
    ]);
    // No survivor carries an anthropic/pioneer/ upstream.
    expect(rows.every((r) => !r.upstream_model.startsWith('anthropic/pioneer/'))).toBe(true);
  });
});
```

Add the import at the top of the test file:

```ts
import { migration_009 } from './009-pioneer-anthropic-dedup.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/migrations/index.test.ts -t "migration 009"`
Expected: FAIL — `migration_009` is not exported (file does not exist yet).

- [ ] **Step 3: Create the migration file**

Create `src/db/migrations/009-pioneer-anthropic-dedup.ts`:

```ts
/**
 * Migration 009 — collapse Pioneer `anthropic/pioneer/<x>` duplicate rows.
 *
 * Background: the upstream `/v1/models` catalogue returns each model id in two forms —
 * a canonical bare id (`gpt-5.5`) AND an Anthropic-API-compat alias
 * (`anthropic/pioneer/gpt-5.5`). The old seeder only stripped a leading `pioneer/`, so
 * the alias entries leaked in as `name = 'pioneer/anthropic/pioneer/<x>'`,
 * `upstream_model = 'anthropic/pioneer/<x>'` — 64 phantom rows on a fresh Pioneer account.
 *
 * Algorithm: derive the canonical bare id by stripping a leading `anthropic/pioneer/`
 * from `upstream_model`. Partition by that canon; the survivor is the row whose
 * `upstream_model` is NOT prefixed with `anthropic/pioneer/` (the canonical). Delete
 * the rest. Survivors already carry canonical `name`/`upstream_model`, so no rewrite.
 *
 * Validated against a real dirty DB: 139 → 75 exact, 0 survivors with a leaked prefix.
 * Idempotent: a no-op once dedup is complete. `user_version = 9`.
 */
export const migration_009 = {
  id: 9,
  name: 'pioneer-anthropic-dedup',
  sql: [
    'CREATE TEMP TABLE _pio_canon AS',
    '  SELECT id, name, upstream_model,',
    '    CASE WHEN upstream_model LIKE ' + "'anthropic/pioneer/%'" + '',
    '         THEN substr(upstream_model, 19)',
    '         ELSE upstream_model',
    '    END AS canon',
    '  FROM models',
    "  WHERE provider = 'pioneer';",
    '',
    '-- Survivor per canon: prefer canonical upstream (no anthropic/pioneer/ prefix),',
    '-- ties by shortest name then lowest id.',
    'CREATE TEMP TABLE _pio_keep AS',
    '  SELECT canon, id AS keep_id FROM (',
    '    SELECT *,',
    '      row_number() OVER (',
    '        PARTITION BY canon',
    '        ORDER BY',
    '          CASE WHEN upstream_model LIKE ' + "'anthropic/pioneer/%'" + ' THEN 1 ELSE 0 END,',
    '          length(name) ASC,',
    '          id ASC',
    '      ) AS rn',
    '    FROM _pio_canon',
    '  ) WHERE rn = 1;',
    '',
    '-- Delete non-survivors only.',
    'DELETE FROM models',
    ' WHERE id IN (SELECT id FROM _pio_canon)',
    '   AND id NOT IN (SELECT keep_id FROM _pio_keep);',
    '',
    'DROP TABLE _pio_canon;',
    'DROP TABLE _pio_keep;',
  ].join('\n'),
};
```

> Note on the string concatenation: SQLite `LIKE 'anthropic/pioneer/%'` uses single
> quotes inside a `.ts` string joined by `+`. An equivalent cleaner form is a template
> literal with escaped quotes — use whichever Biome keeps readable. The functional
> requirement: the SQL string contains `substr(upstream_model, 19)` (length of
> `anthropic/pioneer/` is 18, so substr starts at char 19) and the LIKE patterns.

- [ ] **Step 4: Register the migration**

In `src/db/migrations/index.ts`:

```ts
import { migration_009 } from './009-pioneer-anthropic-dedup.js';

const ALL_MIGRATIONS: Array<{ id: number; name: string; sql: string }> = [
  // ... existing 001–008
  migration_009,
];
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/db/migrations/index.test.ts -t "migration 009"`
Expected: PASS — 2 rows remain, both canonical.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/009-pioneer-anthropic-dedup.ts src/db/migrations/index.ts src/db/migrations/index.test.ts
git commit -m "feat(db): migration 009 dedup pioneer anthropic/pioneer model rows"
```

---

## Task 3: Migration 010 — context_output column + repo wiring

**Files:**
- Create: `src/db/migrations/010-model-context-output.ts`
- Modify: `src/db/migrations/index.ts`
- Modify: `src/db/repos/models.ts` (Model type + upsertModel INSERT)
- Modify: `src/providers/pioneer/models.ts` (seed context_output)
- Test: `src/providers/pioneer/models.test.ts` (the context_output case from Task 1)

- [ ] **Step 1: Create the migration**

Create `src/db/migrations/010-model-context-output.ts`:

```ts
/**
 * Migration 010 — add `context_output` column to `models`.
 *
 * The catalogue distinguishes max input tokens (`context_window`, already seeded) from
 * the output token cap (`max_tokens`). The Models dashboard wants separate CONTEXT IN /
 * CONTEXT OUT columns. Additive ALTER only. `user_version = 10`.
 */
export const migration_010 = {
  id: 10,
  name: 'model-context-output',
  sql: `ALTER TABLE models ADD COLUMN context_output INTEGER;`,
};
```

- [ ] **Step 2: Register the migration**

In `src/db/migrations/index.ts`:

```ts
import { migration_010 } from './010-model-context-output.js';

const ALL_MIGRATIONS: Array<{ id: number; name: string; sql: string }> = [
  // ... 001–009
  migration_010,
];
```

- [ ] **Step 3: Extend the Model type + upsertModel**

In `src/db/repos/models.ts`, add `context_output` to the `Model` interface (after
`context_window`):

```ts
  context_window: number | null;
  context_output: number | null;
```

Update `upsertModel`'s INSERT branch to include the new column. Replace the INSERT
statement:

```ts
    db.prepare(`
      INSERT INTO models (name, upstream_model, display_name, family, context_window, context_output,
                          pricing_input, pricing_output, pricing_cache_read, pricing_cache_write, pricing_tiers, capabilities, source, enabled, provider)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      m.name,
      m.upstream_model,
      m.display_name ?? null,
      m.family ?? null,
      m.context_window ?? null,
      m.context_output ?? null,
      m.pricing_input ?? null,
      m.pricing_output ?? null,
      m.pricing_cache_read ?? null,
      m.pricing_cache_write ?? null,
      m.pricing_tiers ?? null,
      m.capabilities ?? null,
      m.source ?? 'manual',
      m.enabled === 0 ? 0 : 1,
      m.provider ?? 'minimax'
    );
```

(The UPDATE branch already iterates over `Object.keys(m)`, so it picks up
`context_output` automatically — no change there.)

- [ ] **Step 4: Seed context_output in the Pioneer seeder**

In `src/providers/pioneer/models.ts`, update the `upsertModel(db, {...})` call (currently
around line 74). Add `context_output` from `m.max_tokens`:

```ts
    upsertModel(db, {
      name,
      upstream_model: upstream,
      display_name: `Pioneer ${m.display_name?.trim() || bareId}`,
      family: 'pioneer',
      context_window: m.max_input_tokens ?? null,
      context_output: m.max_tokens ?? null,
      pricing_input: 0,
      pricing_output: 0,
      pricing_cache_read: 0,
      pricing_cache_write: 0,
      source: 'fetched',
      provider: 'pioneer',
    });
```

Also extend the `PioneerModelEntry` interface at the top of the file to include
`max_tokens`:

```ts
interface PioneerModelEntry {
  id: string;
  display_name?: string | null;
  max_input_tokens?: number | null;
  max_tokens?: number | null;
}
```

- [ ] **Step 5: Run the seeder tests (both now pass)**

Run: `npx vitest run src/providers/pioneer/models.test.ts`
Expected: PASS — dedup case yields 3 rows; context_output case yields 4096.

- [ ] **Step 6: Run full server suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS (no regressions; the `Model` type change may surface type errors in
callers that construct `ModelUpsert` — fix by leaving `context_output` optional via
`Partial<Model>`; it already is, since `ModelUpsert = Pick<...> & Partial<Model>`).

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations/010-model-context-output.ts src/db/migrations/index.ts src/db/repos/models.ts src/providers/pioneer/models.ts
git commit -m "feat(models): add context_output column + seed from pioneer max_tokens"
```

---

## Task 4: Endpoint — `POST /api/admin/models/fetch/:provider`

**Files:**
- Modify: `src/api/admin/models.ts` (replace the placeholder `/fetch` route)
- Test: `src/api/admin/models.fetch.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/api/admin/models.fetch.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../db/index.js';
import { createAccount } from '../../db/repos/accounts.js';
import { app, resetDb } from '../../server.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'mf-')), 't.db');
  process.env.ROUTER_ADMIN_KEY = 'ak_test';
  resetDb();
});

describe('POST /api/admin/models/fetch/:provider', () => {
  it('seeds minimax models from the first active minimax account', async () => {
    const db = openDb();
    createAccount(db, {
      id: 'acc_mm',
      label: 'MM',
      credit_type: 'payg',
      api_key: 'mm_k',
      provider: 'minimax',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'MiniMax-M3' }] }), { status: 200 })
    );
    const res = await app.request('/api/admin/models/fetch/minimax', {
      method: 'POST',
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { added: number; total: number };
    expect(body.added).toBe(1);
  });

  it('seeds pioneer models (deduped) from the first active pioneer account', async () => {
    const db = openDb();
    createAccount(db, {
      id: 'acc_pio',
      label: 'PIO',
      credit_type: 'payg',
      api_key: 'pio_sk_test',
      provider: 'pioneer',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: 'gpt-5.5', max_input_tokens: 1000, max_tokens: 500 },
            { id: 'anthropic/pioneer/gpt-5.5', max_input_tokens: 1000, max_tokens: 500 },
          ],
        }),
        { status: 200 }
      )
    );
    const res = await app.request('/api/admin/models/fetch/pioneer', {
      method: 'POST',
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { added: number; total: number };
    expect(body.total).toBe(1); // deduped
  });

  it('returns 404 for a provider without a model-list endpoint', async () => {
    const res = await app.request('/api/admin/models/fetch/kiro', {
      method: 'POST',
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when no active account exists for the provider', async () => {
    const res = await app.request('/api/admin/models/fetch/minimax', {
      method: 'POST',
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/admin/models.fetch.test.ts`
Expected: FAIL — route `/api/admin/models/fetch/:provider` does not exist (404 for all
cases).

- [ ] **Step 3: Implement the route**

In `src/api/admin/models.ts`, replace the placeholder `modelRoutes.post('/fetch', ...)`
block (currently lines 133–142) with a parameterized route. Add imports at the top:

```ts
import { fetchModels } from '../../providers/listModels.js';
import { fetchAndSeedPioneerModels } from '../../providers/pioneer/models.js';
import { listEnabledAccountsByProvider } from '../../db/repos/accounts.js';
```

Replace the `/fetch` route:

```ts
const FETCH_PROVIDERS = ['minimax', 'pioneer'] as const;
type FetchProvider = (typeof FETCH_PROVIDERS)[number];

modelRoutes.post('/fetch/:provider', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const provider = c.req.param('provider');
    if (!(FETCH_PROVIDERS as readonly string[]).includes(provider)) {
      return c.json(
        { error: 'no_upstream_list', message: `${provider} has no model-list endpoint` },
        404
      );
    }
    const p = provider as FetchProvider;
    const accounts = listEnabledAccountsByProvider(db, p);
    const first = accounts[0];
    if (!first) {
      return c.json(
        { error: 'no_account', message: `no active ${p} account to fetch from` },
        400
      );
    }

    if (p === 'minimax') {
      const result = await fetchModels(db, first.api_key);
      if (!result.ok) {
        return c.json({ error: 'fetch_failed', message: result.error ?? 'upstream error' }, 502);
      }
      const total = listModels(db).length;
      return c.json({ added: result.added ?? 0, total });
    }
    // pioneer
    const result = await fetchAndSeedPioneerModels(db, first.api_key, first.base_url);
    if (!result.ok) {
      return c.json({ error: 'fetch_failed', message: result.error ?? 'upstream error' }, 502);
    }
    return c.json({ added: result.added ?? 0, total: result.total ?? 0 });
  } catch (e) {
    return handleApiError(e);
  }
});
```

Note: `listModels` is already imported in `models.ts`. `first.base_url` is nullable;
`fetchAndSeedPioneerModels` already accepts `baseUrl?: string | null`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/admin/models.fetch.test.ts`
Expected: PASS — all four cases.

- [ ] **Step 5: Commit**

```bash
git add src/api/admin/models.ts src/api/admin/models.fetch.test.ts
git commit -m "feat(api): per-provider POST /api/admin/models/fetch/:provider"
```

---

## Task 5: Endpoint — `GET /api/admin/models/:name/refs` + `DELETE`

**Files:**
- Modify: `src/api/admin/models.ts`
- Test: `src/api/admin/models.refs.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/api/admin/models.refs.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../db/index.js';
import { upsertAlias } from '../../db/repos/aliases.js';
import { createCombo } from '../../db/repos/combos.js';
import { upsertModel } from '../../db/repos/models.js';
import { app, resetDb } from '../../server.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'mr-')), 't.db');
  process.env.ROUTER_ADMIN_KEY = 'ak_test';
  resetDb();
});

describe('GET /api/admin/models/:name/refs', () => {
  it('lists aliases + combos referencing the model', async () => {
    const db = openDb();
    upsertModel(db, {
      name: 'pioneer/claude-opus-4-8',
      upstream_model: 'claude-opus-4-8',
      provider: 'pioneer',
      source: 'fetched',
    });
    upsertAlias(db, { aliasName: 'opus', upstreamModel: 'claude-opus-4-8' });
    createCombo(db, 'fast', ['pioneer/claude-opus-4-8']);

    const res = await app.request(
      '/api/admin/models/pioneer%2Fclaude-opus-4-8/refs',
      { headers: { 'x-admin-key': 'ak_test' } }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      aliases: { aliasName: string }[];
      combos: { id: string; comboName: string }[];
    };
    expect(body.aliases.map((a) => a.aliasName)).toEqual(['opus']);
    expect(body.combos.map((c) => c.comboName)).toEqual(['fast']);
  });

  it('returns 404 when the model does not exist', async () => {
    const res = await app.request('/api/admin/models/pioneer%2Fnope/refs', {
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/models/:name', () => {
  it('deletes an unreferenced model', async () => {
    const db = openDb();
    upsertModel(db, {
      name: 'pioneer/lonely',
      upstream_model: 'lonely',
      provider: 'pioneer',
      source: 'fetched',
    });
    const res = await app.request('/api/admin/models/pioneer%2Flonely', {
      method: 'DELETE',
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(200);
  });

  it('blocks delete with 409 when an alias references it', async () => {
    const db = openDb();
    upsertModel(db, {
      name: 'pioneer/gpt-5.5',
      upstream_model: 'gpt-5.5',
      provider: 'pioneer',
      source: 'fetched',
    });
    upsertAlias(db, { aliasName: 'gpt', upstreamModel: 'gpt-5.5' });
    const res = await app.request('/api/admin/models/pioneer%2Fgpt-5.5', {
      method: 'DELETE',
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; refs: { aliases: unknown[] } };
    expect(body.error).toBe('has_refs');
    expect(body.refs.aliases).toHaveLength(1);
  });

  it('blocks delete with 409 when a combo references it', async () => {
    const db = openDb();
    upsertModel(db, {
      name: 'pioneer/cb',
      upstream_model: 'cb',
      provider: 'pioneer',
      source: 'fetched',
    });
    createCombo(db, 'chain', ['pioneer/cb']);
    const res = await app.request('/api/admin/models/pioneer%2Fcb', {
      method: 'DELETE',
      headers: { 'x-admin-key': 'ak_test' },
    });
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/admin/models.refs.test.ts`
Expected: FAIL — routes do not exist.

- [ ] **Step 3: Add a repo helper for refs**

In `src/db/repos/models.ts`, append a `deleteModel` + reuse existing alias/combo repos.
Add at the end of the file:

```ts
export function deleteModel(db: Database.Database, name: string): boolean {
  const r = db.prepare(`DELETE FROM models WHERE name = ?`).run(name);
  return r.changes > 0;
}
```

> Alias refs come from `model_aliases` (target = `upstream_model`). Combo refs come from
> parsing `combos.models` JSON. Do NOT put those joins in the models repo (keeps the
> repo single-purpose) — resolve them in the route handler using the existing
> `listAliasesForTargets` and `listCombos` repos.

- [ ] **Step 4: Implement the refs + delete routes**

In `src/api/admin/models.ts`, add imports:

```ts
import { listCombos } from '../../db/repos/combos.js';
import { deleteModel } from '../../db/repos/models.js';
import { listAliasesForTargets } from '../../db/repos/aliases.js';
```

Add the routes (place before the `/bulk-toggle` route, after the existing `/:name/test`):

```ts
modelRoutes.get('/:name/refs', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const name = decodeURIComponent(c.req.param('name'));
    const model = getModel(db, name);
    if (!model) return c.json({ error: 'not_found', message: 'Model tidak ditemukan' }, 404);

    // Alias refs target upstream_model (not models.name).
    const aliases = (listAliasesForTargets(db, [model.upstream_model])[model.upstream_model] ?? []).map(
      (a) => ({ aliasName: a.aliasName })
    );

    // Combo refs: combos.models is a JSON array of member names; match by models.name.
    const combos = listCombos(db)
      .filter((combo) => combo.models.includes(name))
      .map((combo) => ({ id: combo.id, comboName: combo.name }));

    return c.json({ aliases, combos });
  } catch (e) {
    return handleApiError(e);
  }
});

modelRoutes.delete('/:name', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const name = decodeURIComponent(c.req.param('name'));
    const model = getModel(db, name);
    if (!model) return c.json({ error: 'not_found', message: 'Model tidak ditemukan' }, 404);

    const aliases = (listAliasesForTargets(db, [model.upstream_model])[model.upstream_model] ?? []).map(
      (a) => ({ aliasName: a.aliasName })
    );
    const combos = listCombos(db)
      .filter((combo) => combo.models.includes(name))
      .map((combo) => ({ id: combo.id, comboName: combo.name }));

    if (aliases.length > 0 || combos.length > 0) {
      return c.json({ error: 'has_refs', refs: { aliases, combos } }, 409);
    }
    deleteModel(db, name);
    return c.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
});
```

> `/:name/refs` is a GET, so the `:name/test` / `:name/enable` POST routes are unaffected
> by route ordering. Hono matches the static segments; GET `/:name/refs` does not clash
> with POST `/:name/test`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/api/admin/models.refs.test.ts`
Expected: PASS — all five cases.

- [ ] **Step 6: Commit**

```bash
git add src/api/admin/models.ts src/db/repos/models.ts src/api/admin/models.refs.test.ts
git commit -m "feat(api): GET /api/admin/models/:name/refs + DELETE with refs safety"
```

---

## Task 6: Endpoint — `PATCH /api/admin/models/:name` + list response fields

**Files:**
- Modify: `src/api/admin/models.ts` (PATCH route; extend list response with
  `contextOutput` + `comboCount`)
- Modify: `src/db/repos/models.ts` (add `updateModel`)
- Test: `src/api/admin/models.patch.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/api/admin/models.patch.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../db/index.js';
import { getModel, upsertModel } from '../../db/repos/models.js';
import { app, resetDb } from '../../server.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'mp-')), 't.db');
  process.env.ROUTER_ADMIN_KEY = 'ak_test';
  resetDb();
});

describe('PATCH /api/admin/models/:name', () => {
  it('updates editable fields, leaves name + upstream_model immutable', async () => {
    const db = openDb();
    upsertModel(db, {
      name: 'pioneer/gpt-5.5',
      upstream_model: 'gpt-5.5',
      provider: 'pioneer',
      source: 'fetched',
      pricing_input: 1,
    });
    const res = await app.request('/api/admin/models/pioneer%2Fgpt-5.5', {
      method: 'PATCH',
      headers: { 'x-admin-key': 'ak_test', 'content-type': 'application/json' },
      body: JSON.stringify({ pricingInput: 5, contextOutput: 8192, displayName: 'GPT 5.5' }),
    });
    expect(res.status).toBe(200);
    const m = getModel(db, 'pioneer/gpt-5.5')!;
    expect(m.pricing_input).toBe(5);
    expect(m.context_output).toBe(8192);
    expect(m.display_name).toBe('GPT 5.5');
    expect(m.upstream_model).toBe('gpt-5.5'); // immutable
  });

  it('returns 404 when the model does not exist', async () => {
    const res = await app.request('/api/admin/models/pioneer%2Fnope', {
      method: 'PATCH',
      headers: { 'x-admin-key': 'ak_test', 'content-type': 'application/json' },
      body: JSON.stringify({ pricingInput: 5 }),
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/admin/models list response', () => {
  it('includes contextOutput and comboCount per model', async () => {
    const res = await app.request('/api/admin/models', { headers: { 'x-admin-key': 'ak_test' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    if (body.length > 0) {
      expect(body[0]).toHaveProperty('contextOutput');
      expect(body[0]).toHaveProperty('comboCount');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/admin/models.patch.test.ts`
Expected: FAIL — PATCH route + response fields absent.

- [ ] **Step 3: Add `updateModel` repo helper**

In `src/db/repos/models.ts`, append:

```ts
export interface ModelUpdate {
  displayName?: string | null;
  contextWindow?: number | null;
  contextOutput?: number | null;
  pricingInput?: number | null;
  pricingOutput?: number | null;
}

export function updateModel(db: Database.Database, name: string, patch: ModelUpdate): boolean {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.displayName !== undefined) {
    sets.push('display_name = ?');
    vals.push(patch.displayName);
  }
  if (patch.contextWindow !== undefined) {
    sets.push('context_window = ?');
    vals.push(patch.contextWindow);
  }
  if (patch.contextOutput !== undefined) {
    sets.push('context_output = ?');
    vals.push(patch.contextOutput);
  }
  if (patch.pricingInput !== undefined) {
    sets.push('pricing_input = ?');
    vals.push(patch.pricingInput);
  }
  if (patch.pricingOutput !== undefined) {
    sets.push('pricing_output = ?');
    vals.push(patch.pricingOutput);
  }
  if (sets.length === 0) return false;
  vals.push(name);
  const r = db.prepare(`UPDATE models SET ${sets.join(', ')} WHERE name = ?`).run(...vals);
  return r.changes > 0;
}
```

- [ ] **Step 4: Implement PATCH route + extend list response**

In `src/api/admin/models.ts`, add import:

```ts
import { getModel, listModels, updateModel, upsertModel } from '../../db/repos/models.js';
```

Add the PATCH route (after the refs/delete routes):

```ts
modelRoutes.patch('/:name', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const name = decodeURIComponent(c.req.param('name'));
    const model = getModel(db, name);
    if (!model) return c.json({ error: 'not_found', message: 'Model tidak ditemukan' }, 404);

    const body = await c.req.json<{
      displayName?: string | null;
      contextWindow?: number | null;
      contextOutput?: number | null;
      pricingInput?: number | null;
      pricingOutput?: number | null;
    }>();
    updateModel(db, name, {
      displayName: body.displayName,
      contextWindow: body.contextWindow,
      contextOutput: body.contextOutput,
      pricingInput: body.pricingInput,
      pricingOutput: body.pricingOutput,
    });
    return c.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
});
```

Extend the list response in `modelRoutes.get('/')` — compute combo membership counts.
Replace the existing list handler body with:

```ts
modelRoutes.get('/', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const rows = listModels(db, { includeDisabled: true });
    const targets = [...new Set(rows.map((r) => r.upstream_model))];
    const aliasesByTarget = listAliasesForTargets(db, targets);

    // Combo membership counts: combos.models is a JSON array of member names.
    const comboCountByName = new Map<string, number>();
    for (const combo of listCombos(db)) {
      for (const memberName of combo.models) {
        comboCountByName.set(memberName, (comboCountByName.get(memberName) ?? 0) + 1);
      }
    }

    return c.json(
      rows.map((m) => ({
        name: m.name,
        displayName: m.display_name,
        family: m.family,
        contextWindow: m.context_window,
        contextOutput: m.context_output,
        provider: m.provider ?? 'minimax',
        pricingInput: m.pricing_input,
        pricingOutput: m.pricing_output,
        source: m.source,
        enabled: !!m.enabled,
        aliasCount: (aliasesByTarget[m.upstream_model] ?? []).length,
        comboCount: comboCountByName.get(m.name) ?? 0,
      }))
    );
  } catch (e) {
    return handleApiError(e);
  }
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/api/admin/models.patch.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full server suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. Fix any type errors from the `getModel`/`listModels`/`upsertModel`
duplicate imports (the file already imports these — merge into one import statement).

- [ ] **Step 7: Commit**

```bash
git add src/api/admin/models.ts src/db/repos/models.ts src/api/admin/models.patch.test.ts
git commit -m "feat(api): PATCH /api/admin/models/:name + contextOutput/comboCount in list"
```

---

## Task 7: Client — providerPrefix lib + Model type

**Files:**
- Create: `client/src/lib/providerPrefix.ts`
- Modify: `client/src/components/models/types.ts`

- [ ] **Step 1: Create the prefix lib**

Create `client/src/lib/providerPrefix.ts`:

```ts
// Client-side mirror of the server's PREFIX_TO_PROVIDER map
// (src/providers/modelPrefix.ts). Keep in sync when a provider is added.

export const PREFIX_BY_PROVIDER: Record<string, string> = {
  minimax: 'mx',
  kiro: 'kr',
  codebuddy: 'cb',
  pioneer: 'pio',
  notion: 'nt',
};

/** Providers whose upstream exposes a /v1/models list endpoint. */
export const PROVIDERS_WITH_UPSTREAM_LIST = new Set(['minimax', 'pioneer']);

/**
 * Client call string for a model row, e.g. `pio/claude-opus-4-8`.
 * Pioneer rows are namespaced `pioneer/<id>` in the DB; strip the namespace once.
 */
export function callName(provider: string, dbName: string): string {
  const prefix = PREFIX_BY_PROVIDER[provider];
  if (!prefix) return dbName;
  const bare = provider === 'pioneer' ? dbName.replace(/^pioneer\//, '') : dbName;
  return `${prefix}/${bare}`;
}
```

- [ ] **Step 2: Extend the client Model type**

In `client/src/components/models/types.ts`, add the two new fields:

```ts
export interface Model {
  name: string;
  displayName: string | null;
  family: string | null;
  contextWindow: number | null;
  contextOutput: number | null;
  comboCount: number;
  provider: string;
  pricingInput: number | null;
  pricingOutput: number | null;
  source: string;
  enabled: boolean;
  aliasCount: number;
}
```

- [ ] **Step 3: Typecheck the client**

Run: `cd client && npm run typecheck`
Expected: PASS (no new errors; the added fields are read in Task 8).

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/providerPrefix.ts client/src/components/models/types.ts
git commit -m "feat(client): providerPrefix lib + contextOutput/comboCount on Model"
```

---

## Task 8: Client — ProviderModelsSection columns + actions

**Files:**
- Modify: `client/src/components/models/ProviderModelsSection.tsx`
- Modify: `client/src/pages/Models.tsx` (pass `provider`)

- [ ] **Step 1: Rewrite the section component**

Replace `client/src/components/models/ProviderModelsSection.tsx` contents. Key changes:
`provider` prop; columns ID/NAME/CONTEXT IN/CONTEXT OUT/In/Out/Aliases/Combo/Status;
Copy/Edit/Delete actions; conditional Fetch button.

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { apiFetch } from '../../lib/api';
import { callName, PROVIDERS_WITH_UPSTREAM_LIST } from '../../lib/providerPrefix';
import { Button } from '../Button';
import { Card } from '../Card';
import { confirmDialog } from '../Confirm';
import { Switch } from '../Switch';
import { useToast } from '../ToastProvider';
import type { Provider } from './types';
import { fmtContext, fmtPrice, type Model, type TestState } from './types';

interface ProviderModelsSectionProps {
  title: string;
  provider: Provider;
  models: Model[];
  selected: Set<string>;
  onSelectChange: (next: Set<string>) => void;
  shadowedNames: Set<string>;
  onAddModel: () => void;
  onEditModel: (model: Model) => void;
}

export function ProviderModelsSection({
  title,
  provider,
  models,
  selected,
  onSelectChange,
  shadowedNames,
  onAddModel,
  onEditModel,
}: ProviderModelsSectionProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const [testResults, setTestResults] = useState<Record<string, TestState>>({});

  const runTest = async (name: string) => {
    setTestResults((r) => ({ ...r, [name]: { state: 'loading' } }));
    try {
      const res = await apiFetch<{ ok: boolean; latencyMs: number; error?: string }>(
        `/api/admin/models/${encodeURIComponent(name)}/test`,
        { method: 'POST' }
      );
      setTestResults((r) => ({
        ...r,
        [name]: res.ok
          ? { state: 'ok', ms: res.latencyMs }
          : { state: 'fail', error: res.error ?? 'failed' },
      }));
    } catch (e) {
      setTestResults((r) => ({ ...r, [name]: { state: 'fail', error: (e as Error).message } }));
    }
  };

  const toggleMut = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      apiFetch(`/api/admin/models/${encodeURIComponent(name)}/${enabled ? 'disable' : 'enable'}`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['models'] });
      toast.success('Updated');
    },
    onError: (e: Error) => toast.error(e.message || 'Toggle failed'),
  });

  const fetchMut = useMutation({
    mutationFn: () =>
      apiFetch<{ added: number; total: number }>(
        `/api/admin/models/fetch/${provider}`,
        { method: 'POST' }
      ),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['models'] });
      toast.success(`Fetched (${r.total} total)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copyCallName = async (m: Model) => {
    const text = callName(provider, m.name);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    toast.success(`Copied ${text}`);
  };

  const deleteMut = useMutation({
    mutationFn: (name: string) =>
      apiFetch(`/api/admin/models/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['models'] });
      toast.success('Model deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onDelete = async (m: Model) => {
    let refs: { aliases: { aliasName: string }[]; combos: { comboName: string }[] };
    try {
      refs = await apiFetch(`/api/admin/models/${encodeURIComponent(m.name)}/refs`);
    } catch (e) {
      toast.error((e as Error).message);
      return;
    }
    if (refs.aliases.length > 0 || refs.combos.length > 0) {
      const aliasList = refs.aliases.map((a) => a.aliasName).join(', ');
      const comboList = refs.combos.map((c) => c.comboName).join(', ');
      toast.error(
        `Blocked: referenced by alias [${aliasList}] / combo [${comboList}]. Remove them first.`
      );
      return;
    }
    const ok = await confirmDialog({
      title: 'Delete model',
      message: `Delete "${m.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    deleteMut.mutate(m.name);
  };

  const canFetch = PROVIDERS_WITH_UPSTREAM_LIST.has(provider);

  return (
    <Card
      title={title}
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          {canFetch && (
            <Button size="sm" onClick={() => fetchMut.mutate()} disabled={fetchMut.isPending}>
              {fetchMut.isPending ? 'Fetching…' : 'Fetch from upstream'}
            </Button>
          )}
          <Button size="sm" onClick={onAddModel}>
            + Add model
          </Button>
        </div>
      }
    >
      {models.length === 0 ? (
        <p class="card-sub">No {title} models.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table class="tbl">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    checked={models.length > 0 && models.every((m) => selected.has(m.name))}
                    onChange={() => {
                      if (models.every((m) => selected.has(m.name))) {
                        const next = new Set(selected);
                        models.forEach((m) => next.delete(m.name));
                        onSelectChange(next);
                      } else {
                        const next = new Set(selected);
                        models.forEach((m) => next.add(m.name));
                        onSelectChange(next);
                      }
                    }}
                  />
                </th>
                <th>ID</th>
                <th>Name</th>
                <th>Context In</th>
                <th>Context Out</th>
                <th class="num">In $/M</th>
                <th class="num">Out $/M</th>
                <th>Aliases</th>
                <th>Combo</th>
                <th>Status</th>
                <th>Test</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.name}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(m.name)}
                      onChange={() => {
                        const next = new Set(selected);
                        if (next.has(m.name)) next.delete(m.name);
                        else next.add(m.name);
                        onSelectChange(next);
                      }}
                    />
                  </td>
                  <td class="mono">
                    {callName(provider, m.name)}
                    {shadowedNames.has(m.name) && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 9,
                          color: 'var(--gold, #c9a352)',
                          fontFamily: 'var(--font-body, inherit)',
                        }}
                      >
                        ⚡ shadowed
                      </span>
                    )}
                  </td>
                  <td>{m.displayName ?? m.name}</td>
                  <td class="mono">{fmtContext(m.contextWindow)}</td>
                  <td class="mono">{fmtContext(m.contextOutput)}</td>
                  <td class="num mono">{fmtPrice(m.pricingInput)}</td>
                  <td class="num mono">{fmtPrice(m.pricingOutput)}</td>
                  <td>
                    {m.aliasCount > 0 ? (
                      <a href={`#/admin/aliases?target=${encodeURIComponent(m.name)}`}>
                        {m.aliasCount} alias{m.aliasCount === 1 ? '' : 'es'}
                      </a>
                    ) : (
                      <span class="card-sub">—</span>
                    )}
                  </td>
                  <td>
                    {m.comboCount > 0 ? (
                      <a href={`#/admin/combos`}>
                        {m.comboCount} combo{m.comboCount === 1 ? '' : 's'}
                      </a>
                    ) : (
                      <span class="card-sub">—</span>
                    )}
                  </td>
                  <td>
                    <Switch
                      checked={m.enabled}
                      onChange={async () => {
                        if (m.enabled) {
                          const ok = await confirmDialog({
                            title: 'Disable model',
                            message: `Disable "${m.name}"? Clients using this model will get 404.`,
                            confirmLabel: 'Disable',
                            danger: true,
                          });
                          if (!ok) return;
                        }
                        toggleMut.mutate({ name: m.name, enabled: m.enabled });
                      }}
                      label={m.enabled ? 'on' : 'off'}
                    />
                  </td>
                  <td>
                    {(() => {
                      const t = testResults[m.name];
                      if (t?.state === 'loading')
                        return (
                          <span class="mono" style={{ fontSize: 11 }}>
                            …
                          </span>
                        );
                      if (t?.state === 'ok')
                        return (
                          <span class="mono" style={{ fontSize: 11, color: 'var(--signal)' }}>
                            ✓ {t.ms}ms
                          </span>
                        );
                      if (t?.state === 'fail')
                        return (
                          <span class="mono" style={{ fontSize: 11, color: 'var(--alert)' }} title={t.error}>
                            ✗ {t.error.slice(0, 24)}
                          </span>
                        );
                      return (
                        <Button size="sm" variant="ghost" onClick={() => runTest(m.name)}>
                          Test
                        </Button>
                      );
                    })()}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <Button size="sm" variant="ghost" onClick={() => copyCallName(m)}>
                        Copy
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onEditModel(m)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => onDelete(m)}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Pass `provider` from Models.tsx**

In `client/src/pages/Models.tsx`, add a state holder for the edit modal and pass the new
props. The edit modal itself is added in Task 9; here wire the props and a placeholder
`onEditModel`:

At the top of the `Models` component, after the existing `addOpen` state, add:

```ts
  const [editTarget, setEditTarget] = useState<Model | null>(null);
```

Update each `<ProviderModelsSection>` call to pass `provider` and `onEditModel`. Example
for the MiniMax card (apply to all four):

```tsx
          <ProviderModelsSection
            title="MiniMax"
            provider="minimax"
            models={filtered.filter((m) => m.provider === 'minimax')}
            selected={selected}
            onSelectChange={setSelected}
            shadowedNames={shadowedNames}
            onAddModel={() => setAddOpen('minimax')}
            onEditModel={(m) => setEditTarget(m)}
          />
```

Repeat for Kiro (`provider="kiro"`), Pioneer (`provider="pioneer"`), CodeBuddy
(`provider="codebuddy"`).

Import `Model` type at the top if not present:

```ts
import type { Model, Provider } from '../components/models/types';
```

- [ ] **Step 3: Typecheck the client**

Run: `cd client && npm run typecheck`
Expected: PASS (the `editTarget` state is consumed in Task 9; unused-var lint may warn —
Task 9 wires the modal. If the lint blocks, temporarily prefix with `// biome-ignore` or
land Task 9 in the same commit).

> To avoid a broken intermediate commit, combine Step 2 of this task with Task 9 into a
> single commit if the typecheck fails on `editTarget` unused.

- [ ] **Step 4: Commit (with Task 9 — see below)**

---

## Task 9: Client — EditModelModal

**Files:**
- Create: `client/src/components/models/EditModelModal.tsx`
- Modify: `client/src/pages/Models.tsx` (render the modal)

- [ ] **Step 1: Create the edit modal**

Create `client/src/components/models/EditModelModal.tsx`:

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { apiFetch } from '../../lib/api';
import { Button } from '../Button';
import { Modal } from '../Modal';
import { useToast } from '../ToastProvider';
import type { Model } from './types';

interface EditModelModalProps {
  model: Model | null;
  onClose: () => void;
}

export function EditModelModal({ model, onClose }: EditModelModalProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(model?.displayName ?? '');
  const [contextWindow, setContextWindow] = useState(
    model?.contextWindow != null ? String(model.contextWindow) : ''
  );
  const [contextOutput, setContextOutput] = useState(
    model?.contextOutput != null ? String(model.contextOutput) : ''
  );
  const [pricingInput, setPricingInput] = useState(
    model?.pricingInput != null ? String(model.pricingInput) : ''
  );
  const [pricingOutput, setPricingOutput] = useState(
    model?.pricingOutput != null ? String(model.pricingOutput) : ''
  );

  const editMut = useMutation({
    mutationFn: () => {
      if (!model) throw new Error('no model');
      return apiFetch(`/api/admin/models/${encodeURIComponent(model.name)}`, {
        method: 'PATCH',
        json: {
          displayName: displayName.trim() || null,
          contextWindow: contextWindow ? Number(contextWindow) : null,
          contextOutput: contextOutput ? Number(contextOutput) : null,
          pricingInput: pricingInput ? Number(pricingInput) : null,
          pricingOutput: pricingOutput ? Number(pricingOutput) : null,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['models'] });
      toast.success('Model updated');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!model) return null;

  return (
    <Modal open={model !== null} onClose={onClose} title={`Edit ${model.name}`} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => editMut.mutate()} disabled={editMut.isPending}>
          {editMut.isPending ? 'Saving…' : 'Save'}
        </Button>
      </>
    }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label>
          Display name
          <input class="input" value={displayName} onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)} />
        </label>
        <label>
          Context window (in)
          <input class="input" type="number" value={contextWindow} onInput={(e) => setContextWindow((e.target as HTMLInputElement).value)} />
        </label>
        <label>
          Context output (out)
          <input class="input" type="number" value={contextOutput} onInput={(e) => setContextOutput((e.target as HTMLInputElement).value)} />
        </label>
        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ flex: 1 }}>
            Pricing in $/M
            <input class="input" type="number" value={pricingInput} onInput={(e) => setPricingInput((e.target as HTMLInputElement).value)} />
          </label>
          <label style={{ flex: 1 }}>
            Pricing out $/M
            <input class="input" type="number" value={pricingOutput} onInput={(e) => setPricingOutput((e.target as HTMLInputElement).value)} />
          </label>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Render the modal in Models.tsx**

In `client/src/pages/Models.tsx`, add the import and render at the bottom (next to
`AddModelModal`):

```ts
import { EditModelModal } from '../components/models/EditModelModal';
```

Near the existing `<AddModelModal … />` at the end of the component:

```tsx
      <EditModelModal model={editTarget} onClose={() => setEditTarget(null)} />
```

- [ ] **Step 3: Typecheck + lint**

Run: `cd client && npm run typecheck && cd .. && npm run lint:fix`
Expected: PASS.

- [ ] **Step 4: Run client tests**

Run: `cd client && npm test`
Expected: PASS (existing tests; new components have no dedicated test — covered by the
manual smoke in Task 10. If a snapshot/render test breaks on the column change, update it).

- [ ] **Step 5: Commit (Tasks 8 + 9 together to avoid broken intermediate)**

```bash
git add client/src/components/models/ProviderModelsSection.tsx client/src/components/models/EditModelModal.tsx client/src/pages/Models.tsx
git commit -m "feat(client): models table prefix display + copy/edit/delete + per-card fetch"
```

---

## Task 10: Full verification + docs sync

- [ ] **Step 1: Run all gates**

Run: `npm test && cd client && npm test && cd .. && npm run typecheck && cd client && npm run typecheck && cd .. && npm run lint`
Expected: PASS with zero warnings.

- [ ] **Step 2: Manual smoke (dev server)**

Run: `npm run dev` (server :20137 + client :5173).
- Open `/admin/models`. Confirm each card shows ID (`mx/…`, `pio/…`), separate
  Context In/Out, Combo count, Copy/Edit/Delete buttons.
- Confirm Fetch button shows only on MiniMax + Pioneer cards.
- Add a Pioneer account; confirm the seeder yields ~75 (not 139).
- Copy a row → paste elsewhere → confirm `pio/<id>`.
- Edit a row → change price → reload → confirm persisted.
- Delete an unreferenced model → confirm gone. Delete a referenced one → confirm blocked
  toast naming the alias/combo.

- [ ] **Step 3: Sync docs (optional follow-up)**

If `AGENTS.md` / `docs/guides/add-a-provider.md` mention the old `/admin/models/fetch`
shape or the 139 count, update them. Use the `sync-docs` skill for the audit.

- [ ] **Step 4: Final commit (docs only, if changed)**

```bash
git add -A
git commit -m "docs: sync models page endpoint + pioneer seed count"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** Part A — seeder (T1), migration 009 (T2), migration 010 + repo
  (T3), fetch endpoint (T4), refs + delete (T5), patch + list fields (T6), client lib +
  type (T7), table + actions (T8), edit modal (T9), verification (T10). All Part A
  spec sections covered.
- **Type consistency:** `Model.contextOutput` + `Model.comboCount` (client + server),
  `callName(provider, name)` used identically in section + modal. `updateModel` /
  `deleteModel` repo signatures match their route usage.
- **CSRF:** `csrfGuard` already covers PATCH + DELETE (non-GET). No middleware change.
- **No placeholders** in this plan.
