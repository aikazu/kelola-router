# Built-in Models: Adaptive Thinking (Drop `-thinking` Variant)

**Date:** 2026-06-02
**Status:** Draft
**Scope:** Router-side model registry + request body transform for thinking.

## Problem

The current `scripts/seed-models.ts` ships `MiniMax-M2.7-thinking` as a router-invented variant that forces `thinking.type=enabled` via a per-row `thinking_enabled` flag. Per the MiniMax reference docs in `docs/minimax-reference/`, the upstream only exposes two `thinking.type` values — `disabled` and **`adaptive`** (default `adaptive`) — and `-thinking` is **not** in the official model list. The router-side variant is therefore misleading and adds a non-existent model surface to clients.

User intent: collapse thinking-enabled models into a single adaptive path. The model itself decides whether to think; no router-side toggle.

## Goals

1. Built-in models that support thinking get `thinking: { type: "adaptive" }` injected by the router — always, for every request, when the client does not already set `thinking`.
2. Built-in models **not mentioned** in `docs/minimax-reference/` (i.e. `MiniMax-M2-her`) get no `thinking` injection — upstream default behavior preserved.
3. `reasoning_split` is auto-enabled whenever the router injects `thinking` (no more global `minimax.reasoning_split` setting).
4. `MiniMax-M2.7-thinking` removed from seed. Backward-compat: requests for that name still resolve to `MiniMax-M2.7` + adaptive injection, with a deprecation log.
5. `thinking_enabled` and `thinking_budget` columns dropped from `models` table.

## Non-Goals

- Per-client/per-request opt-out of adaptive (clients can already pass `thinking: { type: "disabled" }` themselves).
- DB-driven allowlist of "thinking-capable" models (YAGNI — hardcoded const, one place to edit).
- Removing other M2.x variants (`-highspeed`) — those **are** real upstream models per docs.
- Pricing changes. Pricing remains per-row.

## Design

### Schema change (migration 006)

```sql
-- 006-drop-thinking-fields.sql
ALTER TABLE models DROP COLUMN thinking_enabled;
ALTER TABLE models DROP COLUMN thinking_budget;
```

- Irreversible in practice (we do not preserve the columns). Acceptable: the router-invented `thinking_enabled` flag had no clients reading it externally, and `thinking_budget` was never user-tunable.
- Old `001-initial.ts` `INSERT OR IGNORE` rows for the 3 thinking fields must be removed too — but since `001` is the consolidated schema for fresh DBs and migration 006 runs on existing DBs, both must agree. Drop the two columns from the `CREATE TABLE` in `001-initial.ts` as well, and remove the seeded `MiniMax-M2.7-thinking` row from `001-initial.ts`.

### Repo: `src/db/repos/models.ts`

- Remove `thinking_enabled: number` and `thinking_budget: number | null` from `Model` interface.
- Remove both columns from the `INSERT INTO models (...)` list in `upsertModel`.
- The `ModelUpsert` type still picks `name` + `upstream_model`; the rest is `Partial<Model>`. No change to the type alias.

### Seed: `scripts/seed-models.ts`

- Remove the `MiniMax-M2.7-thinking` entry. Net seed list: 8 models (down from 9).
- Remove the `thinking_enabled` field from every entry.
- Keep `pricing_*`, `display_name`, `family`, `context_window` exactly as-is. Pricing for `M2-her` remains `null` (no change).
- No new model added.

### Allowlist: `src/providers/alias.ts`

Replace the per-row `thinking_enabled` check with a hardcoded allowlist const, exported so tests can import it:

```ts
// Models that the MiniMax reference docs (docs/minimax-reference/) list as
// supporting thinking. Models NOT in this set get no thinking injection —
// upstream default behavior applies. Add to this set when upstream ships a
// new thinking-capable model.
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
```

### Backward-compat alias

In `resolveModel`, before the DB lookup, normalize legacy names:

```ts
const LEGACY_ALIASES: Record<string, string> = {
  "MiniMax-M2.7-thinking": "MiniMax-M2.7",
};
const requested = LEGACY_ALIASES[requestedName] ?? requestedName;
```

Log a deprecation warning at first use per process (in-memory flag) so production logs surface the migration.

### Body transform

Inside `bodyTransform`:

```ts
if (ADAPTIVE_THINKING_MODELS.has(model.upstream_model) && b.thinking === undefined) {
  b.thinking = { type: "adaptive" };
}
if (b.thinking && b.reasoning_split === undefined) {
  b.reasoning_split = true;
}
```

- If the client already set `thinking`, we do **not** overwrite — explicit client intent wins. (This is the same precedence the current code already follows.)
- `reasoning_split` is auto-on whenever `thinking` is present, regardless of who set it (router or client). This is the "auto-on kalau adaptive" behavior the user confirmed.
- M3 `max_completion_tokens` default (131072) — keep unchanged.
- The `minimax.reasoningSplitDefault` setting read is **removed**. Any existing setting in user DBs becomes inert; it is not deleted from the `settings` table (cheap, harmless). A future cleanup migration can prune it.

### Admin API: `src/api/admin/models.ts`

Drop `thinkingEnabled: !!m.thinking_enabled` from the response mapper. The list shape becomes:

```ts
{ name, displayName, family, contextWindow, source, enabled }
```

### Frontend: `client/src/pages/Models.tsx`

Drop the "Thinking" column from the models table. No other change.

## Files Touched

| File | Action |
|---|---|
| `src/db/migrations/006-drop-thinking-fields.ts` | **new** — `ALTER TABLE` |
| `src/db/migrations/index.ts` | register 006 |
| `src/db/migrations/001-initial.ts` | drop 2 columns from `CREATE TABLE`; drop `MiniMax-M2.7-thinking` seed row |
| `src/db/repos/models.ts` | drop 2 fields from `Model` + `upsertModel` |
| `src/db/repos/models.test.ts` | drop `thinking_enabled` assertion |
| `src/providers/alias.ts` | rewrite thinking logic, add allowlist + legacy alias |
| `src/providers/alias.test.ts` | expand: adaptive injection, M2-her skip, legacy alias |
| `scripts/seed-models.ts` | drop 1 row, drop `thinking_enabled` field |
| `src/api/admin/models.ts` | drop `thinkingEnabled` from response |
| `client/src/pages/Models.tsx` | drop Thinking column |

## Testing

Unit (`src/providers/alias.test.ts`):
- `MiniMax-M2.7` body with no `thinking` → body has `thinking.type === "adaptive"` and `reasoning_split === true`.
- `MiniMax-M2-her` body → no `thinking` injected, no `reasoning_split` injected.
- `MiniMax-M2.7` body with `thinking: { type: "disabled" }` → unchanged (client wins).
- `MiniMax-M2.7` body with `thinking: { type: "adaptive", budget_tokens: 8192 }` → unchanged.
- `MiniMax-M2.7-thinking` request → resolves to `MiniMax-M2.7`, body gets adaptive.
- `MiniMax-M2.7` body with `reasoning_split: false` and `thinking.type=disabled` from client → `reasoning_split` stays `false` (respect explicit client).

Unit (`src/db/repos/models.test.ts`):
- `upsertModel` + `getModel` round-trip without thinking fields.
- `listModels` returns rows without `thinking_enabled`.

Integration (`tests/integration/v1-models.test.ts`):
- Existing 3 tests still pass; no test body changes needed (no test references `thinking_enabled`).

Migration:
- Test on a fixture DB with `user_version = 5` that 006 applies cleanly and `thinking_enabled` is gone from the schema.

## Rollout

1. Merge the spec + plan (this doc + writing-plans output).
2. Implement in TDD order: test-first per file, ~300 LOC/commit cap as usual.
3. Existing user DBs migrate automatically on next `npm run dev` / Docker start via the migration runner.
4. Old `MiniMax-M2.7-thinking` requests keep working — silent alias to `M2.7`.
5. Frontend rebuilt and re-served on the next Docker image build.

## Risks

- **Breaking clients that hardcode `MiniMax-M2.7-thinking`**: mitigated by the legacy alias. They will keep working; the deprecation log will surface this in dashboards.
- **Pricing regression**: none — pricing rows unchanged. `M2-her` still has `null` pricing.
- **Settings leak**: `minimax.reasoningSplitDefault` becomes inert. Cheap, not worth a cleanup migration now.
