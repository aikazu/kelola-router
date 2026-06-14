# Provider Prefix Routing — Design

**Date:** 2026-06-14
**Status:** Approved (brainstorm), pending implementation plan

## Goal

Route a request to its upstream provider based on an explicit prefix in the
`body.model` string, instead of relying solely on the `models.provider` column.

Prefix → provider map:

| Prefix | Provider    |
|--------|-------------|
| `mm`   | `minimax`   |
| `kr`   | `kiro`      |
| `cb`   | `codebuddy` |

Wire format: `<prefix>/<modelName>`, e.g. `kr/claude-opus-4-8`. No leading slash.

Unprefixed model strings resolve **only** against combos and aliases (strict).

## Decisions (locked)

1. **Strict.** A bare (unprefixed) string is valid only if it is a combo name or
   an alias. A bare raw model name (a real `models` row that is not an alias)
   is rejected. Real provider models REQUIRE a prefix.
2. **Format** `<prefix>/<modelName>` — slash separator, no leading slash.
3. **Literal lookup + provider enforced.** After a prefix, the model name is
   looked up literally (no alias expansion). The resolved `model.provider` MUST
   equal the prefix's provider, else error. The prefix is authoritative; it does
   not override the column, it asserts agreement with it.
4. **Unknown prefix → error.** Any `x/y` whose first segment is not `mm`/`kr`/`cb`
   is an error (`unknown model prefix`). Consequence: model names that naturally
   contain a `/` can no longer be sent bare.
5. **Logging.** `requested_model` stores the full prefixed string verbatim
   (`kr/claude-opus-4-8`).

### Accepted migration cost

Strict mode breaks existing clients that send bare provider model names
(e.g. `MiniMax-M3`). They must switch to `mm/MiniMax-M3` or have an alias added.
Accepted by the user.

## Current behaviour (baseline)

- `handleProxy` (`src/proxy/minimax.ts`):
  1. `getCombo(body.model)` — if combo, delegate to `handleComboProxy`.
  2. `peek = resolveModel(db, body.model, body)` inside a try/catch; branch to
     `handleKiroProxy` / `handleCodeBuddyProxy` on `peek.provider`; unknown model
     falls through to the MiniMax path for the canonical 400.
- `resolveModel` (`src/providers/alias.ts`): `resolveAlias` → `getModel` →
  returns `{ upstreamModel, requestedModel, provider, bodyTransform }`. Provider
  comes from the `models.provider` column (default `minimax`).
- `resolveAlias` (`src/providers/aliasCache.ts`): returns the input unchanged on
  a miss — so "is an alias" == `resolveAlias(x) !== x`.
- Combos are bare-only and intercepted before `resolveModel` runs.

## Design (Approach 1 — prefix logic inside `resolveModel`)

Single source of truth. All call sites already branch on `resolved.provider`, so
they inherit enforcement with no change.

### Component 1 — `src/providers/modelPrefix.ts` (new)

```ts
const PREFIX_TO_PROVIDER = { mm: 'minimax', kr: 'kiro', cb: 'codebuddy' } as const;

export interface ParsedModel {
  provider: string | null; // resolved provider when prefixed, else null
  modelName: string;       // part after the prefix, or the whole string when bare
  prefixed: boolean;
}

export function parseModelPrefix(raw: string): ParsedModel;
```

Logic:
- If `raw` contains `/`: split on the **first** `/`.
  - First segment ∈ {mm,kr,cb} → `{ provider: <mapped>, modelName: <rest>, prefixed: true }`.
  - Otherwise → throw `Error('unknown model prefix: <segment>')`.
- No `/` → `{ provider: null, modelName: raw, prefixed: false }`.

### Component 2 — `resolveModel` rewrite (`src/providers/alias.ts`)

1. `const p = parseModelPrefix(requestedName)` (may throw).
2. **Prefixed branch** (`p.prefixed`):
   - `model = getModel(db, p.modelName)` — literal, no alias expansion.
     Missing → throw `unknown model: <requestedName>`.
   - `(model.provider ?? 'minimax') !== p.provider` → throw
     `model <modelName> not available on provider <prefix-provider>`.
   - `!model.enabled` → throw `model disabled: <requestedName>`.
   - resolved provider = `p.provider`.
3. **Bare branch** (`!p.prefixed`):
   - `target = resolveAlias(db, p.modelName)`.
   - `target === p.modelName` (not an alias) → throw `unknown model: <requestedName>`.
   - `model = getModel(db, target)`; missing → throw `unknown model`.
   - `!model.enabled` → throw `model disabled`.
   - resolved provider = `model.provider ?? 'minimax'`.
4. Return `{ upstreamModel: model.upstream_model, requestedModel: requestedName,
   provider, bodyTransform }`. `requestedModel` is the **original** string
   (full prefixed) → satisfies the logging decision. `bodyTransform` unchanged.

Combos are unaffected — still intercepted upstream by `getCombo`.

### Component 3 — call sites

No logic change needed (`handleProxy` peek, `combo.ts`, `kiro.ts`, `codebuddy.ts`
all branch on `resolved.provider`). Verification points:
- A provider-mismatch / unknown-prefix throw on the **real** MiniMax-path
  `resolveModel` call must surface as a clean **400**, the same path the existing
  `unknown model` error uses. Confirm the error mapping in `minimax.ts` returns
  400 for `resolveModel` throws (it does today for unknown model).
- The `peek` try/catch in `handleProxy` continues to swallow and defer to the
  MiniMax path, which then re-throws the canonical 400.

## Error handling

| Input                         | Result                                   |
|-------------------------------|------------------------------------------|
| `kr/<kiro model>`             | route to kiro                            |
| `mm/<minimax model>`          | route to minimax                         |
| `cb/<codebuddy model>`        | route to codebuddy                       |
| `kr/<minimax model>`          | 400 — provider mismatch                  |
| `kr/<unknown>`                | 400 — unknown model                      |
| `xx/foo`                      | 400 — unknown model prefix               |
| bare alias name               | route by resolved model's provider       |
| bare combo name               | combo fallback chain (intercepted early) |
| bare raw model name           | 400 — unknown model (strict)             |

## Testing (TDD, red → green)

- `src/providers/modelPrefix.test.ts`: each prefix maps correctly; bare (no
  slash) → `prefixed:false`; unknown prefix throws; first-slash split only.
- `src/providers/alias.test.ts` (update): prefixed literal lookup (no alias
  expansion); provider-match passes; provider-mismatch throws; bare non-alias
  throws (strict); bare alias resolves and routes by column.
- Proxy integration: `kr/<kiro>` → kiro handler; `mm/<minimax>` → minimax;
  `cb/<cb>` → codebuddy; `kr/<minimax>` → 400; bare alias works; bare raw → 400.

## Docs

- `CLAUDE.md` — document the prefix convention in the provider section.
- `ARCHITECTURE.md` — note prefix-driven resolution in the model-resolution step.

## Out of scope (YAGNI)

- Prefix-overrides-column routing (running any model through any provider).
- Per-prefix default model / wildcard routing.
- Dashboard UI for prefix management (prefixes are static, code-defined).
