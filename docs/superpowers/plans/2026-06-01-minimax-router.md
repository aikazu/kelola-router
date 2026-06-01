# MiniMax API Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Hono-based local-first API router for MiniMax (single provider, multi-account PAYG + Token Plan, prompt caching, RTK + Caveman, dashboard, multi-transport) in ~2-3 days.

**Architecture:** Hono + better-sqlite3 + Node.js 20+ + TypeScript strict. Per-request pipeline: auth → augment (caveman + cache) → RTK compress → resolve model → select account → proxyAwareFetch → log. Server-rendered HTML dashboard, hot-reload settings (1s cache).

**Tech Stack:** Hono 4, better-sqlite3 11, undici 6, socks-proxy-agent, ulid, pino, TypeScript 5.4, tsx (dev), vitest (test). No ORM, no Drizzle, no auth library.

**Spec:** `docs/spec/IMPLEMENTATION.md`. Per-module skeletons: `docs/idea/<area>/SUMMARY.md`.

---

## File Structure

**Top-level (created at end of v0.1):**
- `package.json`, `tsconfig.json`, `.env.example`, `README.md`, `.gitignore`

**Source (one module per concern, small + focused):**
- `src/server.ts` — Hono app + listener, ~200 LOC
- `src/auth.ts` — `requireApiKey` + `requireAdmin` middleware, ~60 LOC
- `src/cache-injection.ts` — dual cache_control + caveman orchestration, ~100 LOC
- `src/accounts/{types,backoff,errorRules,state,selection,locks}.ts` — 6 small files
- `src/caveman/{index,prompts}.ts` — 2 small files
- `src/db/index.ts` + `migrations/{001-initial,002-admin-key,index}.ts` + 7 repos
- `src/providers/{minimax,alias,baseUrl,headers,upstreamFetch,parseError,quota,listModels,pricing}.ts` — 9 files
- `src/rtk/{index,applyFilter,autodetect,constants,registry,types}.ts` + 2 filters
- `src/transport/{proxyFetch,dispatcherCache,socksLoader,types}.ts` — 4 files
- `src/streaming/{extractUsage,pipeWithUsage}.ts` — SSE parser, ~120 LOC
- `src/dashboard/{layout,render}.ts` + `pages/{overview,usage,accounts,models,quota,settings}.ts` — 8 files
- `src/scheduler/quotaPull.ts` — periodic pull, ~50 LOC
- `src/util/{log,env}.ts` — 2 files
- `scripts/{add-user,add-account,seed-models,reset}.ts` — 4 CLI scripts

**Tests:** `tests/` mirrors `src/`, vitest. Per-module unit tests + integration tests in `tests/integration/`.

---

## Phases

This plan split into 6 phase files (one per milestone) for readability:

1. [Phase 1: v0.1 Passthrough](./2026-06-01-minimax-router-phase-1-v01-passthrough.md) — Hono + 5 routes, direct fetch, no auth
2. [Phase 2: v0.2 Auth + Multi-Account](./2026-06-01-minimax-router-phase-2-v02-auth-accounts.md) — DB + 7 tables + state machine
3. [Phase 3: v0.3 Model Registry](./2026-06-01-minimax-router-phase-3-v03-model-registry.md) — 11 seed models + alias + pricing
4. [Phase 4: v0.4 RTK + Caveman + Cache](./2026-06-01-minimax-router-phase-4-v04-rtk-caveman-cache.md) — 3 augmentation modules
5. [Phase 5: v0.5 Quota + Dashboard](./2026-06-01-minimax-router-phase-5-v05-quota-dashboard.md) — 5 dashboard pages + scheduler + SSE
6. [Phase 6: v0.6 Transport + Docker](./2026-06-01-minimax-router-phase-6-v06-transport-docker.md) — full proxyFetch + Dockerfile + VPS docs

Each phase is independently shippable + testable. Phases 1-2 are MVP (core proxy works). Phases 3-6 are feature additions.

---

## Conventions

**TDD discipline:** every task writes failing test FIRST, runs it (red), writes minimal impl, runs test (green), commits. No "I'll add tests later".

**Commits:** conventional commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `refactor:`). One commit per task minimum. Push at end of each phase.

**TypeScript strict:** no `any` (per CLAUDE.md). Use `unknown` + type guards. Test files may use `any` for fixtures.

**Test framework:** vitest. Test files next to source: `src/foo.ts` → `src/foo.test.ts`. Integration tests in `tests/integration/`.

**Ports from 9router:** when porting, copy the logic verbatim, then TypeScript-strict-ify types. Don't add features not in the port source.

**DB:** always use `db.prepare()` (parameterized). Never string-interpolate user input into SQL.

**Settings:** read via `getSetting(db, key)` (1s in-memory cache). Write via `setSetting(db, key, value)` (invalidates cache).

**Errors:** log via `pino` (structured). User-facing errors in Indonesian. Stack traces in English.

**Default port:** `20137` (offset from 9router's 20128 to avoid collision). Default host: `127.0.0.1`. Override via `PORT` / `HOST` env.

---

## Self-Review Checklist (run before declaring plan complete)

After writing all 6 phase files, run this:

- [ ] Every spec section covered by at least one task (cross-ref §10 of spec)
- [ ] No "TBD", "TODO", "fill in", "appropriate" placeholders in any phase
- [ ] All test code shown verbatim (no "similar to Task X" shortcuts)
- [ ] All impl code shown verbatim
- [ ] Exact commands with expected output for every test/run step
- [ ] File paths absolute from repo root (`src/...` not `./src/...`)
- [ ] Type names consistent across phases (Account, Model, ResolvedModel, etc.)
- [ ] Commit messages conventional commit format
- [ ] Each phase ends with a checkpoint commit + push
- [ ] Migration ordering: 001 then 002 (admin_key), no skips
