# User-Defined Model Aliases

**Date:** 2026-06-03
**Status:** Draft
**Scope:** DB-backed alias table + admin UI + proxy resolution + dead-code cleanup of the legacy `-thinking` constant.

## Problem

Clients (Claude Code, hermes-agent) often expect model names that differ from what MiniMax upstream exposes (e.g. `claude-opus-4-8` vs `MiniMax-M3`). Today the only aliasing mechanism is the hardcoded `LEGACY_MODEL_ALIASES` constant in `src/providers/alias.ts:27-30`, which holds two `-thinking` entries that are now dead (the `-thinking` seed rows were dropped in `432988f` and `35084cd`). There is no way for the admin to add or edit aliases without editing source code and rebuilding.

User intent: admins can define `claude-opus-4-8 → MiniMax-M3` (and any other mapping) from the dashboard, and the proxy resolves them transparently.

## Goals

1. New `model_aliases` table stores user-defined name → upstream-model mappings.
2. `resolveModel` consults the alias table before looking up the model; resolution is one-way (alias → real model) and is invisible to upstream (`account_model_locks`, `request_logs.model`).
3. New `Aliases` admin page with create/edit/delete UI; existing `Models` page shows an alias-count badge per model linking to the new page.
4. `request_logs.requested_model` column preserves the client-requested name for analytics (separate from the resolved `model` column).
5. `LEGACY_MODEL_ALIASES` constant + `warnLegacyOnce` removed (dead code).
6. Tests cover CRUD, resolution, cache invalidation, proxy end-to-end, lock-transparency, and migration safety.

## Non-Goals

- `/v1/models` proxying local catalog (out of scope; current behavior — proxies upstream — preserved).
- Per-account or per-client-key alias scoping (global aliases only).
- Wildcard / regex alias patterns (YAGNI; do exact match).
- Audit log of alias changes.
- Bulk import / export of alias lists.
- Aliases that shadow real model names (rejected; conflict policy below).

## Design

### Schema (migration `007-model-aliases`)

```sql
CREATE TABLE IF NOT EXISTS model_aliases (
  alias_name      TEXT PRIMARY KEY,
  upstream_model  TEXT NOT NULL,
  label           TEXT,
  source          TEXT NOT NULL DEFAULT 'user',  -- 'user' (future: 'legacy-seed', 'preset', 'import')
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (upstream_model) REFERENCES models(upstream_model) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_model_aliases_target ON model_aliases(upstream_model);
```

```sql
ALTER TABLE request_logs ADD COLUMN requested_model TEXT;
```

- PK on `alias_name` enables UPSERT overwrite (chosen conflict policy).
- FK on `upstream_model` (not `name`) — alias points at upstream identity, stable across fetch-from-upstream refreshes.
- `ON DELETE CASCADE` — if the upstream model row is deleted, aliases auto-clean. No orphan risk.
- `idx_model_aliases_target` powers `listAliasesForTargets(upstreamNames)` for the Models-page badge.
- `source` column kept (default `'user'`) for future expansion; ~4 bytes per row, no real cost.
- No backfill for `requested_model` (null = direct name lookup, no alias used).

### Repo: `src/db/repos/aliases.ts`

```ts
export interface ModelAlias {
  aliasName: string;
  upstreamModel: string;
  label: string | null;
  source: string;
  createdAt: string;
}

export function listAliases(db: Database.Database): ModelAlias[];
export function getAlias(db: Database.Database, name: string): ModelAlias | null;
export function upsertAlias(
  db: Database.Database,
  args: { aliasName: string; upstreamModel: string; label?: string | null; source?: string }
): ModelAlias;  // throws AliasConflictError if aliasName == models.name
export function deleteAlias(db: Database.Database, name: string): boolean;
export function listAliasesForTargets(
  db: Database.Database,
  upstreamNames: string[]
): Record<string, ModelAlias[]>;
```

- `upsertAlias` runs the conflict check in a single `INSERT ... ON CONFLICT(alias_name) DO UPDATE` statement wrapped in a `BEGIN ... COMMIT`; the `models.name` check happens before the INSERT.
- Custom error class `AliasConflictError extends Error` carries `code: "alias_conflicts_with_model"`.
- `listAliasesForTargets` returns a map keyed by `upstream_model`; empty entries omitted.

### Resolution: `src/providers/aliasCache.ts` (new) + `src/providers/alias.ts` (modified)

```ts
// aliasCache.ts
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

- In-memory `Map`, refreshed on CRUD via `clearAliasCache()`; 30s TTL is a safety net for out-of-band DB edits.
- Zero DB hit per request in the steady state.
- Pattern matches existing `getSetting` cache.

`src/providers/alias.ts` changes:
- Delete `LEGACY_MODEL_ALIASES` constant + `warnLegacyOnce` + `legacyWarned` set.
- `resolveModel` drops the legacy lookup step:
  ```ts
  const target = resolveAlias(db, requestedName);
  const model = getModel(db, target);
  if (!model) throw new Error(`unknown model: ${requestedName}`);
  if (!model.enabled) throw new Error(`model disabled: ${requestedName}`);
  // ... bodyTransform unchanged ...
  return { upstreamModel: model.upstream_model, bodyTransform, requestedModel: requestedName };
  ```
- `ResolvedModel` interface gains `requestedModel: string` (original client name, for logging).

### Proxy integration: `src/server.ts` handleProxy

- Capture `resolved.requestedModel` and store in `request_logs.requested_model` (existing `model` column continues to hold `resolved.upstreamModel`).
- `account_model_locks` lookup unchanged (keyed on `resolved.upstreamModel` — alias-transparent, as intended).
- `body.model = resolved.upstreamModel` rewrite unchanged.

### Admin API: `src/api/admin/aliases.ts` (new) + `src/api/admin/index.ts` (mount)

| Method | Path | Behavior |
|---|---|---|
| `GET /` | `listAliases(db)` → `{ aliases: ModelAlias[] }` |
| `POST /` | body `{ aliasName, upstreamModel, label? }` → `upsertAlias` → 201 with row. 409 if name conflicts. 400 if validation fails. |
| `PUT /:name` | body `{ upstreamModel?, label? }` → update. 404 if missing. 409 if new target conflicts with a real model name. |
| `DELETE /:name` | `deleteAlias(db, name)` → 204. 404 if missing. |

All handlers call `clearAliasCache()` on success.

Validation:
- `aliasName`: `/^[A-Za-z0-9._:-]{1,128}$/` (matches OpenAI model-name charset)
- `upstreamModel`: must exist in `models.upstream_model`
- `label`: optional, max 200 chars
- Trim all string inputs server-side

Auth: all under `/api/admin/*` → `requireAdmin` + CSRF (existing middleware).

### `GET /api/admin/models` response extension

Add `aliasCount: number` to each row. Server-side join via `listAliasesForTargets`:
```ts
const rows = listModels(db, { includeDisabled: true });
const targets = [...new Set(rows.map(r => r.upstream_model))];
const aliasByTarget = listAliasesForTargets(db, targets);
const counts = new Map<string, number>();
for (const m of rows) {
  counts.set(m.name, (aliasByTarget[m.upstream_model] ?? []).length);
}
return c.json(rows.map(r => ({ ...existingShape, aliasCount: counts.get(r.name) ?? 0 })));
```

### UI: `client/src/pages/Aliases.tsx` (new)

- TopBar: `Ali<em>as</em>es` (gold italic accent on `as`, per Obsidian Gold brand), eyebrow `Catalog / aliases`, `+ New alias` action.
- Card with search input (filters by alias name, target, label) and table:
  - Columns: Alias, → Target, Label, Source (Badge), Created, Actions (Edit / Delete)
  - Empty state: "No aliases yet. Create one →" with action link.
- Create/Edit modal reuses `Modal` component:
  - Fields: `aliasName` (disabled on edit), `upstreamModel` (typeahead from `useQuery(["models"])`), `label`
  - Client-side regex validation mirrors server
  - Server 409 → toast "Name conflicts with real model"
- Delete uses existing `Confirm` component.
- Mutation invalidates both `["aliases"]` and `["models"]` (Models page badge needs refresh).
- Hash param `?target=<name>` pre-fills the search filter (read from `location.hash`).

### UI: `client/src/pages/Models.tsx` (modified)

- Extend `Model` interface with `aliasCount: number`.
- New column "Aliases" with clickable count linking to `#/admin/aliases?target=<model.name>`, or `—` if 0.

### UI: `client/src/layout/Sidebar.tsx` + `AppShell.tsx` (modified)

- `Sidebar.tsx`: add `{ key: "aliases", label: "Aliases", href: "/admin/aliases", icon: "models" }` between `models` and `quota`. Confirm `Icon` registry has a suitable icon (or add a new `aliases` glyph).
- `AppShell.tsx`:
  - Add `Aliases` import
  - Add `"aliases"` to `KNOWN_ROUTES`
  - Add `case "aliases": return <Aliases />;` in `Page` switch
  - Add `l: "/admin/aliases"` to `gMap`
  - Add `g` then `l` row in help modal

### Dead-code cleanup (same task)

- Delete `LEGACY_MODEL_ALIASES` constant (`src/providers/alias.ts:27-30`)
- Delete `warnLegacyOnce` + `legacyWarned` set (`src/providers/alias.ts:32-37`)
- Remove legacy lookup step from `resolveModel` (`src/providers/alias.ts:44-46`)
- Grep for `MiniMax-M2.7-thinking` / `MiniMax-M3-thinking` / `LEGACY_MODEL_ALIASES` across the repo; drop or update any test references. Commit `8c4043c` already updated the M3-thinking test to adaptive — verify no other stragglers.

## Error Handling

| Condition | Status | Body code | UI toast |
|---|---|---|---|
| `aliasName` empty / fails regex | 400 | `invalid_alias_name` | "Invalid alias name" |
| `upstreamModel` not in `models` | 400 | `unknown_target_model` | "Target model not found" |
| `aliasName` == `models.name` | 409 | `alias_conflicts_with_model` | "Name conflicts with real model" |
| Alias row missing (PUT/DELETE) | 404 | `alias_not_found` | "Alias not found" |
| DB error | 500 | `internal` | "Server error" |

- `clearAliasCache()` wrapped in try/catch — if it throws, log warn, continue (TTL handles it in 30s).
- Race condition: two admin tabs create same alias → last write wins. Acceptable (admin-only, low frequency, no audit requirement).

## Testing

Following `tests/` integration layout + `src/**/*.test.ts` unit pattern. Use `process.env.ROUTER_DB_PATH = join(mkdtempSync(...), "t.db")` for isolation; call `clearAliasCache()` between cases.

**Unit — `src/db/repos/aliases.test.ts`**: insert/overwrite/get/list/delete/listAliasesForTargets semantics.

**Unit — `src/providers/aliasCache.test.ts`**: cache hit/miss, TTL expiry, `clearAliasCache()` invalidation, `resolveAlias("unknown")` returns input unchanged.

**Unit — `src/providers/alias.test.ts`**: extend existing; drop legacy tests; verify `requestedModel` populated for both alias and direct paths.

**Integration — `tests/api-admin-aliases.test.ts`**: full CRUD matrix from the error table; CSRF guard; cache invalidation observable from next request.

**Integration — `tests/proxy-alias.test.ts`**: end-to-end alias → upstream → 200; `request_logs` row contains both `model` and `requested_model`; lock on upstream model blocks requests sent via alias.

**Integration — `tests/api-admin-models.test.ts`**: `aliasCount` accurate, increments/decrements on CRUD.

**Migration — `tests/db-migrations.test.ts`**: extend; verify `007` creates table + index + `requested_model` column; idempotent.

**Cleanup verification**: `git grep -E 'LEGACY_MODEL_ALIASES|MiniMax-M[23]\.7?-thinking' src/ tests/ scripts/ src/db/` returns nothing (after this work lands).

Test count budget: ~25-30 new tests. Current 251+ → ~280+.

## Risks

- **Alias identity collision at scale**: with 100+ aliases the `Map` lookup stays O(1); no perf concern.
- **Cache TTL staleness**: 30s window where a directly-edited DB row is invisible. Mitigated by CRUD invalidation; acceptable for single-admin self-host.
- **`/v1/models` does not return local catalog**: clients querying the router's model list see upstream's list, not aliases. Out of scope; would be a separate spec.
- **CASCADE delete surprise**: deleting a model row drops its aliases silently. Currently no admin UI for model deletion (only disable), so risk is low; document behavior in alias-create modal tooltip.
