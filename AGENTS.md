# AGENTS.md

Single source of truth for working in this repository. Auto-loaded into Claude Code (and any other AI coding agent that reads project context) as the primary reference. **This file replaces what used to live in `CLAUDE.md`** — that file is now a one-paragraph pointer back here.

Humans may also find the conventions section useful — see `CONTRIBUTING.md` for the human-facing workflow.

## Read first, in order

1. **`AGENTS.md`** (this file) — project overview, architecture, workflow, conventions.
2. **[`ARCHITECTURE.md`](ARCHITECTURE.md)** — deep dive: module map, state machines, data flow per request, key invariants.
3. **[`MEMORY.md`](MEMORY.md)** — index of every knowledge resource (skills, KB, guides, ADRs, reference tables).

## TL;DR

- **TDD is non-negotiable.** Red test → green impl → commit. No "add tests later".
- **No `any`.** `tsconfig.json` is strict; `biome.json` warns on `noExplicitAny`.
- **`const` over `let`**, early returns over nested `if/else`.
- **No push without asking.** User confirms push/PR.
- **Commit after every meaningful change** (~300 LOC max per commit, conventional commits).
- **Always run before commit**: `npm test` + `npm run typecheck` + `cd client && npm run typecheck` (root `tsc` skips `client/`).

## Stack at a glance

- **Server**: Hono on Node 20+, `better-sqlite3` (WAL), `pino` logger, `undici` (with optional `socks-proxy-agent`), `ulid` for IDs. TypeScript strict mode.
- **Client**: Preact SPA, Vite, `@tanstack/react-query`, `preact-router`, hash-routed. `npm run dev:client` lives in `client/` subdir with its own `package.json` and typecheck.
- **Tests**: Vitest. Server tests live next to source as `*.test.ts`. Client tests in `client/src/__tests__/`.
- **Lint/format**: Biome (`biome.json`). Single quotes, 2-space indent, 100-col soft wrap, `es5` trailing commas. Client dir is excluded (`!client` in `files.includes`).

## Commands

```bash
npm run dev          # concurrently: server (tsx watch :20137) + client (vite :5173)
npm run dev:server   # backend only (port 20137)
npm run dev:client   # frontend only (cd client && vite, port 5173)
npm run build        # vite build client + tsc -> dist/
npm start            # node dist/server.js
npm test             # vitest run (server)
cd client && npm test           # client SPA tests
npx vitest run path/to/foo.test.ts   # single file
npm run test:watch   # vitest watch mode
npm run typecheck    # tsc --noEmit (strict, no any). NOTE: skips client/ — run `cd client && npm run typecheck` separately.
npm run lint         # biome check .
npm run lint:fix     # biome check --write .
```

Runner: `npm` only (engine: `node>=20`). `package-lock.json` is the lockfile.

CLI scripts (power-user; dashboard covers these):

```bash
npm run add-client-key -- --label myapp
npm run add-account   -- --label "PAYG main" --credit-type payg --api-key mm_xxx
npm run seed-models                # manual MiniMax upsert shortcut (models otherwise auto-seed on account-add)
npm run reset                      # rm db + WAL/SHM sidecars
npm run seed-kiro-models
npm run add-account -- --provider kiro --label kiro1 --refresh-token eyJ...   # + optional --client-id/--client-secret/--region/--profile-arn
npm run add-account -- --provider pioneer --api-key pio_...
```

Docker: `docker build -t kelola-router:latest . && docker compose up -d` (serves from baked `client/dist` on :20137). Prod reverse proxy: `Caddyfile` at repo root.

## Architecture (one-page)

`src/server.ts` — Hono app, ~330 LOC. Middleware: `requireApiKey` (Bearer) for `/v1/*`, `requireAdmin` for `/admin/*`, `verifySameOrigin` CSRF guard on `/admin/*` POSTs.

Per-request path inside `handleProxy` (see `src/proxy/minimax.ts` + `proxy/kiro.ts` + `proxy/codebuddy.ts` + `proxy/pioneer.ts` + `proxy/combo.ts`):

1. `parseBody` + model resolution (alias + thinking + M3 max-completion-tokens)
2. `selectAccount` (state machine: sticky + round-robin w/ step, skips backoff/locked/disabled). Mode + step read per provider from `selection.<provider>` setting.
3. Per-model lock check (returns 429 if locked for this model)
4. `augment` — caveman system-prompt + `cache_control` dual breakpoints
5. RTK compression if enabled
6. `bodyOpenAIToAnthropic` or `bodyAnthropicToOpenAI` per `settings.minimax.upstreamFormat`
7. `upstreamFetch` → SSE pipe via `streaming/pipeWithUsage` or buffered response
8. Format-convert response back to client format
9. `insertRequestLog` (cost, tokens, latency, account_id, client_key_id, `requested_model`)
10. `applyAccountError` — `base_resp.status_code` mapping, backoff, model lock

Deep-dive (module map, state machines, data flow): see [`ARCHITECTURE.md`](ARCHITECTURE.md).

## What this is

`kelola-router` — local-first API router. Single-user self-host. OpenAI + Anthropic compatible proxy, multi-account pool with fallback, prompt caching, model aliases, RTK + Caveman compression, built-in dashboard. SQLite (WAL) for state. Hono on Node 20+.

**Upstream providers** (selected by the `body.model` prefix — see "Model prefix routing"; the resolved model's `provider` column must agree):
- **MiniMax** (default) — [minimax.io](https://minimax.io), API-key bearer, HTTP-JSON.
- **Kiro** (AWS CodeWhisperer / Amazon Q) — OAuth refresh-token auth, AWS event-stream binary protocol, translated to/from OpenAI + Anthropic. See "Kiro provider" below.
- **CodeBuddy** (CodeBuddy.ai) — OpenAI-compatible upstream, API-key bearer. Client request bridged to OpenAI stream and back (OpenAI SSE → Anthropic SSE assembler). Routed via cb/ prefix. See src/proxy/codebuddy.ts + src/providers/codebuddy/.
- **Pioneer** (api.pioneer.ai) — OpenAI-compatible Chat Completions, X-API-Key bearer. Reuses CodeBuddy's OpenAI→Anthropic SSE bridge. Routed via pio/ prefix; models namespaced under pioneer/ to avoid global-unique id collisions. See src/proxy/pioneer.ts + src/providers/pioneer/.

## Two-tier separation

- **`client_keys`** — bearer credentials for clients (Claude Code, hermes-agent). One per app. Per-key usage.
- **`accounts`** — upstream MiniMax/Kiro/CodeBuddy/Pioneer keys. Pool of N for fallback + quota. Each has `credit_type` (`payg` or `token-plan`) + `provider`.

Never mix these. Client never sees upstream keys; upstream never sees client bearers.

## Auth model (3 modes cascading in `requireAdmin`)

1. Session cookie (`kelola_session`) — only if password is set
2. `x-admin-key` header matching `ROUTER_ADMIN_KEY` env (for scripts)
3. Open mode — if no password is set, anyone with the URL gets in

`POST /login` is rate-limited (`src/auth/rateLimit.ts` — 5/15min/IP, in-memory bucket). Set password via dashboard `/admin/settings` (scrypt-hashed, stored in `settings.admin_password`). Sessions in `sessions` table (7-day TTL).

## Model prefix routing

Requests select a provider by an explicit prefix on `body.model`:

| Prefix | Provider    | Example                  |
|--------|-------------|--------------------------|
| `mm/`  | MiniMax     | `mm/MiniMax-M3`          |
| `kr/`  | Kiro        | `kr/claude-sonnet-4-5`   |
| `cb/`  | CodeBuddy   | `cb/<model>`             |
| `pio/` | Pioneer     | `pio/claude-opus-4-8`    |

- Prefixed names are looked up **literally** (no alias expansion) and the model's `provider` column MUST match the prefix, else 400.
- **Unprefixed** names resolve **only** as a combo name or an alias (strict). A bare raw model name is rejected with 400 — add an alias or use a prefix.
- An unknown prefix (`xx/...`) is a 400 (`unknown model prefix`).
- `requested_model` logs the full prefixed string verbatim.
- Parser: `src/providers/modelPrefix.ts`; enforcement: `resolveModel` in `src/providers/alias.ts`.

## MiniMax quirks

- `base_resp.status_code` lives inside the JSON body, not the HTTP status. `src/providers/parseError.ts` extracts it. `src/accounts/errorRules.ts` maps: 1002→backoff, 1008→balance-permanent, 1013→5s, 1027→backoff, 1039→token-limit, 2013→param.
- `MINIMAX_REGION=intl|cn` switches base URL (`src/providers/baseUrl.ts`).
- `reasoning_split` (settings.minimax): when on, M3 returns structured `reasoning_content` instead of `<think>` tags in content.

## Kiro provider

Kiro = AWS CodeWhisperer / Amazon Q. Branched off `handleProxy` in `src/proxy/kiro.ts` when the resolved model's `provider === 'kiro'`. Auth via OAuth refresh token (stored in `accounts.api_key`); short-lived bearer cached in `accounts.access_token` and refreshed by `providers/kiro/auth.ts`. Request/response go through an AWS event-stream binary framing layer (`providers/kiro/eventstream.ts` → `assembler.ts` for OpenAI SSE, `anthropicSse.ts` for native Anthropic Messages SSE). Account import supports device code (Builder ID / IDC), auto-import from Kiro IDE (`~/.aws/sso/cache`), or manual paste. See `docs/notes/kiro-cli-reverse-engineering.md` for the wire format reverse-engineering notes.

## Dashboard

`client/` — standalone Preact SPA (Vite + preact-router + @tanstack/react-query), served as static assets from `client/dist/` (baked in Docker build, copied to runtime). NOT server-rendered; the Hono app exposes a JSON API under `/api/admin/*` that the SPA consumes via `client/src/lib/api.ts`. Pages: Overview, Usage, ClientKeys, Accounts, Aliases, Models, Combos, Quota, Transports, Settings, Login, RequestDetail, Console, NotFound. Theme: Obsidian Gold (`#0a0a0a` canvas + `#c9a352` accent, Fraunces/Inter/JetBrains Mono).

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
- Prefer `const` and immutability. `let` only when the value truly changes (e.g. accumulator in a tight loop). Never `var`.
- `?? null` is the project idiom for `better-sqlite3` `undefined` → `null` coercion (tests rely on it).
- One responsibility per function; max ~40 lines; max 3-4 params (group related ones into an object). Return early.
- Discriminated unions over enum sprawl. Branded types for domain IDs when confusion is possible.
- No commented-out code in committed files. TODO format: `// TODO(username): description — YYYY-MM-DD`.

### Test patterns

- **Isolate the DB per test**: set `process.env.ROUTER_DB_PATH` to a fresh `mkdtempSync` path in `beforeEach`, and call `resetDb()` from `src/server.ts` to reset the Hono app's DB handle.
- **Mock upstream fetch** with `vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(...))`. Use `mockImplementation` (not `mockResolvedValueOnce`) when a test calls fetch multiple times — `Response` bodies are single-read.
- **CSRF**: integration tests for `/admin/*` POSTs must set `Origin` matching `Host` or omit `Origin` entirely. The `csrfGuard` middleware blocks cross-origin POSTs.
- **Settings cache**: `getSetting` caches for 1s. Call `clearCacheForDb(db)` from `src/db/repos/settings.ts` when changing settings mid-test.

### Commit conventions

Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, `perf:`, `build:`, `ci:`). Subject ≤ 72 chars. Body explains *why*, not *what* (the diff shows what). One logical unit per commit — don't bundle unrelated changes. WIP: prefix with `wip:`. Reference the issue or test name in the body when relevant.

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

## Global rules (mirror of user-global CLAUDE.md)

These come from the user's global Claude config and apply here unless this file overrides them. They are listed here so contributors see them without having to chase the global file.

- **Language**: communication with the user in Indonesian. Code, comments, commit messages, logs in English. Bilingual exception: user-facing error messages may mix Indonesian (headline) + English (technical detail).
- **Git**: `git` for everything. Conventional Commits. One logical unit per commit (already covered above). Never push, force-push, or open a PR without explicit user confirmation. Never rewrite published history (`git rebase` on pushed branches, `git reset --hard` on shared branches).
- **Editing**: minimal targeted changes. Mimic existing patterns. Read surrounding context before editing. Reference code in chat as `file_path:line_number`.
- **TDD**: Red-Green-Refactor. Don't skip the red step. Bug fixes: write a failing test that reproduces the bug first (already covered above).
- **TypeScript**: `strict: true`, no `any` (already covered). `const` over `let`; never `var`. Early returns. Pure functions; isolate side effects. Branded types for domain IDs.
- **Naming**: `camelCase` (vars/funcs/methods), `PascalCase` (types/classes/components/files containing them), `UPPER_SNAKE_CASE` (module constants + env vars), `kebab-case` (non-component files / URLs / CLI flags). Booleans: `is*` / `has*` / `can*` / `should*`. Avoid abbreviations (`userId` not `uid`).
- **Functions**: one responsibility, max ~40 lines, max 3-4 params, early returns (already covered).
- **Comments**: explain WHY, not WHAT. TODO format: `// TODO(username): description — YYYY-MM-DD`. No commented-out code.
- **Quality gates**: all of `npm test` + `cd client && npm test` + `npm run typecheck` + `cd client && npm run typecheck` + `npm run lint` must pass before claiming "done".

## Boundaries

- **Do not** push branches or open PRs without explicit user confirmation.
- **Do not** rewrite `AGENTS.md` without consulting the user — it is the agent's primary auto-load.
- **Do not** introduce new dependencies without a discussion (user reviews `package.json` changes).
- **Do not** skip the typecheck step. The root `tsc --noEmit` covers `src/` only — `cd client && npm run typecheck` is a separate step.

## Common tasks → see the guides & skills

- Add a new upstream provider (Anthropic, Azure, etc.) → `docs/guides/add-a-provider.md`
- Add an admin API endpoint → `docs/guides/add-an-admin-endpoint.md`
- Add a dashboard page → `docs/guides/add-a-dashboard-page.md`
- Add a DB migration → `docs/guides/add-a-migration.md`
- Debug a failed request → `docs/guides/debug-a-failed-request.md`
- Ship a release → `docs/guides/ship-a-release.md`
- Sync docs with live code (audit staleness after shipping) → `.claude/skills/sync-docs/SKILL.md` (skill only; no separate guide — meta maintenance task)

If a guide is missing for a task you need, do the work, then write the guide as a follow-up commit. The first PR to do a thing is also the first PR to document the thing.
