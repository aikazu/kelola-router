# Dashboard SPA Rebuild — Parent Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase-by-phase. Each phase is a self-contained plan file.

**Goal:** Replace server-rendered HTML dashboard with Preact + Vite SPA. Modern obsidian-emerald-gold theme. Per-request drilldown. Single binary + static SPA in production.

**Architecture:** Two codebases (server Hono JSON API + client Preact SPA) sharing one repo. 4 phases executed sequentially. Each phase has its own detailed plan with TDD red-green steps.

**Tech Stack:** Hono, better-sqlite3, Preact 10, preact-router 4, @tanstack/react-query 5, Vite 5, Vitest, @testing-library/preact, happy-dom.

**Spec:** `docs/superpowers/specs/2026-06-02-dashboard-spa-rebuild-design.md`

---

## Phases

This plan is decomposed into 4 sequential phases. **Execute them in order.** Each phase ends with a green test suite + working state. Don't proceed to the next phase until the current one is fully verified.

| # | Phase | Plan file | Scope | Time est. |
|---|---|---|---|---|
| 1 | Server foundation | `2026-06-02-dashboard-spa-rebuild-phase-1-server-foundation.md` | Migration 005 + body capture + 14 JSON API routes + ~45 server tests | 1-2 days |
| 2 | Client scaffold | `2026-06-02-dashboard-spa-rebuild-phase-2-client-scaffold.md` | Vite + Preact + theme + 10 components + app shell + ~10 client tests | 1-2 days |
| 3 | Pages | `2026-06-02-dashboard-spa-rebuild-phase-3-pages.md` | 8 page implementations + drilldown modal + router wire-up + ~5 more client tests | 2-3 days |
| 4 | Cleanup + charts | `2026-06-02-dashboard-spa-rebuild-phase-4-cleanup.md` | Vanilla canvas charts + delete old HTML dashboard + production build pipeline + README | 1 day |

**Total: ~5-8 days.**

---

## Phase 1: Server Foundation

**Read first:** `docs/superpowers/plans/2026-06-02-dashboard-spa-rebuild-phase-1-server-foundation.md`

**What it builds:**
- Migration `005-request-bodies.sql` adds 5 columns to `request_logs`
- Repo functions: extended `insertRequestLog`, new `getRequestLogById`
- Proxy captures request/response bodies + headers, truncates > 100kb
- 14 JSON API routes under `/api/admin/*` + `/api/me`, `/api/login`, `/api/logout`
- `requireAdminJson` middleware (JSON 401 instead of HTML redirect)
- `ApiError` + `handleApiError` for consistent error format
- ~45 new Vitest tests, all green

**End state:** Server exposes full JSON API. Old HTML routes still work (will be deleted in Phase 4). No client changes yet.

**Verification gate before Phase 2:**
- [ ] `npm test` passes (251+ original + ~45 new)
- [ ] `npm run typecheck` passes
- [ ] `curl http://localhost:20137/api/me` returns JSON
- [ ] `curl http://localhost:20137/api/admin/overview` returns JSON shape

**Commit cadence:** ~12 commits, one per task (see phase 1 plan).

---

## Phase 2: Client Scaffold

**Read first:** `docs/superpowers/plans/2026-06-02-dashboard-spa-rebuild-phase-2-client-scaffold.md`

**What it builds:**
- `client/` directory with Vite + Preact + TypeScript
- `package.json` scripts: `dev` (concurrent), `dev:server`, `dev:client`, `build`, `build:client`
- Theme system: CSS custom properties (emerald primary + gold accent) + component primitives
- 10 components: Button, Card, Badge, Stat, Modal, Toast, ToastProvider, Switch, Progress, Icon
- App shell: Sidebar (64px rail → 240px on hover) + TopBar + AppShell + preact-router skeleton
- Command palette (`⌘K`) with fuzzy search
- 7 placeholder pages (each replaced in Phase 3)
- ~10 client tests

**End state:** `npm run dev` shows working sidebar + topbar + placeholder. All 10 components tested. Command palette works.

**Verification gate before Phase 3:**
- [ ] `npm test` (server) still passes
- [ ] `cd client && npm test` passes (~10 tests)
- [ ] `cd client && npm run typecheck` passes
- [ ] Manual: open `http://localhost:5173`, see sidebar + topbar, press `⌘K` → palette opens, hover sidebar → expands

**Commit cadence:** ~7 commits, one per task.

---

## Phase 3: Pages

**Read first:** `docs/superpowers/plans/2026-06-02-dashboard-spa-rebuild-phase-3-pages.md`

**What it builds:**
- 8 page components: Overview, Usage, ClientKeys, Accounts, Models, Quota, Settings, Login
- Each page uses `useQuery` to fetch from Phase 1 API
- Mutations via `useMutation`, invalidates queries + shows toast
- `RequestDetail` modal: 4 tabs (Summary, Request, Response, Error), JSON pretty-print, headers table
- Usage page row click → drilldown
- Overview recent requests row click → drilldown
- Auto-save on settings toggles
- AppShell wires all pages to hash router
- Keyboard shortcuts: `⌘K` palette, `g o/u/c/a/m/q/s` nav, `?` help
- Login page with glass-morphism backdrop
- ~5 more client tests

**End state:** All 8 pages functional with real data. Drilldown works. No charts yet (Phase 4).

**Verification gate before Phase 4:**
- [ ] All server tests pass
- [ ] All client tests pass (~15 total)
- [ ] Manual E2E: navigate every page, create a key, add an account, toggle a setting, click a usage row → drilldown works

**Commit cadence:** ~10 commits, one per page + drilldown + router.

---

## Phase 4: Cleanup + Charts + Production Build

**Read first:** `docs/superpowers/plans/2026-06-02-dashboard-spa-rebuild-phase-4-cleanup.md`

**What it builds:**
- Vanilla canvas charts: `sparkline.ts`, `lineChart.ts`, `donutChart.ts`
- Overview sparkline (cost by model)
- Usage line chart (cost over time) + donut chart (cost by model)
- Delete `src/dashboard/**` (13 files)
- Remove HTML routes from `src/server.ts`
- Serve `client/dist/` static in production
- Updated `package.json` scripts (`build`, `start`)
- Updated README with new architecture diagram
- Updated `tsconfig.json` to exclude `client/`
- Final E2E smoke (11 manual checks)

**End state:** Single binary (`node dist/server.js`) serves JSON API + static SPA on :20137. No HTML rendering in server. ~290 server + ~25 client tests passing.

**Final verification:**
- [ ] `npm test` + `npm run test:client` all pass
- [ ] `npm run build` succeeds
- [ ] `npm start` works in production mode
- [ ] All 11 manual E2E checks pass

**Commit cadence:** ~7 commits.

---

## Execution

**Recommended:** `superpowers:subagent-driven-development` — dispatch fresh subagent per phase (or per task within phase), review between, fast iteration.

**Alternative:** `superpowers:executing-plans` — execute inline in this session, batch with checkpoints.

### Suggested subagent dispatch

```bash
# Phase 1
Task tool, subagent_type: general-purpose
prompt: "Execute plan docs/superpowers/plans/2026-06-02-dashboard-spa-rebuild-phase-1-server-foundation.md task by task. Stop at verification gate. Report green test count + any blockers."

# Phase 2 (only after Phase 1 green)
Task tool, subagent_type: general-purpose
prompt: "Execute plan docs/superpowers/plans/2026-06-02-dashboard-spa-rebuild-phase-2-client-scaffold.md task by task..."

# Phase 3 (only after Phase 2 green)
Task tool, subagent_type: general-purpose
prompt: "Execute plan docs/superpowers/plans/2026-06-02-dashboard-spa-rebuild-phase-3-pages.md task by task..."

# Phase 4 (only after Phase 3 green)
Task tool, subagent_type: general-purpose
prompt: "Execute plan docs/superpowers/plans/2026-06-02-dashboard-spa-rebuild-phase-4-cleanup.md task by task..."
```

Each subagent works in the same repo (no worktree needed — phases touch different files for the most part). For Phase 3 + 4, subagents should be sequential since they touch `src/server.ts`.

---

## Risk Notes

- **Phase 1 ↔ Phase 2**: independent. Can parallelize subagents.
- **Phase 2 ↔ Phase 3**: Phase 3 reads Phase 2 components. Sequential.
- **Phase 3 ↔ Phase 4**: Phase 4 deletes `src/dashboard/*` which Phase 3 doesn't touch. Sequential.
- **Body capture growth**: 100kb × millions of rows = GBs. Acceptable for low-traffic local-first. Retention policy deferred.

---

## Done When

- [ ] All 4 phases executed
- [ ] All tests pass (290+ server + 25+ client)
- [ ] Production build produces single binary
- [ ] 11-step E2E manual smoke passes
- [ ] README updated
- [ ] Old dashboard deleted
- [ ] Working tree clean, conventional commit history
- [ ] Optional: PR created (with explicit user permission per CLAUDE.md)
