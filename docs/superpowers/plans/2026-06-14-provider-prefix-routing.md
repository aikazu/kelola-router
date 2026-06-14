# Provider Prefix Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route requests to upstream providers via an explicit `mm/`, `kr/`, `cb/` prefix in `body.model`, with strict handling of unprefixed names (combos + aliases only).

**Architecture:** A new pure parser (`modelPrefix.ts`) splits the prefix and maps it to a provider. `resolveModel` (`alias.ts`) becomes the single authority: prefixed names do a literal model lookup with provider-match enforcement; bare names resolve only through aliases (combos are intercepted earlier in the proxy). All proxy call sites already branch on `resolved.provider`, so they inherit enforcement unchanged.

**Tech Stack:** TypeScript (strict, no `any`), Hono, better-sqlite3, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-14-provider-prefix-routing-design.md`

---

## File Structure

- **Create** `src/providers/modelPrefix.ts` — pure prefix parser. One responsibility: parse a raw model string into `{ provider, modelName, prefixed }` or throw on unknown prefix.
- **Create** `src/providers/modelPrefix.test.ts` — unit tests for the parser.
- **Modify** `src/providers/alias.ts` — `resolveModel` consumes the parser; adds prefixed/bare branches + provider-match enforcement.
- **Modify** `src/providers/alias.test.ts` — migrate existing bare-name tests to prefixed form; add prefix/strict/mismatch cases.
- **Modify** `src/server.test.ts` — add proxy-level routing assertions (prefix → handler, mismatch → 400).
- **Modify** `CLAUDE.md` + `ARCHITECTURE.md` — document the prefix convention.

---

## Task 1: Prefix parser

**Files:**
- Create: `src/providers/modelPrefix.ts`
- Test: `src/providers/modelPrefix.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/providers/modelPrefix.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseModelPrefix } from './modelPrefix.js';

describe('parseModelPrefix', () => {
  it('parses mm prefix to minimax', () => {
    expect(parseModelPrefix('mm/MiniMax-M3')).toEqual({
      provider: 'minimax',
      modelName: 'MiniMax-M3',
      prefixed: true,
    });
  });

  it('parses kr prefix to kiro', () => {
    expect(parseModelPrefix('kr/claude-opus-4-8')).toEqual({
      provider: 'kiro',
      modelName: 'claude-opus-4-8',
      prefixed: true,
    });
  });

  it('parses cb prefix to codebuddy', () => {
    expect(parseModelPrefix('cb/some-model')).toEqual({
      provider: 'codebuddy',
      modelName: 'some-model',
      prefixed: true,
    });
  });

  it('treats a string with no slash as bare', () => {
    expect(parseModelPrefix('claude-opus-4-8')).toEqual({
      provider: null,
      modelName: 'claude-opus-4-8',
      prefixed: false,
    });
  });

  it('splits on the first slash only', () => {
    expect(parseModelPrefix('kr/org/model')).toEqual({
      provider: 'kiro',
      modelName: 'org/model',
      prefixed: true,
    });
  });

  it('throws on an unknown prefix', () => {
    expect(() => parseModelPrefix('xx/foo')).toThrow(/unknown model prefix: xx/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/providers/modelPrefix.test.ts`
Expected: FAIL — `Cannot find module './modelPrefix.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/providers/modelPrefix.ts`:

```ts
const PREFIX_TO_PROVIDER: Readonly<Record<string, string>> = {
  mm: 'minimax',
  kr: 'kiro',
  cb: 'codebuddy',
};

export interface ParsedModel {
  /** Resolved provider when prefixed, else null. */
  provider: string | null;
  /** Part after the prefix, or the whole string when bare. */
  modelName: string;
  prefixed: boolean;
}

/**
 * Parse a `body.model` string into its provider prefix and model name.
 *
 * - `<mm|kr|cb>/<name>` → prefixed, provider mapped, name is everything after
 *   the first slash.
 * - A string with a slash whose first segment is not a known prefix throws.
 * - A string with no slash is bare (resolved later via combos/aliases).
 */
export function parseModelPrefix(raw: string): ParsedModel {
  const slash = raw.indexOf('/');
  if (slash === -1) {
    return { provider: null, modelName: raw, prefixed: false };
  }
  const head = raw.slice(0, slash);
  const provider = PREFIX_TO_PROVIDER[head];
  if (!provider) {
    throw new Error(`unknown model prefix: ${head}`);
  }
  return { provider, modelName: raw.slice(slash + 1), prefixed: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/providers/modelPrefix.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/modelPrefix.ts src/providers/modelPrefix.test.ts
git commit -m "feat: add model prefix parser (mm/kr/cb)"
```

---

## Task 2: `resolveModel` strict + prefix branches

**Files:**
- Modify: `src/providers/alias.ts:31-64`
- Test: `src/providers/alias.test.ts`

Background: `resolveModel(db, requestedName, _body)` currently does
`resolveAlias` → `getModel` → returns `{ upstreamModel, requestedModel,
provider, bodyTransform }`. We rewrite the resolution head; `bodyTransform`
stays identical.

- [ ] **Step 1: Rewrite the existing tests for strict mode (failing)**

Existing tests resolve bare `MiniMax-M3` directly — that is now invalid (strict:
bare must be a combo or alias). Replace the body of `src/providers/alias.test.ts`
from the `describe('resolveModel', ...)` block onward with the version below.
Also extend `beforeEach` to seed a non-MiniMax model. Final file:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../db/migrations/index.js';
import { upsertAlias } from '../db/repos/aliases.js';
import { disableModel, upsertModel } from '../db/repos/models.js';
import { resolveModel } from './alias.js';
import { clearAliasCache } from './aliasCache.js';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'alias-'));
  db = new Database(join(dir, 't.db'));
  db.pragma('foreign_keys = ON');
  migrate(db);
  upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3' });
  upsertModel(db, { name: 'MiniMax-M2.7', upstream_model: 'MiniMax-M2.7' });
  upsertModel(db, {
    name: 'kiro-claude',
    upstream_model: 'claude-via-kiro',
    provider: 'kiro',
  });
  clearAliasCache();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true });
});

describe('resolveModel — prefixed', () => {
  it('resolves a prefixed minimax model and keeps the full requestedModel', () => {
    const r = resolveModel(db, 'mm/MiniMax-M3', {});
    expect(r.upstreamModel).toBe('MiniMax-M3');
    expect(r.provider).toBe('minimax');
    expect(r.requestedModel).toBe('mm/MiniMax-M3');
  });

  it('resolves a prefixed kiro model', () => {
    const r = resolveModel(db, 'kr/kiro-claude', {});
    expect(r.upstreamModel).toBe('claude-via-kiro');
    expect(r.provider).toBe('kiro');
    expect(r.requestedModel).toBe('kr/kiro-claude');
  });

  it('does NOT expand aliases after a prefix', () => {
    upsertAlias(db, { aliasName: 'opus', upstreamModel: 'MiniMax-M3' });
    clearAliasCache();
    // mm/opus must be a literal model lookup, not the alias.
    expect(() => resolveModel(db, 'mm/opus', {})).toThrow(/unknown model/);
  });

  it('throws on provider mismatch', () => {
    // kiro-claude is a kiro model; routing it via mm/ is a conflict.
    expect(() => resolveModel(db, 'mm/kiro-claude', {})).toThrow(/provider/);
  });

  it('throws on a prefixed unknown model', () => {
    expect(() => resolveModel(db, 'kr/does-not-exist', {})).toThrow(/unknown model/);
  });

  it('throws on a disabled prefixed model', () => {
    disableModel(db, 'MiniMax-M3');
    expect(() => resolveModel(db, 'mm/MiniMax-M3', {})).toThrow(/model disabled/);
  });
});

describe('resolveModel — bare (strict)', () => {
  it('rejects a bare raw model name', () => {
    expect(() => resolveModel(db, 'MiniMax-M3', {})).toThrow(/unknown model/);
  });

  it('resolves a bare alias and returns the original alias as requestedModel', () => {
    upsertAlias(db, { aliasName: 'claude-opus-4-8', upstreamModel: 'MiniMax-M3' });
    clearAliasCache();
    const r = resolveModel(db, 'claude-opus-4-8', {});
    expect(r.upstreamModel).toBe('MiniMax-M3');
    expect(r.provider).toBe('minimax');
    expect(r.requestedModel).toBe('claude-opus-4-8');
  });

  it('routes a bare alias by the target model provider', () => {
    upsertAlias(db, { aliasName: 'kalias', upstreamModel: 'kiro-claude' });
    clearAliasCache();
    const r = resolveModel(db, 'kalias', {});
    expect(r.provider).toBe('kiro');
  });

  it('throws for an unknown alias target', () => {
    db.pragma('foreign_keys = OFF');
    db.prepare(`INSERT INTO model_aliases (alias_name, upstream_model) VALUES (?, ?)`).run(
      'broken',
      'does-not-exist'
    );
    db.pragma('foreign_keys = ON');
    clearAliasCache();
    expect(() => resolveModel(db, 'broken', {})).toThrow(/unknown model/);
  });

  it('throws for a disabled model reached via a bare alias', () => {
    upsertAlias(db, { aliasName: 'opus', upstreamModel: 'MiniMax-M3' });
    clearAliasCache();
    disableModel(db, 'MiniMax-M3');
    expect(() => resolveModel(db, 'opus', {})).toThrow(/model disabled/);
  });
});

describe('resolveModel — unknown prefix', () => {
  it('throws for a non-provider slash prefix', () => {
    expect(() => resolveModel(db, 'xx/foo', {})).toThrow(/unknown model prefix/);
  });
});

describe('resolveModel — bodyTransform', () => {
  it('injects adaptive thinking for known models when client omits thinking', () => {
    const r = resolveModel(db, 'mm/MiniMax-M3', {});
    const body: Record<string, unknown> = {};
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: 'adaptive' });
  });

  it('preserves client-supplied thinking', () => {
    const r = resolveModel(db, 'mm/MiniMax-M3', {});
    const body: Record<string, unknown> = { thinking: { type: 'enabled' } };
    r.bodyTransform(body);
    expect(body.thinking).toEqual({ type: 'enabled' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/providers/alias.test.ts`
Expected: FAIL — prefixed inputs resolve to `unknown model` (no prefix handling yet) and bare `MiniMax-M3` still resolves instead of throwing.

- [ ] **Step 3: Implement the rewrite**

In `src/providers/alias.ts`, add the import at the top (after the existing
`resolveAlias` import on line 4):

```ts
import { parseModelPrefix } from './modelPrefix.js';
```

Replace the body of `resolveModel` (lines 31-64, from `export function
resolveModel` through its closing brace) with:

```ts
export function resolveModel(
  db: Database.Database,
  requestedName: string,
  _body?: AnthropicBody | OpenAIBody
): ResolvedModel {
  const parsed = parseModelPrefix(requestedName);

  let model: Model | null;
  let provider: string;

  if (parsed.prefixed) {
    // Literal lookup — no alias expansion. Prefix asserts the provider.
    model = getModel(db, parsed.modelName);
    if (!model) throw new Error(`unknown model: ${requestedName}`);
    const modelProvider = model.provider ?? 'minimax';
    if (modelProvider !== parsed.provider) {
      throw new Error(
        `model ${parsed.modelName} not available on provider ${parsed.provider}`
      );
    }
    provider = parsed.provider as string;
  } else {
    // Bare: must be an alias (combos are intercepted earlier in the proxy).
    const target = resolveAlias(db, parsed.modelName);
    if (target === parsed.modelName) throw new Error(`unknown model: ${requestedName}`);
    model = getModel(db, target);
    if (!model) throw new Error(`unknown model: ${requestedName}`);
    provider = model.provider ?? 'minimax';
  }

  if (!model.enabled) throw new Error(`model disabled: ${requestedName}`);

  const minimaxSettings = getSetting<{ m3DefaultMaxCompletionTokens?: number }>(db, 'minimax');
  const m3DefaultMax = minimaxSettings?.m3DefaultMaxCompletionTokens ?? 131072;
  const resolvedModel = model;

  return {
    upstreamModel: resolvedModel.upstream_model,
    requestedModel: requestedName,
    provider,
    bodyTransform: (b: AnthropicBody | OpenAIBody) => {
      if (ADAPTIVE_THINKING_MODELS.has(resolvedModel.upstream_model) && b.thinking === undefined) {
        b.thinking = { type: 'adaptive' };
      }
      if (
        resolvedModel.name === 'MiniMax-M3' &&
        b.max_completion_tokens === undefined &&
        b.max_tokens === undefined
      ) {
        b.max_completion_tokens = m3DefaultMax;
      }
      if (b.thinking && b.reasoning_split === undefined) {
        b.reasoning_split = true;
      }
    },
  };
}
```

Note: `resolvedModel` is a non-null `const` copy so the `bodyTransform` closure
captures a `Model` (not `Model | null`) and satisfies strict null checks.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/providers/alias.test.ts src/providers/modelPrefix.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/providers/alias.ts src/providers/alias.test.ts
git commit -m "feat: strict prefix-aware model resolution"
```

---

## Task 3: Proxy routing integration tests

**Files:**
- Modify: `src/server.test.ts`

Goal: assert the proxy routes by prefix and surfaces 400 on mismatch/unknown
prefix. Reuse the existing server test harness in `src/server.test.ts` (it
already seeds `provider: 'codebuddy'` models around lines 459/473 and mocks
`fetch`). Follow that file's existing setup pattern (DB temp path, `resetDb()`,
`Origin` header rules for any admin POSTs — proxy `/v1/*` calls need a valid
client key bearer).

- [ ] **Step 1: Write the failing tests**

Add this block near the other proxy routing tests in `src/server.test.ts`
(adapt the harness helpers — client-key creation, `app.request`, fetch mock — to
match the surrounding tests in the file; the assertions below are the contract):

```ts
describe('provider prefix routing', () => {
  it('routes mm/ to the minimax path', async () => {
    // seed an enabled minimax model `MiniMax-M3` (default provider).
    // POST /v1/chat/completions with body.model = 'mm/MiniMax-M3'.
    // Expect: upstream fetch hit with the MiniMax URL; response 200.
  });

  it('routes kr/ to the kiro handler', async () => {
    // seed model { name: 'kiro-claude', upstream_model: 'claude-via-kiro', provider: 'kiro' }
    // POST with body.model = 'kr/kiro-claude'.
    // Expect: kiro path taken (assert via the kiro upstream mock or a kiro-specific marker).
  });

  it('returns 400 on provider mismatch', async () => {
    // seed kiro model `kiro-claude`.
    // POST with body.model = 'mm/kiro-claude'.
    // Expect: status 400, error body matches /provider/.
  });

  it('returns 400 on unknown prefix', async () => {
    // POST with body.model = 'xx/foo'.
    // Expect: status 400, error matches /unknown model prefix/.
  });

  it('returns 400 on a bare raw model name (strict)', async () => {
    // seed `MiniMax-M3`. POST with body.model = 'MiniMax-M3' (no prefix, not an alias).
    // Expect: status 400, error matches /unknown model/.
  });
});
```

Implement each test body using the file's existing helpers. If the harness lacks
a kiro/codebuddy upstream mock, assert routing via the error path instead (e.g.
a kiro model with no kiro account configured yields a deterministic non-minimax
error), keeping the assertion on the routing decision, not the upstream.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server.test.ts -t "provider prefix routing"`
Expected: FAIL (assertions unmet before wiring is verified) or compile error if
helpers referenced before adaptation.

- [ ] **Step 3: Make them pass**

No production code change is expected — Task 2 already routes correctly. Fix the
test bodies until the routing contract holds. If a test reveals the
`handleProxy` peek swallows a mismatch and wrongly falls through to MiniMax,
that is a real bug: the canonical error must come from the real `resolveModel`
call at `src/proxy/minimax.ts:213` (wrapped by the try/catch at lines 231-232
returning 400). Confirm the mismatch input reaches that path and returns 400.

- [ ] **Step 4: Run the full proxy suite**

Run: `npx vitest run src/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server.test.ts
git commit -m "test: proxy prefix routing and strict bare-name rejection"
```

---

## Task 4: Full suite + lint gate

**Files:** none (verification only)

- [ ] **Step 1: Run the whole server suite**

Run: `npm test`
Expected: PASS. If other suites used bare model names that are now strict-invalid
(e.g. combos/aliases referencing bare provider models, or fixtures POSTing bare
names), fix them to use a `mm/`/`kr/`/`cb/` prefix or an alias. Re-run until green.

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit any fixups**

```bash
git add -A
git commit -m "test: migrate remaining bare model names to prefixed form"
```

(Skip the commit if Step 1 needed no changes.)

---

## Task 5: Docs

**Files:**
- Modify: `CLAUDE.md`
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Update CLAUDE.md**

In the "Upstream providers" / provider section of `CLAUDE.md`, add:

```markdown
## Model prefix routing

Requests select a provider by an explicit prefix on `body.model`:

| Prefix | Provider    | Example                  |
|--------|-------------|--------------------------|
| `mm/`  | MiniMax     | `mm/MiniMax-M3`          |
| `kr/`  | Kiro        | `kr/claude-via-kiro`     |
| `cb/`  | CodeBuddy   | `cb/<model>`             |

- Prefixed names are looked up **literally** (no alias expansion) and the model's
  `provider` column MUST match the prefix, else 400.
- **Unprefixed** names resolve **only** as a combo name or an alias (strict). A
  bare raw model name is rejected with 400 — add an alias or use a prefix.
- An unknown prefix (`xx/...`) is a 400 (`unknown model prefix`).
- `requested_model` logs the full prefixed string verbatim.
```

- [ ] **Step 2: Update ARCHITECTURE.md**

In the model-resolution step description (the `parseBody` + model resolution step
of the per-request path), add a sentence:

```markdown
Model resolution runs through `parseModelPrefix` (`src/providers/modelPrefix.ts`):
a `mm/`|`kr/`|`cb/` prefix selects the provider via a literal, provider-matched
lookup; unprefixed names resolve only against combos and aliases (strict).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md ARCHITECTURE.md
git commit -m "docs: document provider prefix routing"
```

---

## Self-Review Notes

- **Spec coverage:** parser (Task 1), strict + prefixed + mismatch + literal-no-alias + logging via `requestedName` (Task 2), proxy routing + 400 paths (Task 3), suite/lint gate (Task 4), docs (Task 5). All spec sections mapped.
- **Type consistency:** `parseModelPrefix` / `ParsedModel { provider, modelName, prefixed }` used identically in Tasks 1–2. `resolveModel` return shape (`upstreamModel`, `requestedModel`, `provider`, `bodyTransform`) unchanged from the existing `ResolvedModel` interface.
- **Strict null:** `resolvedModel` const copy guards the `bodyTransform` closure against `Model | null`.
- **Combos:** untouched — intercepted by `getCombo` before `resolveModel`; bare-only by design.
