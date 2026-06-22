# Models page (prefix display, fetch, delete, copy) + Console flow consistency

**Date:** 2026-06-18
**Status:** Draft (awaiting user review)

This spec has two parts:

- **Part A**: `/admin/models` dashboard: normalize Pioneer seeds to ~75, surface the
  client call string (`pio/...`), per-card fetch, delete with safety, copy/edit.
- **Part B**: Console flow consistency across all proxy handlers (Notion emits no
  events, CodeBuddy/Combo emit placeholders, delegated handlers overwrite the combo
  reqId, error paths skip log rows).

## Background

The `/admin/models` dashboard page is confusing to operate:

1. **139 Pioneer models seeded on fresh deploy, should be ~75.** Root cause: Pioneer's
   upstream `GET /v1/models` returns each model id in TWO forms: a canonical bare id
   (`gpt-5.5`, `Qwen/Qwen3-32B`, `nvidia/...`) AND an Anthropic-API-compat alias
   prefixed with `anthropic/pioneer/` (e.g. `anthropic/pioneer/gpt-5.5`). The seeder
   in `src/providers/pioneer/models.ts` only strips a leading `pioneer/`, so the 64
   `anthropic/pioneer/...` entries leak through as separate rows. 75 canonical + 64
   duplicates = 139. Verified live: `GET https://api.pioneer.ai/v1/models` with a valid
   key returns 139 ids, of which 64 match `%anthropic/pioneer/%`.

2. **Per-card "Fetch from upstream" button hits the wrong upstream.** Every card
   (MiniMax/Kiro/Pioneer/CodeBuddy) renders the same Fetch button, but it calls
   `/api/admin/models/fetch` which is hardcoded to MiniMax (`src/providers/listModels.ts`
   forces `provider: 'minimax'`). Clicking Fetch on the Pioneer card silently fetches
   MiniMax.

3. **No delete model.** Only toggle enable/disable. Users cannot remove stale rows.

4. **Prefix not surfaced.** Rows display `m.name` verbatim (`pioneer/claude-opus-4-8`)
   instead of the client-facing call string (`pio/claude-opus-4-8`). No column or action
   shows how to invoke a model.

5. **Backend prefix enforcement already correct.** `resolveModel` in
   `src/providers/alias.ts:62-70` rejects bare model names that are not an alias/combo,
   and requires the prefixed model's `provider` column to match the prefix. So the
   "every model needs a prefix except alias/combo" rule already holds at the proxy layer.
   No change needed there.

## Goals

- Seed only canonical Pioneer model ids (~75), deduplicating the `anthropic/pioneer/`
  alias entries.
- Clean the 64 duplicate rows already in existing DBs.
- Make per-card "Fetch from upstream" call the correct upstream per provider, and hide
  the button on providers with no model-list endpoint (Kiro, CodeBuddy).
- Add delete with a safety check against alias/combo references.
- Surface the client call string (prefix+id) and add Copy, Edit, Delete row actions.

**Part B (console flow consistency) goals:**

- Notion requests appear in the live Console and write a log row on every terminal path.
- CodeBuddy + Combo emit the resolved model (not a placeholder) in `buildStart`.
- A combo request is one Console thread (delegated handlers reuse the parent reqId).
- MiniMax + Kiro write a log row on the upstream-error path (parity with CodeBuddy/Pioneer).
- `reqId` is set at the very top of every handler (no `----` fallback on outer catch).
- `buildStart` fires before account selection in every handler.

## Non-goals

- Do not change MiniMax / Kiro / CodeBuddy / Notion seeders.
- Do not build upstream-list adapters for Kiro / CodeBuddy / Notion (no endpoint exists).
- Do not change backend prefix resolution (`resolveModel` / `parseModelPrefix`).
- Do not change the proxy transport or account selection.

## Design

### 1. Seeder fix: strip `anthropic/pioneer/` before dedup

File: `src/providers/pioneer/models.ts`, function `fetchAndSeedPioneerModels`.

Current strip logic (line ~64) only removes a leading `pioneer/`:

```ts
const bareId = m.id.replace(/^pioneer\//, '');
```

Change to strip BOTH a leading `anthropic/pioneer/` AND a leading `pioneer/`
(`anthropic/pioneer/` first, since it is the longer prefix), then dedup on the
resulting bare id via the existing `seen` Set:

```ts
const bareId = m.id.replace(/^anthropic\/pioneer\//, '').replace(/^pioneer\//, '');
```

This collapses every `anthropic/pioneer/<x>` onto the canonical `<x>` already seeded
in the same pass. Result for the current upstream catalogue: ~75 rows.

The bare id is preserved as both `name` (namespaced `pioneer/<bareId>`) and
`upstream_model` (`<bareId>`). The `/v1/chat/completions` upstream accepts the bare id,
so no transform change needed in `src/providers/pioneer/transform.ts`.

### 2. Migration 009: clean duplicate rows in existing DBs

File: `src/db/migrations/009-pioneer-anthropic-dedup.ts` (new). Mirrors the style of
`008-pioneer-dedup.ts`.

Algorithm (verified against real DB state):

- **Verified facts:** Pioneer dup rows have `name = 'pioneer/anthropic/pioneer/<x>'` and
  `upstream_model = 'anthropic/pioneer/<x>'`; the canonical survivor has
  `name = 'pioneer/<x>'`, `upstream_model = '<x>'`. All 139 `upstream_model` values are
  distinct today (the unique index holds because the dup upstream strings differ from the
  canonical ones). So the dedup key must be derived by stripping a leading
  `anthropic/pioneer/` from `upstream_model`.
1. Compute `canon = upstream_model` with a leading `anthropic/pioneer/` stripped.
2. Partition Pioneer rows by `canon`; the survivor is the row whose `upstream_model`
   does NOT start with `anthropic/pioneer/` (the canonical), ties broken by shortest
   name then lowest id.
3. Delete the non-survivors (the 64 dup rows). Survivors already carry canonical
   `name`/`upstream_model`, so no rewrite needed.

```sql
CREATE TEMP TABLE _pio_canon AS
  SELECT id, name, upstream_model,
    CASE WHEN upstream_model LIKE 'anthropic/pioneer/%'
         THEN substr(upstream_model, 19)   -- length('anthropic/pioneer/') = 18 + 1
         ELSE upstream_model
    END AS canon
  FROM models
  WHERE provider = 'pioneer';

-- Survivor per canon: prefer the row whose upstream_model is canonical (no
-- anthropic/pioneer/ prefix), i.e. NOT LIKE. Ties: shortest name, lowest id.
CREATE TEMP TABLE _pio_keep AS
  SELECT canon, id AS keep_id FROM (
    SELECT *,
      row_number() OVER (
        PARTITION BY canon
        ORDER BY
          CASE WHEN upstream_model LIKE 'anthropic/pioneer/%' THEN 1 ELSE 0 END,
          length(name) ASC,
          id ASC
      ) AS rn
    FROM _pio_canon
  ) WHERE rn = 1;

-- Delete non-survivors only.
DELETE FROM models
 WHERE id IN (SELECT id FROM _pio_canon)
   AND id NOT IN (SELECT keep_id FROM _pio_keep);

DROP TABLE _pio_canon;
DROP TABLE _pio_keep;
```

(Survivors keep their existing canonical `name`/`upstream_model`; no UPDATE needed.)

Bumps `user_version` to `9`. Register in `src/db/migrations/index.ts`. Safe on a clean
DB (no-op when no duplicates exist).

### 3. Backend endpoints

All admin model routes live in `src/api/admin/models.ts` (the `modelRoutes` Hono app,
mounted at `/api/admin/models` via `src/api/admin/index.ts:29`). The CSRF guard
(`csrfGuard` in `src/auth.ts:51`) already covers every non-GET/HEAD/OPTIONS method
including DELETE and POST (no CSRF change needed).

The JSON routes (`/api/admin/models/*`) are separate from the legacy HTML routes in
`src/server.ts:154-172` (`/admin/models/fetch`, `/enable`, `/disable`) which the SPA no
longer uses for the Models page. Leave the legacy HTML routes alone; add new JSON routes.

#### `POST /api/admin/models/fetch/:provider` (new; client also stops calling the legacy
`/api/admin/models/fetch` placeholder at `models.ts:133`)

- `:provider` param selects the upstream list call.
- `minimax` → `fetchModels(db, apiKey)` (existing), using the first active MiniMax account.
- `pioneer` → `fetchAndSeedPioneerModels(db, apiKey, baseUrl?)`, using the first active
  Pioneer account.
- Any other provider → `404 { error: 'no_upstream_list', message: '<provider> has no model-list endpoint' }`.
- The existing placeholder `POST /api/admin/models/fetch` (`models.ts:133`) stays (harmless
  no-op; the dashboard simply stops calling it.

#### `GET /api/admin/models/:name/refs` (new)

Returns the alias and combo references that point at the model, so the UI can block
delete and list what to clean up first.

```json
{
  "aliases": [{ "aliasName": "claude" }],
  "combos":  [{ "id": "abc", "comboName": "fast-mix" }]
}
```

**Schema facts (verified):**

- `model_aliases` (not `aliases`): PK `alias_name`, column `upstream_model` is the target.
  It has `FOREIGN KEY (upstream_model) REFERENCES models(upstream_model) ON DELETE CASCADE`.
- `combos`: `models` is a TEXT column holding a JSON array of model names. No
  `combo_members` join table; refs must be resolved by reading rows and parsing the
  JSON, then matching the requested `:name` against array entries.

**Refs resolution:**

- Aliases: `SELECT alias_name FROM model_aliases WHERE upstream_model = ?` with `?`
  bound to the model's `upstream_model` (NOT `:name`, because alias targets point at
  `upstream_model`, not `models.name`). Resolve the requested model row's
  `upstream_model` first.
- Combos: load `SELECT id, name, models FROM combos`, JSON-parse each `models` array,
  collect combos whose array contains `:name` (the DB name, not call string).
- `:name` (path param) is URL-decoded; the dashboard passes the namespaced DB name
  (`pioneer/claude-opus-4-8`), not the client call string.

**Cascade caveat:** because `model_aliases` is `ON DELETE CASCADE`, a raw
`DELETE FROM models WHERE name = ?` would silently delete dependent aliases. The
explicit refs check above therefore MUST run before the delete and abort with 409 if any
refs exist. We never rely on the cascade to "clean up" silently.

#### `DELETE /api/admin/models/:name` (new)

- Resolve the model row by `name`; 404 if missing.
- Compute refs (see `GET .../refs`); if any → `409 { error: 'has_refs', refs }`.
- Else `DELETE FROM models WHERE name = :name`. Return `{ ok: true }`.
- Do NOT rely on the `model_aliases.upstream_model` `ON DELETE CASCADE` (schema fact
  above). The explicit refs check always runs first and aborts.

### 4. Client changes

#### `client/src/lib/providerPrefix.ts` (new)

Single source of truth mirroring `src/providers/modelPrefix.ts` `PREFIX_TO_PROVIDER`,
inverted:

```ts
export const PREFIX_BY_PROVIDER: Record<string, string> = {
  minimax: 'mx',
  kiro: 'kr',
  codebuddy: 'cb',
  pioneer: 'pio',
  notion: 'nt',
};

export const PROVIDERS_WITH_UPSTREAM_LIST = new Set(['minimax', 'pioneer']);

/** Client call string for a model row, e.g. `pio/claude-opus-4-8`. */
export function callName(provider: string, dbName: string): string {
  const prefix = PREFIX_BY_PROVIDER[provider];
  if (!prefix) return dbName;
  // Pioneer rows are namespaced `pioneer/<id>` in the DB; strip once.
  const bare = provider === 'pioneer' ? dbName.replace(/^pioneer\//, '') : dbName;
  return `${prefix}/${bare}`;
}
```

Keep this in sync with the server map. (A future refactor could ship one file consumed
by both. Out of scope here.)

#### `client/src/components/models/ProviderModelsSection.tsx`

- Add `provider: Provider` prop.
- Columns (header order): checkbox, **ID**, **NAME**, **CONTEXT IN**, **CONTEXT OUT**,
  **In $/M**, **Out $/M**, **Aliases**, **Combo**, **Status**, **Actions**.
  - **ID** = `callName(provider, m.name)` (mono). This is the client call string.
  - **NAME** = `m.displayName ?? m.name`.
  - **CONTEXT IN / OUT** = from the model row's input/output context columns (currently
    only `contextWindow` exists; see migration note below). If a column is null, render
    `n/a`.
  - **Combo** = count of combos referencing this model (needs the refs query; see below).
- Actions cell (right): `Toggle` (Switch, existing), `Copy`, `Test` (existing),
  `Edit`, `Delete`.
- Fetch button: render only if `PROVIDERS_WITH_UPSTREAM_LIST.has(provider)`. Calls
  `/api/admin/models/fetch/${provider}`.
- Copy button: `navigator.clipboard.writeText(callName(provider, m.name))`, toast
  "Copied".
- Edit button: opens an edit modal (reuse the shape of `AddModelModal`). Submits to a
  new `PATCH /api/admin/models/:name` endpoint (no model update endpoint exists today).
  Body: `{ displayName?, contextWindow?, contextOutput?, pricingInput?, pricingOutput? }`.
  Backend updates the row in place (only provided fields). Name and upstream_model are
  immutable from this modal (renaming a model would orphan aliases/combos).
- Delete button: confirm dialog → call `GET .../refs` first. If refs, show them with
  links to `/admin/aliases` and `/admin/combos` and abort. If none, call `DELETE` and
  invalidate the models query.

#### `client/src/pages/Models.tsx`

- Pass `provider` to each `ProviderModelsSection`.
- No `Notion` card today (Notion has no models seeded). Do not add one.

#### Combo reference counts

The **Combo** column needs per-model combo membership counts. Chosen approach: extend
`GET /api/admin/models` to include `comboCount` per model. Since combos store their
members as a JSON array in `combos.models` (no join table), compute counts by loading all
combos once, parsing each `models` array, and tallying per member name server-side. Add
`comboCount` to the response shape and to the client `Model` type.

### 5. Context IN / OUT columns

The `models` table has a single `context_window` column (`migration 001`, plus Pioneer
seeds it from `max_input_tokens`). The upstream catalogue entry also exposes
`max_tokens` (output cap). Decision:

- Add `context_output INTEGER` column via migration `010` (additive `ALTER TABLE`).
- Seeder populates `context_window` from `max_input_tokens` and `context_output` from
  `max_tokens`.
- **CONTEXT IN** = `context_window`, **CONTEXT OUT** = `context_output`.

## Part B: Console flow consistency

The live-request Console (dashboard "Console" page, fed by the `consoleBus` event
stream (`buildStart`/`buildAccount`/`buildDone`/`buildError`/`buildTransportFail` in)
`src/console/flow.ts`) is inconsistent across providers. Audit (verified against current
code) found these bugs; each is addressed below.

### B1. Notion handler emits zero console events

`src/proxy/notion.ts` never imports `consoleBus` and hand-rolls its own
`reqId = notion-${startMs}-${random}` at `notion.ts:93` without calling `genReqId()` or
`c.set('reqId', reqId)`. As a result Notion requests never appear in the live Console,
and the log row's `reqId` does not match the server-side `reqId` convention used
elsewhere. Error paths (no account, missing cookies, missing spaceId, upstream !ok)
return JSON without emitting any event.

**Fix:** bring `handleNotionProxy` to parity with `handlePioneerProxy`: emit
`buildStart` (with resolved model + requested alias), `buildAccount`, `buildDone`/
`buildError`, and call `insertRequestLogDeferred` on all terminal paths. Use
`genReqId()` + `c.set('reqId', reqId)`.

### B2. CodeBuddy + Combo emit placeholder model/alias in `buildStart`

- `src/proxy/codebuddy.ts:64` emits `buildStart(reqId, …, 'codebuddy', 'codebuddy')`:
  a hardcoded placeholder, not the resolved model. The log row also uses
  `requestedModel: model` (the raw `body.model` string), not
  `resolved.requestedModel`.
- `src/proxy/combo.ts:80` emits `buildStart(…, \`combo:${combo.name}\`, combo.name)`:
  a placeholder; the actual resolved member model is never surfaced at combo level.

**Fix:** resolve the model before emitting `buildStart`, wrapped in try/catch with a
fallback to the raw `body.model` string (exactly as `handlePioneerProxy` does at
`pioneer.ts:65-79`: resolution can throw on unknown/disabled models, and the console
should still start). Pass `resolved.upstreamModel` + `resolved.requestedModel` to
`buildStart`. For the CodeBuddy log row, use `resolved.requestedModel` instead of the raw
`body.model` string.

### B3. Delegated handlers overwrite the combo `reqId`

`handleComboProxy` generates a `reqId` and emits `buildStart` (`combo.ts:72-83`), then
delegates to `handleCodeBuddyProxy`/`handlePioneerProxy`/`handleKiroProxy`
(`combo.ts:234,281` and the kiro leg). Each delegated handler calls `genReqId()` again
and `c.set('reqId', reqId)`, overwriting the combo's reqId on the shared `Context`. The
console then shows two disconnected event streams for one logical combo request.

**Fix:** add an optional `parentReqId?: string` parameter to each provider handler
(`handleCodeBuddyProxy`, `handlePioneerProxy`, `handleKiroProxy`). When set, the handler
uses it as `reqId`, does NOT call `genReqId()`, and does NOT call `c.set('reqId')`.
`handleComboProxy` passes its own `reqId` when delegating; direct (non-combo) calls omit
it, so each still generates its own. This keeps a combo request as one console thread
while leaving direct calls unchanged. (No new "member selected" event; the existing
`account`/`done`/`error` events under the shared reqId are enough.)

### B4. Error paths skip the request log row (MiniMax, Kiro)

- `src/proxy/minimax.ts:336-341`: the `!resp.ok` branch emits `buildError` and returns,
  with no `insertRequestLogDeferred`. Success paths (stream `:361`, buffered `:412`)
  log correctly. CodeBuddy (`codebuddy.ts:191`) and Pioneer (`pioneer.ts:212`) already
  log on the error path.
- `src/proxy/kiro.ts` `executeKiro` error path (around `:179`) emits `buildError` but
  does not log a row.

**Fix:** add `insertRequestLogDeferred` to the error branches (mirror CodeBuddy's
`logCtxBase({ responseBody: errBody })` pattern), so failed requests show in the
Request log with the upstream status and error body. Cost is 0 on errors (no tokens).

### B5. `reqId` may be undefined on outer catch paths

`minimax.ts:459-460` and `kiro.ts:217-218` read `c.get('reqId') ?? '----'` in the outer
`catch`, because the catch is outside the block where `reqId` is guaranteed set. This
can surface `----` in the Console when the catch fires before `genReqId()`.

**Fix:** hoist `genReqId()` + `c.set('reqId', reqId)` to the very top of each handler
(before model resolution / account selection), as `handlePioneerProxy` already does
(`pioneer.ts:76-77`). Then the outer catch can reference the in-scope `reqId` directly.

### B6. `buildStart` timing relative to account selection

Inconsistent: MiniMax emits `buildStart` AFTER account selection (`minimax.ts:225-275`);
Kiro/CodeBuddy/Pioneer/Combo emit it BEFORE. The Before-ordering is correct (the user
wants to see the request start immediately, then account selection as a follow-on
event).

**Fix:** make MiniMax emit `buildStart` before account selection, matching the others.
(Model resolution still happens before `buildStart` so the model/alias fields are
correct. See B2.)

### B7. Cross-handler helper

To prevent drift recurring, extract the common "start → select → account → done/error +
log row" scaffolding into a thin helper in `src/console/flow.ts` (or a new
`src/proxy/consoleScaffold.ts`) that every handler uses. Out of scope to fully unify the
handlers here (they differ in transport/SSE/usage shape), but the event-emission order
and log-row-on-every-terminal-path should come from one shared function so a new handler
cannot silently drop events.

### Non-goals (Part B)

- Do not unify the SSE/transport/usage plumbing across handlers (each provider is
  structurally different).
- Do not change the Console UI rendering beyond consuming the now-consistent events.
  (The audit noted `transport` events are emitted but not rendered by
  `client/src/pages/Console.tsx`: leaving as-is; out of scope.)

## Error handling

- Fetch failure → existing toast pattern (`toast.error(e.message)`).
- Delete blocked by refs → modal lists refs with deep links; user must remove the
  alias/combo first.
- Copy unsupported (no clipboard API) → fallback `document.execCommand('copy')` then
  toast.
- Unknown provider on `/fetch/:provider` → 404.

## Testing

- `src/providers/pioneer/models.test.ts`: add a case where the upstream payload contains
  `gpt-5.5` and `anthropic/pioneer/gpt-5.5`; assert exactly one row seeded, named
  `pioneer/gpt-5.5`, upstream `gpt-5.5`. Red first.
- `src/db/migrations/index.test.ts`: run migrations on a fixture DB seeded with the 139
  rows, assert post-009 count is ~75 and no `pioneer/anthropic/pioneer/%` rows remain.
- `src/server.ts` / admin route tests: `fetch/:provider` (minimax ok, pioneer ok, kiro
  404), `:name/refs`, `DELETE :name` (success, 409-with-refs, alias ref, combo ref), and
  CSRF guard on DELETE.
- `client/src/__tests__/`: `ProviderModelsSection` renders `callName`, copy calls
  clipboard, delete flow shows refs and blocks, Fetch hidden when
  `!PROVIDERS_WITH_UPSTREAM_LIST.has(provider)`.
- **Part B console tests:** For each provider handler, assert (via a spy on
  `consoleBus.emit` and on `insertRequestLogDeferred`) that every terminal path emits
  exactly one `start` + one of `done`/`error`, and writes exactly one log row, including
  the upstream `!ok` path. Notion: assert events now emitted (currently none). CodeBuddy:
  assert `buildStart` model = resolved upstream, not `'codebuddy'`. Combo + delegated
  handler: assert the delegated leg reuses the parent reqId (one thread in the event
  stream), not a new one. MiniMax: assert `buildStart` fires before account selection.

## Rollout

1. Migration 009 (Pioneer dedup) + 010 (context_output) ship with the code change.
2. On next server start, existing DBs auto-clean to ~75 Pioneer rows.
3. New Pioneer accounts seeded via the fixed seeder land at ~75 directly.
4. Dashboard uses the new per-provider fetch + delete + copy.
5. Console now shows consistent events for Notion (previously silent), resolved models
   for CodeBuddy/Combo (previously placeholders), one thread per combo request
   (previously split), and log rows for failed MiniMax/Kiro requests.
