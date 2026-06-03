# Dashboard SPA Rebuild — Design Spec

**Date**: 2026-06-02
**Status**: Approved (pending user spec review)
**Scope**: Replace server-rendered HTML dashboard with Preact + Vite SPA. Modern obsidian-emerald-gold theme. Per-request drilldown.

## Goals

1. Polish UI/UX to modern premium feel. Obsidian background, emerald primary, gold accent-only.
2. Add real interactivity: command palette, modals, toasts, live charts.
3. Add per-request drilldown: click any usage row to see full request/response/headers/error.
4. Keep local-first philosophy: single binary, no external services, no build step in production.

## Non-Goals

- Multi-user / multi-tenant dashboard.
- Real-time WebSocket streaming. Polling only (5s).
- Light theme variant. Dark only.
- Mobile-first responsive. Desktop primary, gracefully degrades to tablet. Phone is best-effort.

## Architecture

Two codebases in one repo:

```
src/                        (server, Hono)
  server.ts                 — API + static SPA serving
  api/admin/                — JSON endpoints (auth, CRUD)
  db/                       — repos + migrations
  auth/                     — unchanged
  accounts/                 — unchanged
  providers/                — unchanged
  streaming/                — unchanged
  proxy                     — `/v1/*` OpenAI + Anthropic (unchanged)

client/                     (new, Preact + Vite SPA)
  src/
    main.tsx
    App.tsx
    pages/                  — Overview, Usage, ClientKeys, Accounts, Models, Quota, Settings, Login
    components/             — primitives + composite
    lib/                    — api, theme tokens, charts (vanilla canvas)
    styles/                 — base.css, components.css
  vite.config.ts
  index.html
  package.json
```

Dev workflow:
- `npm run dev` — concurrently runs Hono on :20137 + Vite on :5173. Vite proxies `/api`, `/login`, `/logout`, `/v1` to :20137.
- `npm run build` — `vite build` → `client/dist/`, then `tsc` → `dist/`.
- `npm start` — `node dist/server.js` serves JSON API + static SPA from `client/dist/`.

## Theme System

### Palette (final)

CSS custom properties in `client/src/styles/base.css`:

- **Obsidian surface** (backgrounds): `--ink-0: #07090a` → `--ink-4: #283234`
- **Emerald primary** (CTAs, links, active state, charts): `--emerald-0: #0a1f18` → `--emerald-5: #6ee7b7`, plus `--emerald-glow: rgba(45, 212, 164, 0.22)`
- **Gold accent** (brand mark, active status pills, dividers, focus rings on primary actions): `--gold-0: #6b5418` → `--gold-3: #f4d03f`, plus `--gold-glow: rgba(212, 175, 55, 0.18)`
- **Text**: `--text-1: #f0f5f3` (primary), `--text-2: #a3b0ac` (secondary), `--text-3: #6a7773` (muted), `--text-inv: #0d1012` (on light)
- **Semantic**: `--danger: #c0392b`, `--warning: #d4af37`, `--success: #2dd4a4`

### Gold usage rule

Gold appears only in:
- Brand mark first-letter + active status badges
- Section dividers (`.rule::before/::after`)
- Top accent line on `.stat` cards
- Focus ring on primary emerald CTAs (subtle gold halo)
- "active/online" status pills

Never gold buttons. Never gold links. Never gold chart strokes. Emerald owns those.

### Typography

Unchanged from v0.9: Cormorant Garamond (display, headings, page titles, stat numbers), Manrope (body, UI), JetBrains Mono (code, IDs, tokens).

### Component primitives (`client/src/styles/components.css`)

- `.surface` — card base (obsidian-2 bg, ink-3 border, hover → emerald-1 border + emerald-glow shadow)
- `.surface-elevated` — modals/popovers (obsidian-1 bg, 24px backdrop-blur, larger shadow)
- `.btn` — variants: `primary` (emerald gradient), `ghost` (transparent + emerald border), `danger`, `link` (text-only emerald underline on hover)
- `.input`, `.select`, `.textarea` — obsidian-1 bg, ink-3 border, focus → emerald-2 border + emerald-glow ring
- `.switch` — toggle component (replaces checkbox for settings)
- `.table` — no zebra, hover row → emerald-0 bg, sticky header with obsidian-0 bg
- `.badge` — variants: `active` (emerald), `warn` (gold), `error` (danger), `muted` (ink-3)
- `.stat` — display font for value, uppercase label, top gold accent line
- `.progress` — emerald-3 fill, ink-3 track
- `.toast` — auto-dismiss 3s, slide-in from bottom-right, stack 5 max
- `.modal` — native `<dialog>` + emerald-tinted backdrop, slide-up animation
- `.command-palette` — full-screen overlay, fuzzy search, Esc to close
- `.rule` — gold-gradient horizontal divider with optional center text

### Animation

- Default transition: 150ms ease-out.
- `@keyframes`: `fade-in`, `slide-up`, `gold-pulse` (active status indicator), `shimmer` (loading states).
- Respect `prefers-reduced-motion`: disable non-essential animations.

## Layout

### App shell

- **Sidebar (left)**: 64px collapsed icon rail, expands to 240px on hover (200ms ease). Brand mark + 7 nav icons + user card. Active item: 2px emerald-3 left border, text emerald-4. Tooltip on collapsed.
- **Top bar**: page title (Cormorant Garamond 28px) + breadcrumbs + context actions (right-aligned).
- **Main**: max-width 1280px, 32px padding. Obsidian gradient background same as current.

### Pages

**Overview** (`/admin`)
- 4 hero stats (Cost 7d, Tokens 7d, Active Accounts, Active Keys).
- 2-column grid: "By model" table (left) + "Request volume" sparkline (right).
- Full-width "Recent requests" table, status badges colored by HTTP code.
- Onboarding alert at top with emerald accent border (shown when state incomplete).
- Recent request rows clickable → drilldown modal.

**Usage** (`/admin/usage`)
- Top: filter bar (client key pills + date range picker) + 3 summary stats.
- Middle: 2 charts side-by-side (cost-over-time line + cost-by-model donut).
- Bottom: paginated table 100/page with sortable headers. Rows clickable → drilldown.
- Manual refresh button (5s poll optional).

**Client Keys** (`/admin/client-keys`)
- Table with reveal/copy buttons (existing logic, restyled).
- "Create" opens slide-up modal (not page form).
- Empty state: large emerald icon + CTA.

**Upstream Accounts** (`/admin/accounts`)
- Table with status pills (active=emerald, error=danger, disabled=ink-3, rate-limited=gold pulse).
- Per-row expandable showing recent errors (accordion).
- "Add" opens modal.

**Models** (`/admin/models`)
- Table with enable toggle (`.switch`).
- Source badge (builtin=ink-3, custom=emerald).
- "Fetch from upstream" button (gold accent).

**Quota** (`/admin/quota`)
- Per-account card with 2 progress bars (5h + weekly).
- Progress fill: emerald-3, bg ink-3. Reset time in text-3.
- Empty state: gold dashed border + "no snapshots yet".

**Settings** (`/admin/settings`)
- 5 collapsible sections: Dashboard access, Caveman, RTK, Caching, MiniMax.
- Toggle switches instead of checkboxes. Auto-save on change with toast confirmation (no submit button).
- Password change inline (expand section).

**Login** (`/login`)
- Centered card, large gold seal logo, password input + submit.
- Glass-morphism backdrop.

### Global features

- **Command palette** (⌘K / Ctrl+K): fuzzy search across nav + recent items. Esc closes. Up/down navigate, Enter selects.
- **Toasts**: replace `?fetched=N` flash. Success/error after every mutation. Bottom-right stack, auto-dismiss 3s.
- **Keyboard shortcuts**: `⌘K` palette, `g o` overview, `g u` usage, `g c` client-keys, `?` help overlay.
- **Per-request drilldown modal**: 4 tabs (Summary, Request, Response, Error). Request/Response: pretty-printed JSON tree, copy button. Headers: monospace collapsible. Streaming response: collapsed SSE event list.

## Server API (Hono)

All endpoints return JSON. Session cookie auth (existing). Same-origin CSRF check on POST. Bearer auth unchanged for `/v1/*`.

```
GET    /api/me                            → { authed, passwordSet }
POST   /api/login                         → { password } → 204
POST   /api/logout                        → 204

GET    /api/admin/overview                → { stats, byModel, recent }
GET    /api/admin/usage?client_key&days   → { summary, logs }
GET    /api/admin/request-logs/:id        → full log row (drilldown)

GET    /api/admin/client-keys             → [...]
POST   /api/admin/client-keys             → { label } → { id, key } (key shown once)
POST   /api/admin/client-keys/:id/disable → 204
POST   /api/admin/client-keys/:id/enable  → 204
DELETE /api/admin/client-keys/:id         → 204

GET    /api/admin/accounts                → [...]
POST   /api/admin/accounts                → { label, credit_type, api_key }
POST   /api/admin/accounts/:id/disable    → 204
POST   /api/admin/accounts/:id/enable     → 204
DELETE /api/admin/accounts/:id            → 204

GET    /api/admin/models                  → [...]
POST   /api/admin/models/fetch            → refresh from upstream
POST   /api/admin/models/:name/disable    → 204
POST   /api/admin/models/:name/enable     → 204

GET    /api/admin/quota                   → per-account windows

GET    /api/admin/settings                → all settings
POST   /api/admin/settings/caveman        → { level }
POST   /api/admin/settings/rtk            → { enabled }
POST   /api/admin/settings/caching        → { autoBreakpoints }
POST   /api/admin/settings/minimax        → { upstreamFormat?, reasoningSplitDefault?, m3DefaultMaxCompletionTokens? }
POST   /api/admin/settings/password       → { action: "set"|"clear", password? }
```

Error format: `{ "error": "code", "message": "human readable" }` with appropriate HTTP status.

## Data Model Changes

### Migration `005-request-bodies.sql`

Add columns to `request_logs`:
- `request_body TEXT` — captured request body (JSON, possibly truncated to 100kb)
- `response_body TEXT` — captured response body (JSON or SSE concatenated, truncated to 100kb)
- `request_headers TEXT` — JSON object of headers
- `response_headers TEXT` — JSON object of headers
- `error TEXT` — error message if request failed (e.g. network error, parse error)

Existing rows: leave new columns NULL.

Update `insertRequestLog()` in `src/db/repos/requestLogs.ts` to accept new optional params. Update `handleProxy()` in `src/server.ts` to capture bodies + headers from upstream response, then call `insertRequestLog()` with all fields.

Body truncation: if request or response body > 100kb, store first 100kb + `"...truncated..."` marker. Streaming responses: store first 20 SSE events concatenated, then truncate.

## Dependencies

### New (client only)

- `preact` ^10.22
- `preact-router` ^4.1
- `@tanstack/react-query` ^5.51 (works with preact via vite alias)
- `vite` ^5.4
- `@preact/preset-vite` ^2.9
- `@testing-library/preact` ^3.2
- `happy-dom` ^15 (test env)
- `concurrently` ^9 (dev orchestration for `npm run dev`)

### New (root)

- None. Server keeps no new deps.

### Removed

- None directly. `src/dashboard/*` is deleted (see Files).

## Files

### New

- `client/` — entire SPA (~30 files)
- `src/api/admin/` — 14 route files
- `src/db/migrations/005-request-bodies.sql`
- `tests/api/admin/` — 7 integration test files
- `client/src/components/__tests__/` — 5+ unit test files
- `client/src/pages/__tests__/` — 2+ integration test files
- `client/vite.config.ts`
- `client/index.html`
- `client/tsconfig.json`

### Removed

- `src/dashboard/pages/accounts.ts`
- `src/dashboard/pages/clientKeys.ts`
- `src/dashboard/pages/models.ts`
- `src/dashboard/pages/overview.ts`
- `src/dashboard/pages/quota.ts`
- `src/dashboard/pages/settings.ts`
- `src/dashboard/pages/usage.ts`
- `src/dashboard/pages/clientKeys.test.ts`
- `src/dashboard/pages/usage.test.ts`
- `src/dashboard/layout.ts`
- `src/dashboard/render.ts`
- `src/dashboard/render.test.ts`
- `src/dashboard/theme.ts`

### Updated

- `package.json` — add client deps, scripts (`dev`, `build`, `dev:server`, `dev:client`, `build:client`)
- `tsconfig.json` — add `client/src` to include
- `src/server.ts` — drop HTML routes, add JSON API mounts, serve `client/dist/` static in production
- `src/db/repos/requestLogs.ts` — accept new fields
- `src/auth/rateLimit.ts` — return JSON 429 instead of HTML
- `src/auth/middleware.ts` — JSON 401 for `/api/*` instead of redirect
- `README.md` — document new dev workflow

## Testing Strategy (TDD)

Per CLAUDE.md strict TDD: red test → green impl → commit.

### Server (Vitest)

- `tests/api/admin/overview.test.ts` — 200 + shape, requires session
- `tests/api/admin/usage.test.ts` — filter by client_key, days param, pagination
- `tests/api/admin/client-keys.test.ts` — CRUD, key shown once, CSRF blocks cross-origin
- `tests/api/admin/accounts.test.ts` — CRUD, enable/disable, password-protected POST
- `tests/api/admin/models.test.ts` — list, fetch, enable/disable
- `tests/api/admin/quota.test.ts` — per-account windows
- `tests/api/admin/settings.test.ts` — all 5 sections, password set/clear
- `tests/api/admin/request-logs.test.ts` — drilldown 200, 404 for missing
- `tests/api/admin/auth.test.ts` — 401 without session, 401 with wrong password, rate limit
- `tests/db/migration-005-request-bodies.test.ts` — new columns populated by proxy
- `tests/proxy/request-bodies.test.ts` — proxy captures and stores bodies

### Client (Vitest + @testing-library/preact + happy-dom)

- `client/src/components/Button.test.tsx` — variants, click handler
- `client/src/components/Modal.test.tsx` — open/close, ESC, backdrop click
- `client/src/components/Toast.test.tsx` — auto-dismiss, stack
- `client/src/components/CommandPalette.test.tsx` — open via ⌘K, fuzzy search, navigation
- `client/src/components/RequestDetail.test.tsx` — 4 tabs render, JSON pretty-print
- `client/src/pages/Usage.test.tsx` — filter, sort, pagination, row click → drilldown
- `client/src/pages/Settings.test.tsx` — auto-save on toggle change
- `client/src/lib/api.test.ts` — fetch wrapper, error parsing, CSRF

### E2E (manual, documented in PR)

- Login flow (when password set)
- Create client key → reveal once → use in API call → see in usage
- Add upstream account → see in pool
- Click usage row → drilldown shows full request/response
- ⌘K palette → navigate to a page
- Toggle setting → toast confirms

## Risks & Mitigations

- **Large refactor**: 30+ files changed. Mitigation: 1 commit per page + tests, no batching.
- **Body storage growth**: 100kb × millions of rows = GBs. Mitigation: body columns optional, retention policy deferred to follow-up. Initial release fine for low-traffic local-first.
- **CSRF + SPA**: Same-origin check still works because session cookie + same origin. Mitigation: keep `Origin` check on all POST.
- **Vite build size**: Preact + router + react-query ~50kb gzipped. Acceptable for local dashboard.
- **Auth state sync**: Multiple tabs could logout independently. Mitigation: react-query invalidates `/api/me` on focus.

## Open Questions

None. All design decisions approved during brainstorming.

## Implementation Order (for plan)

1. Migration 005 + repo + proxy capture (server foundation)
2. Server API routes (one per resource, test-first)
3. Client scaffold (Vite + Preact + router + react-query + theme tokens)
4. Component primitives (Button, Card, Table, etc.)
5. App shell (sidebar, top bar, routing)
6. Per-page implementation (Overview → Usage → ClientKeys → Accounts → Models → Quota → Settings → Login)
7. Global features (Command palette, Toasts, RequestDetail modal)
8. Polish (animations, empty states, error states, reduced-motion)
9. E2E manual test
10. README + PR
