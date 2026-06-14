# CLAUDE.md

This file is auto-loaded by Claude Code at session start. Humans may also find it useful as a one-page overview. For depth, see [`ARCHITECTURE.md`](ARCHITECTURE.md) and the knowledge resources in [`MEMORY.md`](MEMORY.md). For workflow/conventions see [`AGENTS.md`](AGENTS.md).

## What this is

`kelola-router` — local-first API router. Single-user self-host. OpenAI + Anthropic compatible proxy, multi-account pool with fallback, prompt caching, model aliases, RTK + Caveman compression, built-in dashboard. SQLite (WAL) for state. Hono on Node 20+.

**Upstream providers** (selected by the `body.model` prefix — see "Model prefix routing"; the resolved model's `provider` column must agree):
- **MiniMax** (default) — [minimax.io](https://minimax.io), API-key bearer, HTTP-JSON.
- **Kiro** (AWS CodeWhisperer / Amazon Q) — OAuth refresh-token auth, AWS event-stream binary protocol, translated to/from OpenAI + Anthropic. See "Kiro provider" below.
- **CodeBuddy** (CodeBuddy.ai) — OpenAI-compatible upstream, API-key bearer. Client request bridged to OpenAI stream and back (OpenAI SSE → Anthropic SSE assembler). Routed via cb/ prefix. See src/proxy/codebuddy.ts + src/providers/codebuddy/.

## Commands

```bash
npm run dev          # concurrently: server (tsx watch :20137) + client (vite :5173)
npm run dev:server   # backend only (port 20137)
npm run dev:client   # frontend only (cd client && vite, port 5173)
npm run build        # vite build client + tsc -> dist/
npm start            # node dist/server.js
npm test             # vitest run (server)
npm run test:client  # vitest run (client SPA)
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
npm run seed-models                # idempotent: upsert 9 builtin models
npm run reset                      # rm db + WAL/SHM sidecars
npm run seed-kiro-models
npm run add-account -- --provider kiro --label kiro1 --refresh-token eyJ...   # + optional --client-id/--client-secret/--region/--profile-arn
```

Docker: `docker build -t kelola-router:latest . && docker compose up -d` (serves from baked `client/dist` on :20137). Prod reverse proxy: `Caddyfile` at repo root.

## Architecture (one-page)

`src/server.ts` — Hono app, ~330 LOC. Middleware: `requireApiKey` (Bearer) for `/v1/*`, `requireAdmin` for `/admin/*`, `verifySameOrigin` CSRF guard on `/admin/*` POSTs.

Per-request path inside `handleProxy` (see `src/proxy/minimax.ts` + `proxy/kiro.ts` + `proxy/codebuddy.ts` + `proxy/combo.ts`):

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

## Two-tier separation

- **`client_keys`** — bearer credentials for clients (Claude Code, hermes-agent). One per app. Per-key usage.
- **`accounts`** — upstream MiniMax/Kiro/CodeBuddy keys. Pool of N for fallback + quota. Each has `credit_type` (`payg` or `token-plan`) + `provider`.

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

## Conventions (terse)

- **Strict TDD**: red test → green impl → commit. No "add tests later". Tests mirror source layout under `src/**/*.test.ts`.
- **No `any`**, `const` over `let`, early returns over nested `if/else`.
- **Conventional commits** (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`).
- **`better-sqlite3` returns `undefined` for missing rows**, not `null`. Repo functions coerce via `?? null`.
- **Commit after every meaningful change** (~300 LOC max per commit).
- **Never push without asking** the user.
- **Settings cache**: `getSetting` caches for 1s. Call `clearCacheForDb(db)` in tests.

## Test patterns

- `process.env.ROUTER_DB_PATH = join(mkdtempSync(...), "t.db")` in `beforeEach` to isolate each test.
- Call `resetDb()` from `src/server.ts` to reset the Hono app DB handle.
- Mock upstream with `vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(...))` — use `mockImplementation` (not `mockResolvedValueOnce`) when a test calls fetch multiple times.
- CSRF middleware blocks cross-origin POSTs: integration tests for `/admin/*` POSTs must set `Origin` matching `Host` or omit `Origin`.
