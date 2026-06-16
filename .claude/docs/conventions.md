# Conventions

> Terse code-level rules. For workflow + TDD see `../../AGENTS.md`. For commit/PR process see `../../CONTRIBUTING.md`.

## Why this exists

When an agent writes a single line of code, the line should pass `biome check` + `tsc --noEmit` + the existing test suite on the first try. This file distills the rules that catch the most issues in code review. Read once, apply always.

## TypeScript (`tsconfig.json`)

- `strict: true` is on. No implicit `any`. No implicit `this`. Strict null checks. No fall-through cases.
- **`no `any`**. Wrap forced-`any` (third-party type gaps) in a typed shim with a comment explaining why.
- `import type` for type-only imports. Biome warns on the bare `import` form.
- `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`. ESM with `.js` extensions in import paths.
- `?? null` to coerce `better-sqlite3` `undefined` to `null` at repo boundaries.

## Biome (`biome.json`)

- Single quotes, 2-space indent, 100-col soft wrap, `es5` trailing commas, `lf` line endings, semicolons on.
- `noExplicitAny: warn` — combine with `tsc` to enforce no-`any`.
- `noDebugger: error`.
- Client dir (`client/`) is excluded from biome's `files.includes`. The client has its own `package.json` + lint setup (none currently — add when needed).
- Run `npm run lint:fix` before commit. Re-read the diff before `git add` — biome sometimes does things you didn't ask for.

## Naming

| Item | Convention | Example |
|---|---|---|
| Files (server) | `kebab-case.ts` (one per concept) | `errorRules.ts`, `pipeWithUsage.ts` |
| Files (client) | `PascalCase.tsx` (one per component) | `AccountsTable.tsx`, `KiroAuthForm.tsx` |
| React components | `PascalCase`, default export matching filename | `export function Accounts() {}` |
| Functions | `camelCase`, verb-first | `selectAccount`, `applyAccountError` |
| Types / interfaces | `PascalCase`, no `I` prefix | `Account`, `SelectionResult` |
| Constants | `camelCase` for runtime, `SCREAMING_SNAKE_CASE` for compile-time | `BACKOFF_MAX_LEVEL` |
| DB columns | `snake_case` | `rate_limited_until` |
| TypeScript enum values | `kebab-case` strings | `'lowest-backoff'`, `'round-robin'`, `'sticky'` |
| Env vars | `SCREAMING_SNAKE_CASE` | `ROUTER_DB_PATH`, `MINIMAX_REGION` |
| Settings keys | `kebab-case` with dots for nesting | `caveman`, `selection.minimax`, `transport.proxyFailureMode` |
| Provider names | `lowercase` (short identifier) | `minimax`, `kiro` |
| Model names | `PascalCase-Kebab` | `MiniMax-M3`, `claude-sonnet-4-6` |

## Imports

- Order (biome auto-sorts, but write them in this order): external → internal absolute (`src/`) → relative.
- Use `from '../foo.js'` not `from '../foo'` — NodeNext + ESM require the extension.
- Use `import type` for types-only.
- Group by directory, not by file. Don't import 5 functions from the same file with 5 separate `import` lines.

## Functions

- **Early returns** over nested `if/else`. Max 2 levels of indentation in the function body.
- **`const` over `let`**. `let` only for accumulators or state that genuinely changes.
- **Pure functions preferred.** Side effects (DB writes, fetch) live at the boundary (proxy handlers, repo functions).
- **No arrow functions for component declarations** — use `function ComponentName() {}` so it's hoisted + has a name in dev tools.
- **No `void`-prefixed function calls** unless intentionally fire-and-forget. `void foo()` is a code smell; usually you want to `await` or move to an event handler.

## Error handling

- Use `throw new ApiError('code', 'message', status)` for expected errors in admin API routes. Catch with `handleApiError(e)`.
- Use `consoleBus.emit('error', ...)` for proxy errors that the user should see in the Console page.
- `try/catch` around every admin route handler. Required by convention (see `src/api/admin/middleware.ts:handleApiError`).
- **Never** swallow an error silently. If you `catch {}`, write a comment explaining why.

## Logging

- Use `import { log } from '../util/log.js'`. Pino-based, structured JSON in prod.
- `log.info({ key: 'value' }, 'message')` — structured fields first, message second.
- Never `console.log` in `src/`. (Biome's `noConsole: off` is set, but the convention is `log.*`.)
- The one exception: `src/db/migrations/index.ts` uses `console.log` for migration progress because the logger isn't initialized yet.

## Testing

See `../../AGENTS.md` "Test patterns" for the full set. Highlights:

- `process.env.ROUTER_DB_PATH = join(mkdtempSync(...), 't.db')` in `beforeEach`.
- `resetDb()` from `src/server.ts` to reset the Hono app handle.
- Mock `globalThis.fetch` with `vi.spyOn(...)` and `mockImplementation` (not `mockResolvedValueOnce`) for multi-shot.
- `clearCacheForDb(db)` from `src/db/repos/settings.ts` when changing settings mid-test.
- For client tests: `cd client && npm test`. Mock `apiFetch`, not global `fetch`.
- Don't write a test that only verifies the mock — the test should verify the behavior given the mock's response.

## Git

- Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, `perf:`, `style:`. Optional scope: `feat(accounts): …`.
- Subject ≤ 72 chars, body explains *why*.
- One `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer per commit (this is the global project default).
- Branch names: `feat/<scope>-<short>`, `fix/<scope>-<short>`, etc.
- Never push without asking (root `AGENTS.md` Boundaries).

## Gotchas

- **`new Date().toISOString()` is the only acceptable time format** in the codebase. Unix timestamps (s/ms) are not used in app code. The DB stores ISO strings.
- **Don't use `process.env.ROUTER_DB_PATH` directly** — read it via `getDbPath()` from `src/util/env.ts`.
- **Don't call `getDb()` outside `src/server.ts`.** Other modules receive the `db` from the Hono context (`c.get('db')`).
- **Don't import from `src/server.ts` outside `tests/`.** It's the entry point, not a library.
- **Settings are JSON in TEXT.** `getSetting` parses; `setSetting` stringifies. Don't store a raw string.
- **Repo functions return `T | null`**, not `T | undefined`. The repo coerces with `?? null`. Tests rely on this.

## Cross-refs

- [`../../AGENTS.md`](../../AGENTS.md) — workflow + TDD
- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) — git + PR
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — pipeline
- `biome.json`, `tsconfig.json` — tool configs
- [`codebase-map.md`](codebase-map.md) — what to import from where
