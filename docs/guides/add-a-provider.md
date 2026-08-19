# Add an Upstream Provider

Add a third upstream provider alongside MiniMax and Kiro. Examples: Azure OpenAI, AWS Bedrock, a self-hosted llama.cpp gateway. The router already has a two-provider architecture (provider key on `accounts` and `models`, branch in `handleProxy`); this playbook shows the integration points.

## Goal

A new provider `foo` that:
- Has its own `provider='foo'` value on `accounts` and `models` rows
- Authenticates with `accounts.api_key` (or its own column if it needs a different credential)
- Sends requests via a dedicated module under `src/providers/foo/`
- Streams responses back as OpenAI and/or Anthropic SSE
- Surfaces errors through the existing `checkFallbackError` pipeline
- Is selectable in the dashboard and the CLI seed scripts

## Prerequisites

- Read [`ARCHITECTURE.md`](../../ARCHITECTURE.md): module map + state machines
- Read [`AGENTS.md`](../../AGENTS.md): proxy pipeline overview + conventions
- Read the existing Kiro provider as a reference implementation: `src/providers/kiro/`
- Have a working dev env: `npm run dev` + a fresh test DB

## File map

```
src/
├── providers/
│   └── foo/                       NEW
│       ├── auth.ts                ensure + refresh credentials (mirror kiro/auth.ts)
│       ├── transform.ts           build outbound body (client format → foo format)
│       ├── stream.ts              parse foo stream → OpenAI/Anthropic SSE
│       ├── upstream-fetch.ts       fetch w/ provider-specific quirks
│       └── index.ts               executeFoo (orchestrator)
├── proxy/
│   └── foo.ts                     NEW: handleFooProxy, parallel to kiro.ts
├── db/
│   ├── repos/
│   │   └── accounts.ts            EXTEND: add `foo` to the `provider` enum + helpers
│   └── migrations/
│       └── 00X-foo.ts             NEW: additive columns on `accounts` if needed
├── api/admin/
│   └── accounts.ts                EXTEND: add `POST /api/admin/accounts/foo` if foo needs its own auth flow
├── scripts/
│   ├── seed-foo-models.ts         NEW: upsert builtin foo models
│   └── add-foo-account.ts         NEW: CLI to add a foo account
└── server.ts                      EXTEND: route `/v1/*` requests for foo provider to `handleFooProxy`
```

## Steps

### 1. Add the provider enum

**File:** `src/db/repos/accounts.ts`

Find the `ProviderName` type:
```ts
export type ProviderName = 'minimax' | 'kiro';
```

Extend it:
```ts
export type ProviderName = 'minimax' | 'kiro' | 'foo';
```

Add a helper if foo needs a different default base URL:
```ts
export function getFooBaseUrl(): string {
  return process.env.FOO_BASE_URL ?? 'https://api.foo.example/v1';
}
```

**Why:** Every downstream type/check needs the new variant.

### 2. Add a migration (only if foo needs new columns)

**File:** `src/db/migrations/00X-foo.ts` (new)

```ts
import type Database from 'better-sqlite3';

export const id = '006-foo';
export const up = (db: Database.Database): void => {
  // Example: add a refresh_token column for foo
  const cols = db.prepare(`PRAGMA table_info(accounts)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === 'foo_refresh_token')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN foo_refresh_token TEXT`);
  }
};
```

Register in `src/db/migrations/index.ts`:
```ts
import { id as m006, up as up006 } from './006-foo.js';
// ...
const migrations = [
  // ...existing
  { id: m006, up: up006 },
];
```

**Why:** Only do this if foo needs state that `accounts.api_key` can't hold (refresh tokens, region, profile ARN, etc.).

### 3. Implement auth

**File:** `src/providers/foo/auth.ts` (new)

Mirror `src/providers/kiro/auth.ts`:
- `ensureAccessToken(db, account)`: returns a valid bearer, refreshing if needed
- `refreshFooToken(refreshToken: string)`: POST to foo's token endpoint
- Cache the token in `accounts.access_token` + `accounts.token_expires_at`

**Why:** Auth is isolated so the proxy handler stays clean.

### 4. Implement the request transform

**File:** `src/providers/foo/transform.ts` (new)

Convert an OpenAI chat-completions body to foo's wire format. The function signature should mirror `buildKiroPayload`:
```ts
export function buildFooPayload(
  openaiBody: ChatCompletionRequest,
  account: Account
): FooRequest
```

Things to handle:
- System / tool messages folded into the user turn (if foo doesn't have a system role)
- Image content blocks (if foo supports vision)
- Stop sequences, temperature, max_tokens
- Tool / function definitions (if foo has tool use)
- Stream flag: output format must include a stream indicator

**Why:** Each provider has its own quirks. Keeping the transform isolated makes it testable.

### 5. Implement the response stream

**File:** `src/providers/foo/stream.ts` (new)

If foo speaks SSE, parse it into OpenAI chunks and a buffered `chat.completion`. If foo speaks a binary protocol (like Kiro's event-stream), see `src/providers/kiro/eventstream.ts` + `assembler.ts` + `anthropic-sse.ts` for the three-stage pattern: raw frames → OpenAI SSE → optional Anthropic SSE.

The exported functions should be:
```ts
export function executeFoo(
  db: Database.Database,
  account: Account,
  body: ChatCompletionRequest
): Promise<{ stream: ReadableStream, usage: Promise<Usage> }>
```

**Why:** Same shape as `executeKiro` so `handleFooProxy` can swap it in cleanly.

### 6. Write `handleFooProxy`

**File:** `src/proxy/foo.ts` (new)

Copy `src/proxy/kiro.ts` and adjust:
- Import the foo module instead of kiro
- Rename `handleKiroProxy` → `handleFooProxy`
- Keep the same consoleBus emissions: `start`, `account`, `transport`, `done`, `error`
- Use `listEnabledAccountsByProvider(db, 'foo')` (already in `accounts.ts`; confirm it supports a string param)
- Use `getSetting(db, 'selection.foo')` for selection mode
- Apply `applyAccountError` on the same error class as kiro
- Return the response in the client's original format (OpenAI or Anthropic)

**Why:** `server.ts` routes by `model.provider`; the proxy handlers are interchangeable.

### 7. Wire it into `server.ts`

**File:** `src/server.ts`

Find the place where `handleKiroProxy` is invoked (search for `provider === 'kiro'` or `kiro.ts`). Add a parallel branch:

```ts
import { handleFooProxy } from './proxy/foo.js';
// ...
if (resolved.provider === 'kiro') {
  return handleKiroProxy(c, format, upstreamPath);
}
if (resolved.provider === 'foo') {
  return handleFooProxy(c, format, upstreamPath);
}
// existing minimax + combo path
```

**Why:** The branch in `handleProxy` (or its proxy/ subdir equivalent) is the single dispatch point.

### 8. Add CLI scripts

**Files:** `scripts/seed-foo-models.ts` (new) + `scripts/add-foo-account.ts` (new)

Mirror `scripts/seed-kiro-models.ts` and `scripts/add-account.ts` (unified, `--provider kiro`). Add the new scripts to `package.json` `scripts` block:

```json
"seed-foo-models": "tsx scripts/seed-foo-models.ts",
"add-foo-account": "tsx scripts/add-foo-account.ts"
```

**Why:** The dashboard covers the happy path, but the CLI scripts are referenced in the README + docs/.

### 9. Add the dashboard

**File:** `client/src/pages/Accounts.tsx`

The Accounts page already renders one card per provider. Add a `<FooCard />` parallel to `<KiroCard />` and `<MinimaxCard />`. The `SelectionControls` component takes a `provider` prop; pass `'foo'`.

If foo needs its own auth UI (device code, manual paste, etc.), add a new `KiroDeviceFlow`-style form under `client/src/components/FooAuthForm.tsx` and a hook at `client/src/hooks/useFooAuth.ts`.

**Why:** Provider-specific UIs are isolated to one card. The rest of the dashboard (models, usage, quota) works as-is once the account exists.

### 10. Add docs

**File:** `docs/minimax-reference/` is a misnomer at this point. Rename later. For now, add a `docs/foo/` directory with at minimum:
- `docs/foo/wire-format.md`: capture foo's exact request/response shape from real traffic
- `docs/foo/auth.md`: token lifecycle, refresh URL, expiry buffer
- Update [`MEMORY.md`](../../MEMORY.md) to add a link to the new guides

**Why:** The Kiro wire format was reverse-engineered (`docs/notes/kiro-cli-reverse-engineering.md`). Do the same for foo and write it down so the next contributor doesn't start from zero.

## Test

```bash
# Typecheck
npm run typecheck
cd client && npm run typecheck && cd ..

# Unit tests (your new modules ship with tests)
npm test -- foo
npx vitest run src/proxy/foo.test.ts
npx vitest run src/providers/foo/

# Integration test: end-to-end through the Hono app
npx vitest run src/proxy/foo-integration.test.ts
```

## Commit

```bash
git add src/providers/foo/ src/proxy/foo.ts src/db/repos/accounts.ts \
        src/db/migrations/006-foo.ts src/db/migrations/index.ts \
        src/api/admin/accounts.ts \
        src/server.ts scripts/seed-foo-models.ts scripts/add-foo-account.ts \
        package.json package-lock.json \
        client/src/pages/Accounts.tsx client/src/components/FooAuthForm.tsx \
        client/src/hooks/useFooAuth.ts docs/foo/ MEMORY.md

git commit -m "feat(foo): add foo upstream provider

Wire the foo provider into the proxy pipeline. New module
src/providers/foo/ holds auth + transform + stream; src/proxy/foo.ts
is the handler. Provider enum extended to 'foo'. Additive migration
00X-foo for any extra account columns. Dashboard Accounts page gains
a FooCard parallel to KiroCard / MiniMaxCard.

Wire format reverse-engineered from real traffic; see docs/foo/wire-format.md.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Checklist

- [ ] `ProviderName` extended to `'foo'`
- [ ] Migration `00X-foo.ts` written + registered (only if needed)
- [ ] `src/providers/foo/auth.ts` with `ensureAccessToken` + refresh
- [ ] `src/providers/foo/transform.ts` with `buildFooPayload`
- [ ] `src/providers/foo/stream.ts` with response assembly
- [ ] `src/proxy/foo.ts` with `handleFooProxy`
- [ ] `src/server.ts` dispatches to `handleFooProxy`
- [ ] `scripts/seed-foo-models.ts` + `scripts/add-foo-account.ts` + `package.json` entries
- [ ] `client/src/pages/Accounts.tsx` has a `<FooCard />`
- [ ] Unit + integration tests green
- [ ] `docs/foo/wire-format.md` + `docs/foo/auth.md`
- [ ] `MEMORY.md` updated with new links
- [ ] `npm run typecheck` green
- [ ] `cd client && npm run typecheck` green

## See also

- [`../reference/db-tables.md`](../reference/db-tables.md): `accounts` table schema
- [`../reference/admin-api-routes.md`](../reference/admin-api-routes.md): admin endpoint patterns
- [`../adr/`](../adr/): past provider decisions
- [`../../AGENTS.md`](../../AGENTS.md): proxy pipeline overview
