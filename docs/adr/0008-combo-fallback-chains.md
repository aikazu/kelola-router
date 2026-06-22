# 0008. Combo fallback chains (cross-provider ordered model list)

Date: 2026-06-14

## Status

Accepted.

## Context

With three providers available, users need a way to express: "try model A first; if it fails (quota, backoff, 5xx), try model B on a different provider." Without this, a client must implement retry logic itself, which breaks the single-endpoint design goal.

The existing alias system maps one name to one model. Aliases are not ordered lists and have no retry semantics. Transports handle network-level fallback (direct vs relay), not model-level or provider-level fallback.

Two design questions were open:
1. Where does the fallback list live (in the DB or in the client request)?
2. Should combos be able to shadow aliases (i.e. can a combo named `claude` override an alias also named `claude`)?

## Decision

A `combos` table (migration `005-combos.ts`) stores named fallback chains: `id TEXT`, `name TEXT UNIQUE`, `models TEXT` (JSON array of prefixed model names). A combo is intercepted in `handleProxy` / `handleKiroProxy` before `resolveModel` runs. The proxy checks whether `body.model` (bare, unprefixed) matches a combo name, and if so, delegates to `handleComboProxy` in `src/proxy/combo.ts`.

`handleComboProxy` walks `combo.models` in order:
1. Select an account for the current member (re-selecting per iteration to skip freshly backoffed accounts).
2. Resolve the prefixed member name (via `resolveModel`). If the model is disabled or missing, skip.
3. Check model lock. If locked, skip.
4. Fetch upstream. On success, return.
5. On failure: apply account error state (backoff, model lock, balance disable). If the status is retryable (`401`, `402`, `403`, `502`, `503`, `504`), advance to the next member. Otherwise, return the error immediately.
6. If all members are exhausted, return the last error response.

**Combo names must not shadow aliases.** `createCombo` queries `model_aliases` and rejects any name that already exists there. This is enforced at write time (not at resolution time) to keep the hot path fast. The rationale: combos and aliases occupy the same namespace (bare unprefixed names in `body.model`); allowing shadowing would make request routing non-deterministic depending on insertion order.

**Combo members must carry a prefix** (`mm/`, `kr/`, `cb/`). This is required for provider identification during the prefixed lookup inside `resolveModel`. A member without a prefix would fall into the bare-name path, which only resolves aliases, creating a circular dependency.

## Consequences

### Positive

- Cross-provider fallback is transparent to the client: one endpoint, one model name (the combo), automatic retry across providers.
- Re-selecting an account per iteration means a freshly rate-limited MiniMax account is skipped on the next member attempt, not just on the first.
- Combo CRUD is fully admin-controlled (dashboard + API), no code changes needed to add or modify chains.

### Negative

- The retryable set (`401/402/403/502/503/504`) is intentionally broad. A `401` on a combo member marks that account as `status: 'error'` and falls through; this could mask a misconfigured account if the combo always has a healthy fallback.
- Combo names live in the same namespace as alias names. The shadowing guard prevents conflicts at creation time, but a pre-existing alias with the same name blocks creating a combo. The user must rename or delete the alias first.

### Neutral

- `combo.models` is stored as a JSON array string, not a join table. Simple schema; ordering is preserved naturally by array index. If combos grow to hundreds of members, a join table would be preferable.

## Alternatives considered

### Store the fallback list in the alias table

Add an `is_combo` flag and a `fallback_models` JSON column to `model_aliases`. Rejected because: aliases are single-target by design; adding ordered-list semantics muddies the model and makes alias resolution code conditional on the flag.

### Client-side retry with multiple model fields

Accept `models: [...]` in the request body. Rejected because: non-standard OpenAI extension, breaks all existing clients. Server-side combo is invisible to the client.

## References

- `src/proxy/combo.ts`: `handleComboProxy`, retry loop, retryable status set
- `src/db/repos/combos.ts`: CRUD, `createCombo` alias-shadow guard
- `src/db/migrations/005-combos.ts`: schema (`user_version = 5`)
- `src/providers/modelPrefix.ts`: prefix requirement for combo members
- `CHANGELOG.md` v0.18.0: combo fallback chains entry
