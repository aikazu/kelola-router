# AGENTS.md

How AI coding agents (Claude Code, Cursor, Aider, etc.) should work in this repository. Read this **before** touching code. Humans may also find the conventions section useful — see `CONTRIBUTING.md` for the human-facing workflow.

## TL;DR

- **TDD is non-negotiable.** Red test → green impl → commit. No "add tests later".
- **No `any`.** `tsconfig.json` is strict; `biome.json` warns on `noExplicitAny`.
- **`const` over `let`**, early returns over nested `if/else`.
- **No push without asking.** User confirms push/PR.
- **Commit after every meaningful change** (~300 LOC max per commit, conventional commits).
- **Always run before commit**: `npm test` + `npm run typecheck` + `cd client && npm run typecheck` (root `tsc` skips `client/`).
- **Read first**: this file → `CLAUDE.md` (proxy pipeline overview) → `ARCHITECTURE.md` (deep dive) → `MEMORY.md` (knowledge index).

## Stack at a glance

- **Server**: Hono on Node 20+, `better-sqlite3` (WAL), `pino` logger, `undici` (with optional `socks-proxy-agent`), `ulid` for IDs. TypeScript strict mode.
- **Client**: Preact SPA, Vite, `@tanstack/react-query`, `preact-router`, hash-routed. `npm run dev:client` lives in `client/` subdir with its own `package.json` and typecheck.
- **Tests**: Vitest. Server tests live next to source as `*.test.ts`. Client tests in `client/src/__tests__/`.
- **Lint/format**: Biome (`biome.json`). Single quotes, 2-space indent, 100-col soft wrap, `es5` trailing commas. Client dir is excluded (`!client` in `files.includes`).

## Project-specific conventions

### TDD workflow

1. Find or write the failing test first. Most modules already have `*.test.ts` siblings — read those to understand the contract.
2. Run the test file (or `npx vitest run path/to/file.test.ts -t "name"`) to confirm it fails for the **right reason**.
3. Write the minimum code to make it pass.
4. Run the full suite before commit: `npm test`. Server-only changes: skip `test:client`; client-only: skip root `test`. Both: run both.
5. Commit with a conventional-commit message. Reference the test name in the body when it clarifies intent.

### TypeScript rules

- `strict` mode; no `any`. If a third-party type forces `any`, wrap it in a typed shim and explain why in a comment.
- `import type` for type-only imports (biome warns otherwise).
- Prefer `const` and immutability. `let` only when the value truly changes (e.g. accumulator in a tight loop).
- `?? null` is the project idiom for `better-sqlite3` `undefined` → `null` coercion (tests rely on it).

### Test patterns

- **Isolate the DB per test**: set `process.env.ROUTER_DB_PATH` to a fresh `mkdtempSync` path in `beforeEach`, and call `resetDb()` from `src/server.ts` to reset the Hono app's DB handle.
- **Mock upstream fetch** with `vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(...))`. Use `mockImplementation` (not `mockResolvedValueOnce`) when a test calls fetch multiple times — `Response` bodies are single-read.
- **CSRF**: integration tests for `/admin/*` POSTs must set `Origin` matching `Host` or omit `Origin` entirely. The `csrfGuard` middleware blocks cross-origin POSTs.
- **Settings cache**: `getSetting` caches for 1s. Call `clearCacheForDb(db)` from `src/db/repos/settings.ts` when changing settings mid-test.

### Commit conventions

Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`). Subject ≤ 72 chars. Body explains *why*, not *what* (the diff shows what). Reference the issue or test name in the body when relevant.

```bash
# good
git commit -m "feat(accounts): per-key budget cap

Add budget_usd_daily column to client_keys + 429 short-circuit in
requireApiKey middleware. Covers single-user case; per-key rate limit
in follow-up."

# bad
git commit -m "fix bug"
```

### Refactor conventions

- Extract helpers to the same directory before the file grows past ~500 LOC. The codebase already follows this pattern — see `src/proxy/{helpers,minimax,kiro,combo}.ts` and `src/accounts/{selection,state,locks,backoff,errorRules}.ts`.
- When extracting a function, move the related tests with it. Never leave tests against the old path.
- Refactor commits must keep `npm test` + `npm run typecheck` green at every commit. No "wip: refactor halfway" commits.

## What to read first, in order

1. **`AGENTS.md`** (this file) — workflow + conventions.
2. **`CLAUDE.md`** — proxy pipeline overview, two-tier auth, provider quirks, schema.
3. **`ARCHITECTURE.md`** — module map, state machines, data flow.
4. **`MEMORY.md`** — pointer to all knowledge resources (skills, KB, guides, ADRs, reference).

## Boundaries

- **Do not** push branches or open PRs without explicit user confirmation.
- **Do not** rewrite `CLAUDE.md` without consulting the user — it is the agent's primary auto-load.
- **Do not** introduce new dependencies without a discussion (user reviews `package.json` changes).
- **Do not** skip the typecheck step. The root `tsc --noEmit` covers `src/` only — `cd client && npm run typecheck` is a separate step.

## Common tasks → see the guides

- Add a new upstream provider (Anthropic, Azure, etc.) → `docs/guides/add-a-provider.md` (when written)
- Add an admin API endpoint → `docs/guides/add-an-admin-endpoint.md` (when written)
- Add a dashboard page → `docs/guides/add-a-dashboard-page.md` (when written)
- Add a DB migration → `docs/guides/add-a-migration.md` (when written)
- Debug a failed request → `docs/guides/debug-a-failed-request.md` (when written)

If a guide is missing for a task you need, do the work, then write the guide as a follow-up commit. The first PR to do a thing is also the first PR to document the thing.
