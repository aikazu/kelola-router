# 0007. Provider prefix routing (mm/ kr/ cb/ on body.model)

Date: 2026-06-14

## Status

Accepted.

## Context

Before v0.18.0, a request's provider was inferred from model resolution: the proxy looked up the model name (or alias) and used `models.provider` to pick a handler. This worked when model names were unique across providers and when users always went through the alias layer. Two problems emerged as a third provider (CodeBuddy) was added:

1. **Ambiguity at routing time.** The same bare model name could conceivably exist on multiple providers. The router had no signal to disambiguate without always reading from the DB.
2. **Bare raw model names were accepted.** A client could send the literal upstream model name (e.g. `MiniMax-M3`) without an alias, and it would resolve if found in the DB. This made it hard to enforce provider boundaries — a MiniMax model name could accidentally match against a Kiro account.

A prefix scheme was needed: explicit, validated at parse time, and requiring zero DB reads to identify the target provider.

## Decision

`src/providers/modelPrefix.ts` exports `parseModelPrefix(raw: string): ParsedModel`. The parser splits on the first `/`:

- `mm/<name>` → `provider: 'minimax'`, `modelName: name`, `prefixed: true`
- `kr/<name>` → `provider: 'kiro'`, same
- `cb/<name>` → `provider: 'codebuddy'`, same
- No slash → `provider: null`, `prefixed: false` (bare — resolved later via combos/aliases)
- Unknown prefix (`xx/...`) → throws `Error('unknown model prefix: xx')` → 400

Enforcement is in `resolveModel` (`src/providers/alias.ts`):

- **Prefixed path**: literal DB lookup by `modelName`, no alias expansion. The stored `models.provider` must match the parsed provider — mismatch → 400. This means clients can't route a MiniMax model through the Kiro handler by typo.
- **Bare path**: must resolve via alias (`resolveAlias`). If the alias lookup returns the input unchanged (no match), the name is rejected — bare raw model names are never accepted as-is.
- Combo names are intercepted upstream in `handleProxy` before `resolveModel` is called, so combos work with bare names.

Combo members must carry a prefix (e.g. `mm/MiniMax-M3`, `kr/claude-sonnet-4-5`). This is enforced in `createCombo` and documented in the dashboard.

## Consequences

### Positive

- Provider is determined before any DB read, enabling fast-path dispatch.
- Clients can't accidentally route to the wrong provider — the prefix assertion is strict.
- Bare raw model names are rejected cleanly; the error message says `unknown model: <name>` so the fix is clear.
- Adding a fourth provider adds one line to `PREFIX_TO_PROVIDER`.

### Negative

- Clients that were sending bare model names must add a prefix or create an alias. This is a breaking change for any caller that wasn't already using aliases.
- Combo members must be updated to use prefixes — existing combos created before v0.18.0 would break if the `models` column stored bare names.

### Neutral

- `requested_model` in `request_logs` stores the full prefixed string (e.g. `mm/MiniMax-M3`). Log queries that match on model name need to account for the prefix.

## Alternatives considered

### Infer provider from model name pattern

Use a regex or prefix list on the model name itself (e.g. `claude-` → Kiro, `MiniMax-` → MiniMax). Rejected because: brittle, breaks the moment a provider changes their naming convention, and requires the router to know provider-specific name patterns — coupling that doesn't belong in the routing layer.

### Provider field in the request body

Accept a `provider` field alongside `model`. Rejected because: OpenAI-compatible clients don't send a `provider` field, and modifying request bodies breaks third-party SDKs. Prefix-on-model is the most client-transparent approach.

## References

- `src/providers/modelPrefix.ts` — `parseModelPrefix`, `PREFIX_TO_PROVIDER`
- `src/providers/alias.ts` — `resolveModel`, prefixed vs bare enforcement
- `src/proxy/combo.ts` — combo name interception before `resolveModel`
- `src/db/repos/combos.ts` — `createCombo` (prefix validation on members)
- `CHANGELOG.md` v0.18.0 — provider prefix routing entry
