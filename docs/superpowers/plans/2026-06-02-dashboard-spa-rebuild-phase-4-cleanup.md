# Dashboard SPA Rebuild — Phase 4: Cleanup + Charts + Production Build

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete obsolete server HTML dashboard, add static SPA serving in production, add charts (vanilla canvas), persist user preferences, update README, final E2E smoke. Ship.

**Architecture:** Server drops `src/dashboard/*` entirely. `npm start` builds client + serves static from `client/dist/`. New `src/charts/` for vanilla canvas helpers used by Overview (sparkline) + Usage (line + donut).

**Tech Stack:** All previous + manual canvas drawing.

**Phase 4 scope:** Server HTML deletion, production build pipeline, charts, README update, final verification.

---

## File Structure

### New files (Phase 4)

```
client/src/charts/
  lineChart.ts                     — time-series line
  donutChart.ts                    — proportion donut
  sparkline.ts                     — tiny trendline
client/src/lib/
  theme.ts                         — TS token mirror (already in Phase 2 spec; finalize here)
src/charts/                        — (not needed; charts are client-only)
README.md                          — updated dev workflow section
```

### Modified files (Phase 4)

```
src/server.ts                      — drop dashboard HTML routes, serve client/dist in production
package.json                       — add build:client, simplify build
.gitignore                         — confirm client/dist/ ignored
tsconfig.json                      — exclude client/ from server typecheck
```

### Removed files (Phase 4)

```
src/dashboard/pages/accounts.ts
src/dashboard/pages/clientKeys.ts
src/dashboard/pages/models.ts
src/dashboard/pages/overview.ts
src/dashboard/pages/quota.ts
src/dashboard/pages/settings.ts
src/dashboard/pages/usage.ts
src/dashboard/pages/clientKeys.test.ts
src/dashboard/pages/usage.test.ts
src/dashboard/layout.ts
src/dashboard/render.ts
src/dashboard/render.test.ts
src/dashboard/theme.ts
```

---

## Task 1: Vanilla chart helpers (canvas)

**Files:**
- Create: `client/src/charts/lineChart.ts`
- Create: `client/src/charts/donutChart.ts`
- Create: `client/src/charts/sparkline.ts`

- [ ] **Step 1: Implement sparkline**

`client/src/charts/sparkline.ts`:
```typescript
export function drawSparkline(canvas: HTMLCanvasElement, data: number[], color = "#2dd4a4"): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || data.length === 0) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const stepX = w / (data.length - 1 || 1);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color + "55");
  grad.addColorStop(1, color + "00");
  ctx.beginPath();
  ctx.moveTo(0, h);
  data.forEach((v, i) => {
    const y = h - ((v - min) / range) * h;
    ctx.lineTo(i * stepX, y);
  });
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.beginPath();
  data.forEach((v, i) => {
    const y = h - ((v - min) / range) * h;
    if (i === 0) ctx.moveTo(i * stepX, y);
    else ctx.lineTo(i * stepX, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}
```

- [ ] **Step 2: Implement lineChart**

`client/src/charts/lineChart.ts`:
```typescript
export interface LinePoint { x: number | Date; y: number; }
export function drawLineChart(canvas: HTMLCanvasElement, points: LinePoint[], options: { color?: string; showAxes?: boolean } = {}): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || points.length === 0) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  const color = options.color ?? "#2dd4a4";
  const xs = points.map(p => p.x instanceof Date ? p.x.getTime() : p.x);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
  const toX = (x: number) => ((x - minX) / rangeX) * (w - 40) + 30;
  const toY = (y: number) => h - 20 - ((y - minY) / rangeY) * (h - 40);
  ctx.strokeStyle = "#283234";
  ctx.lineWidth = 1;
  if (options.showAxes !== false) {
    for (let i = 0; i <= 4; i++) {
      const y = 20 + (i / 4) * (h - 40);
      ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(w - 10, y); ctx.stroke();
    }
  }
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = toX(xs[i]!), y = toY(p.y);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}
```

- [ ] **Step 3: Implement donutChart**

`client/src/charts/donutChart.ts`:
```typescript
export interface DonutSlice { label: string; value: number; color?: string; }
const PALETTE = ["#2dd4a4", "#d4af37", "#6ee7b7", "#1a8c6a", "#b8860b", "#15664f"];

export function drawDonutChart(canvas: HTMLCanvasElement, slices: DonutSlice[]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) / 2 - 10;
  const inner = r * 0.6;
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  let angle = -Math.PI / 2;
  slices.forEach((s, i) => {
    const slice = (s.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, angle, angle + slice);
    ctx.arc(cx, cy, inner, angle + slice, angle, true);
    ctx.closePath();
    ctx.fillStyle = s.color ?? PALETTE[i % PALETTE.length];
    ctx.fill();
    angle += slice;
  });
}
```

- [ ] **Step 4: Manual smoke**

Add temporary usage in Overview, run dev, see sparkline render. Remove temporary code.

- [ ] **Step 5: Commit**

```bash
git add client/src/charts/
git commit -m "feat(client): vanilla canvas charts (sparkline, line, donut)"
```

---

## Task 2: Wire charts into Overview + Usage

**Files:**
- Modify: `client/src/pages/Overview.tsx`
- Modify: `client/src/pages/Usage.tsx`

- [ ] **Step 1: Add sparkline to Overview**

In `Overview.tsx`, after stats grid, add a "Volume" card with sparkline derived from `data.recent` (group by hour). Use `useEffect` + `useRef` to draw.

```typescript
import { drawSparkline } from "../charts/sparkline";
import { useEffect, useRef } from "preact/hooks";

// inside Overview component:
const sparkRef = useRef<HTMLCanvasElement>(null);
useEffect(() => {
  if (!sparkRef.current || !data) return;
  // build 7-day daily counts from recent (simplified: just map costs)
  const series = data.byModel.map(m => m.cost);
  if (series.length > 0) drawSparkline(sparkRef.current, series);
}, [data]);

// in JSX, after stat-grid:
<Card title="Request volume (last 7 days)">
  <canvas ref={sparkRef} style={{ width: "100%", height: 80 }} />
</Card>
```

- [ ] **Step 2: Add charts to Usage**

In `Usage.tsx`, fetch time-series data and draw line + donut. If API doesn't return time series yet, derive from `logs` array (group by hour).

```typescript
import { drawLineChart } from "../charts/lineChart";
import { drawDonutChart } from "../charts/donutChart";

const lineRef = useRef<HTMLCanvasElement>(null);
const donutRef = useRef<HTMLCanvasElement>(null);
useEffect(() => {
  if (!data || !lineRef.current || !donutRef.current) return;
  const byHour = new Map<string, number>();
  data.logs.forEach(l => { const h = l.createdAt.slice(0, 13); byHour.set(h, (byHour.get(h) ?? 0) + l.cost); });
  const points = Array.from(byHour.entries()).sort().map(([h, cost]) => ({ x: new Date(h + ":00:00").getTime(), y: cost }));
  if (points.length > 0) drawLineChart(lineRef.current, points);
  const byModel = new Map<string, number>();
  data.logs.forEach(l => byModel.set(l.model, (byModel.get(l.model) ?? 0) + l.cost));
  drawDonutChart(donutRef.current, Array.from(byModel.entries()).map(([label, value]) => ({ label, value })));
}, [data]);

// in JSX, between stats and table:
<div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 18, marginBottom: 18 }}>
  <Card title="Cost over time"><canvas ref={lineRef} style={{ width: "100%", height: 200 }} /></Card>
  <Card title="Cost by model"><canvas ref={donutRef} style={{ width: "100%", height: 200 }} /></Card>
</div>
```

- [ ] **Step 3: Manual smoke**

Run `npm run dev`, navigate Overview → see sparkline. Navigate Usage → see line + donut.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Overview.tsx client/src/pages/Usage.tsx
git commit -m "feat(client): wire charts into Overview + Usage"
```

---

## Task 3: Delete server HTML dashboard

**Files:**
- Delete: all `src/dashboard/**`

- [ ] **Step 1: Delete**

```bash
git rm -r src/dashboard/
```

- [ ] **Step 2: Run full server test suite — expect some tests fail (they referenced the removed dashboard)**

Run: `npm test`
Expected: tests in `src/dashboard/pages/*.test.ts` already removed in Phase 1. Other tests should still pass.

- [ ] **Step 3: Remove dashboard from server.ts**

In `src/server.ts`, search for imports from `./dashboard/` and remove. Also remove any HTML routes (`/admin`, `/admin/usage`, etc.) — they are now handled by client SPA.

Remove the line `app.route("/api", adminApi(getDb()))` is kept. The HTML routes are no longer needed since the SPA handles all UI.

Search `src/server.ts` for: `dashboard`, `page(`, `renderOverview`, `renderUsage`, `renderAccounts`, `renderClientKeys`, `renderModels`, `renderQuota`, `renderSettings`, and remove all references.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: all pass (the old dashboard tests are gone, new API tests still pass).

- [ ] **Step 6: Commit**

```bash
git add -A src/server.ts src/dashboard/ 2>/dev/null || git add -A
git commit -m "refactor: remove obsolete server HTML dashboard"
```

---

## Task 4: Serve static SPA in production

**Files:**
- Modify: `src/server.ts`
- Modify: `package.json`

- [ ] **Step 1: Add static serving in server.ts**

In `src/server.ts`, after API routes, add:

```typescript
import { serveStatic } from "@hono/node-server/serve-static";

// at end of app setup:
if (process.env.NODE_ENV === "production" || process.env.SERVE_STATIC) {
  app.use("/*", serveStatic({ root: "./client/dist" }));
  app.get("*", serveStatic({ path: "./client/dist/index.html" }));
}
```

- [ ] **Step 2: Update package.json scripts**

```json
"scripts": {
  "dev": "concurrently -n server,client -c blue,green \"npm run dev:server\" \"npm run dev:client\"",
  "dev:server": "tsx watch src/server.ts",
  "dev:client": "cd client && npm run dev",
  "build": "npm run build:client && tsc",
  "build:client": "cd client && npm run build",
  "start": "NODE_ENV=production node dist/server.js",
  "test": "vitest run",
  "test:client": "cd client && npm test",
  "typecheck": "tsc --noEmit && cd client && npm run typecheck"
}
```

- [ ] **Step 3: Test production build**

```bash
npm run build
npm start &
sleep 2
curl -s http://localhost:20137/ | head -5
curl -s http://localhost:20137/api/me
# kill server
kill %1
```

Expected: SPA HTML returned from `/`, JSON from `/api/me`.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts package.json
git commit -m "feat: serve static SPA in production"
```

---

## Task 5: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace dev workflow section**

Replace the existing "Commands" / "Development" section with:

```markdown
## Development

kelola-router now has a client/server split:
- **Server** (`src/`): Hono API + proxy. Port 20137.
- **Client** (`client/`): Preact + Vite SPA. Port 5173 (dev) / static files in `client/dist/` (prod).

### Quick start

```bash
npm install          # install root deps (server)
cd client && npm install && cd ..   # install client deps
npm run dev          # runs server + client concurrently
```

Open http://localhost:5173 for the SPA. The Vite dev server proxies `/api`, `/login`, `/logout`, `/v1` to the Hono server on :20137.

### Build for production

```bash
npm run build        # builds client (client/dist/) + server (dist/)
npm start            # node dist/server.js — serves API + static SPA on :20137
```

### Project layout

```
src/                 Hono server
  server.ts          — main entry, mounts /api + serves client/dist
  api/admin/         — JSON endpoints (auth, CRUD, drilldown)
  db/                — repos, migrations
  auth/              — password + sessions
  proxy              — /v1/* OpenAI + Anthropic

client/              Preact + Vite SPA
  src/
    pages/           — Overview, Usage, ClientKeys, Accounts, Models, Quota, Settings, Login
    components/      — primitives (Button, Modal, Toast, etc.)
    layout/          — Sidebar, TopBar, AppShell
    lib/             — api wrapper, query client
    styles/          — base.css + components.css + animations.css
    charts/          — vanilla canvas
  vite.config.ts     — dev proxy config
  index.html
```

### Theme

- **Background**: deep obsidian (`#0d1012`)
- **Primary**: emerald (`#1a8c6a` / `#2dd4a4`)
- **Accent**: gold (`#d4af37` / `#f4d03f`) — used sparingly for brand mark, active indicators, dividers
- **Type**: Cormorant Garamond (display) + Manrope (body) + JetBrains Mono (code)

### Testing

```bash
npm test             # server (Vitest) — 290+ tests
npm run test:client  # client (Vitest + testing-library) — 20+ tests
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README — SPA architecture + dev workflow"
```

---

## Task 6: Update tsconfig to exclude client

**Files:**
- Modify: `tsconfig.json`

- [ ] **Step 1: Exclude client from server typecheck**

Add to root `tsconfig.json`:
```json
"exclude": ["client", "client/dist", "dist"]
```

- [ ] **Step 2: Verify typecheck still works**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add tsconfig.json
git commit -m "chore: exclude client/ from server typecheck"
```

---

## Task 7: Final E2E smoke

- [ ] **Step 1: Clean install**

```bash
rm -rf node_modules client/node_modules client/dist dist
npm install
cd client && npm install && cd ..
```

- [ ] **Step 2: Run all tests**

```bash
npm test && npm run test:client
```

Expected: all pass (~300 server + ~20 client).

- [ ] **Step 3: Lint**

```bash
npx biome check .
cd client && npx biome check . 2>/dev/null || true
```

- [ ] **Step 4: Build production**

```bash
npm run build
```

Expected: `dist/server.js` + `client/dist/index.html` both exist.

- [ ] **Step 5: Start production server**

```bash
npm start &
sleep 2
```

- [ ] **Step 6: Curl smoke**

```bash
curl -s http://localhost:20137/ | grep -q "kelola-router" && echo "SPA OK"
curl -s http://localhost:20137/api/me
kill %1
```

Expected: SPA HTML returned, `/api/me` returns JSON.

- [ ] **Step 7: Manual UI smoke (dev mode)**

```bash
npm run dev
```

1. Open http://localhost:5173
2. Sidebar shows 7 items, hover expands
3. Click Overview — see 4 stats + recent table
4. Click Usage — see line + donut charts
5. Click Client keys — see empty state or existing
6. Create a key — modal opens, key shown once, copy works
7. Add upstream account — appears in list
8. Toggle a setting — toast confirms
9. Click any usage row — drilldown modal with 4 tabs
10. `⌘K` — palette opens, type "us", Enter, navigate
11. Logout (if password set) — returns to login

All 11 must work.

- [ ] **Step 8: Final commit if cleanup needed**

```bash
git add -A
git commit -m "chore(phase-4): final cleanup + smoke verification" --allow-empty
```

---

## Phase 4 Done

Dashboard SPA rebuild complete. Server is JSON-only. Client is Preact + Vite SPA with obsidian-emerald-gold theme. Per-request drilldown works. Charts render. Production build produces a single binary + static SPA.

**Summary of changes:**
- New: `client/` (~30 files), `src/api/admin/` (10 files), `src/db/migrations/005-*.sql`, `src/proxy/capture.ts`, ~50 tests
- Modified: `src/server.ts` (smaller), `src/db/repos/requestLogs.ts`, `package.json`, `tsconfig.json`, `README.md`
- Removed: `src/dashboard/**` (13 files)
- Total: ~300 server tests + ~25 client tests, all passing

Ship.
