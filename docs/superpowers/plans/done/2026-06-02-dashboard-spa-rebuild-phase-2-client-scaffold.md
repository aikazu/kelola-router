# Dashboard SPA Rebuild — Phase 2: Client Scaffold + Theme + Shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap Preact + Vite SPA in `client/`, wire dev proxy to Hono, build theme system + component primitives, ship app shell (sidebar rail + top bar + routing). **No page logic yet** — pages come in Phase 3.

**Architecture:** Vite dev server :5173 proxies `/api`, `/login`, `/logout` to Hono :20137. Preact + preact-router for routing. @tanstack/react-query (aliased to preact) for server state. Theme tokens in CSS custom properties (emerald primary + gold accent).

**Tech Stack:** Preact 10, preact-router 4, @tanstack/react-query 5, Vite 5, TypeScript strict, Vitest + @testing-library/preact + happy-dom.

**Phase 2 scope:** New `client/` directory with scaffold, theme system, primitive components, app shell with routing skeleton. No pages, no global features (those in Phase 3-4).

---

## File Structure

### New files (Phase 2)

```
client/
  package.json
  vite.config.ts
  tsconfig.json
  index.html
  src/
    main.tsx                          — Preact entrypoint
    App.tsx                           — router + QueryClient + shell
    lib/
      api.ts                          — fetch wrapper
      queryClient.ts                  — react-query config
      theme.ts                        — TS const mirror of CSS vars (for JS usage)
      keys.ts                         — ⌘K shortcuts
    components/
      Button.tsx
      Card.tsx
      Stat.tsx
      Table.tsx
      Badge.tsx
      Modal.tsx
      Toast.tsx
      ToastProvider.tsx
      CommandPalette.tsx
      Switch.tsx
      Progress.tsx
      Icon.tsx                        — inline SVG icon set
    layout/
      Sidebar.tsx                     — collapsed icon rail
      TopBar.tsx
      AppShell.tsx
    pages/
      Placeholder.tsx                 — "coming in Phase 3" for all 8 routes
    styles/
      base.css                        — reset + tokens
      components.css                  — primitives
      animations.css                  — keyframes
    __tests__/
      setup.ts
      Button.test.tsx
      Card.test.tsx
      Modal.test.tsx
      Toast.test.tsx
      Sidebar.test.tsx
      api.test.ts
```

### Modified files (Phase 2)

```
package.json                          — add client/* deps via workspaces OR add to root deps + scripts
.gitignore                            — add client/dist/, client/node_modules/
docs/superpowers/specs/...            — reference updates (none required)
README.md                             — document new dev workflow
```

---

## Task 1: Vite + Preact scaffold

**Files:**
- Create: `client/package.json`
- Create: `client/vite.config.ts`
- Create: `client/tsconfig.json`
- Create: `client/index.html`
- Create: `client/src/main.tsx`
- Create: `client/src/App.tsx`
- Create: `client/src/styles/base.css`

- [ ] **Step 1: Create client/package.json**

```json
{
  "name": "kelola-router-client",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "preact": "^10.22.0",
    "preact-router": "^4.1.2",
    "@tanstack/react-query": "^5.51.0"
  },
  "devDependencies": {
    "@preact/preset-vite": "^2.9.0",
    "@testing-library/preact": "^3.2.4",
    "@testing-library/jest-dom": "^6.4.0",
    "@types/node": "^20.12.0",
    "happy-dom": "^15.0.0",
    "typescript": "^5.4.0",
    "vite": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create client/vite.config.ts**

```typescript
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:20137",
      "/login": "http://localhost:20137",
      "/logout": "http://localhost:20137",
      "/v1": "http://localhost:20137",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "react": "preact/compat",
      "react-dom": "preact/compat",
      "react/jsx-runtime": "preact/jsx-runtime",
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
```

- [ ] **Step 3: Create client/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "noImplicitAny": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "baseUrl": ".",
    "paths": {
      "react": ["./node_modules/preact/compat/"],
      "react-dom": ["./node_modules/preact/compat/"]
    }
  },
  "include": ["src/**/*", "vite.config.ts"]
}
```

- [ ] **Step 4: Create client/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>kelola-router</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 5: Create base theme CSS**

`client/src/styles/base.css`:
```css
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --ink-0: #07090a;
  --ink-1: #0d1012;
  --ink-2: #141a1c;
  --ink-3: #1d2528;
  --ink-4: #283234;

  --emerald-0: #0a1f18;
  --emerald-1: #0d3a2e;
  --emerald-2: #15664f;
  --emerald-3: #1a8c6a;
  --emerald-4: #2dd4a4;
  --emerald-5: #6ee7b7;
  --emerald-glow: rgba(45, 212, 164, 0.22);

  --gold-0: #6b5418;
  --gold-1: #b8860b;
  --gold-2: #d4af37;
  --gold-3: #f4d03f;
  --gold-glow: rgba(212, 175, 55, 0.18);

  --text-1: #f0f5f3;
  --text-2: #a3b0ac;
  --text-3: #6a7773;
  --text-inv: #0d1012;

  --danger: #c0392b;
  --warning: #d4af37;
  --success: #2dd4a4;

  --font-display: 'Cormorant Garamond', Georgia, serif;
  --font-body: 'Manrope', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  background: var(--ink-1);
  color: var(--text-1);
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

body {
  background:
    radial-gradient(ellipse 1200px 800px at 50% -10%, rgba(45, 212, 164, 0.04) 0%, transparent 60%),
    linear-gradient(180deg, var(--ink-1) 0%, var(--ink-0) 100%);
  min-height: 100vh;
}

a { color: var(--emerald-4); text-decoration: none; transition: color 0.15s; }
a:hover { color: var(--emerald-5); }

h1, h2, h3, h4 {
  font-family: var(--font-display);
  font-weight: 500;
  letter-spacing: 0.3px;
}
h1 { font-size: 30px; }
h2 { font-size: 20px; }
h3 { font-size: 16px; }

code, pre {
  font-family: var(--font-mono);
  font-size: 12.5px;
  background: var(--ink-3);
  border-radius: 3px;
  padding: 1px 6px;
  color: var(--emerald-4);
}
pre { padding: 12px; overflow-x: auto; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 6: Create App + main entrypoint**

`client/src/main.tsx`:
```typescript
import { render } from "preact";
import { App } from "./App";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/animations.css";

const root = document.getElementById("app");
if (root) render(<App />, root);
```

`client/src/App.tsx`:
```typescript
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { AppShell } from "./layout/AppShell";
import { ToastProvider } from "./components/ToastProvider";

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AppShell />
      </ToastProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 7: Install + verify dev server starts**

```bash
cd client && npm install
cd .. && npm run dev  # runs Hono + Vite via concurrently
```

If `concurrently` not in root deps, add: `npm install -D concurrently` and update root `package.json`:
```json
"scripts": {
  "dev": "concurrently -n server,client -c blue,green \"npm run dev:server\" \"npm run dev:client\"",
  "dev:server": "tsx watch src/server.ts",
  "dev:client": "cd client && npm run dev",
  "build": "cd client && npm run build && tsc",
  "build:client": "cd client && npm run build"
}
```

Open http://localhost:5173 — expect blank page (AppShell is a stub for now).

- [ ] **Step 8: Commit**

```bash
git add client/ package.json .gitignore
git commit -m "feat(client): Vite + Preact scaffold + base theme"
```

---

## Task 2: API wrapper + query client

**Files:**
- Create: `client/src/lib/api.ts`
- Create: `client/src/lib/queryClient.ts`
- Create: `client/src/__tests__/api.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// client/src/__tests__/api.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiFetch } from "../lib/api";

describe("apiFetch", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("returns parsed JSON on 2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
    );
    const data = await apiFetch("/api/test");
    expect(data).toEqual({ ok: true });
  });

  it("throws ApiError on non-2xx with parsed body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "bad", message: "nope" }), { status: 400 })
    );
    await expect(apiFetch("/api/test")).rejects.toMatchObject({ code: "bad", message: "nope", status: 400 });
  });

  it("includes credentials for cookie auth", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await apiFetch("/api/test");
    const init = spy.mock.calls[0][1];
    expect(init?.credentials).toBe("include");
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `cd client && npx vitest run src/__tests__/api.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement api.ts**

```typescript
// client/src/lib/api.ts
export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit & { json?: unknown }
): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  let body = init?.body;
  if (init?.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, {
    ...init,
    headers,
    body,
    credentials: "include",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(data?.error ?? "unknown", data?.message ?? res.statusText, res.status);
  }
  return data as T;
}
```

- [ ] **Step 4: Implement queryClient.ts**

```typescript
// client/src/lib/queryClient.ts
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: (failureCount, error: unknown) => {
        if (error instanceof Error && "status" in error && typeof (error as { status: unknown }).status === "number") {
          const status = (error as { status: number }).status;
          if (status === 401 || status === 403 || status === 404) return false;
        }
        return failureCount < 2;
      },
    },
  },
});
```

- [ ] **Step 5: Run test, expect pass**

Run: `cd client && npx vitest run src/__tests__/api.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/api.ts client/src/lib/queryClient.ts client/src/__tests__/api.test.ts
git commit -m "feat(client): api wrapper + query client"
```

---

## Task 3: Component primitives — Button + Card + Badge + Stat

**Files:**
- Create: `client/src/styles/components.css`
- Create: `client/src/components/Button.tsx`
- Create: `client/src/components/Card.tsx`
- Create: `client/src/components/Badge.tsx`
- Create: `client/src/components/Stat.tsx`
- Create: `client/src/__tests__/Button.test.tsx`
- Create: `client/src/__tests__/setup.ts`

- [ ] **Step 1: Setup test env**

`client/src/__tests__/setup.ts`:
```typescript
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 2: Write component CSS first**

`client/src/styles/components.css`:
```css
/* Surface */
.surface {
  background: linear-gradient(180deg, var(--ink-2) 0%, rgba(20, 26, 28, 0.6) 100%);
  border: 1px solid var(--ink-3);
  border-radius: 6px;
  padding: 22px 24px;
  margin-bottom: 18px;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.surface:hover { border-color: var(--emerald-2); box-shadow: 0 0 0 1px var(--emerald-glow); }
.surface-elevated {
  background: var(--ink-1);
  border: 1px solid var(--ink-3);
  border-radius: 8px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(24px);
}

/* Button */
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  background: linear-gradient(180deg, var(--emerald-4) 0%, var(--emerald-3) 100%);
  color: var(--text-inv);
  border: 0;
  padding: 9px 18px;
  font: inherit; font-size: 11px; font-weight: 700;
  letter-spacing: 1.5px; text-transform: uppercase;
  border-radius: 4px;
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.15s, filter 0.15s;
  text-decoration: none;
}
.btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px var(--emerald-glow); filter: brightness(1.08); }
.btn:active { transform: translateY(0); }
.btn-ghost {
  background: transparent;
  color: var(--emerald-4);
  border: 1px solid var(--emerald-2);
}
.btn-ghost:hover { background: var(--emerald-glow); box-shadow: none; }
.btn-danger { background: var(--danger); color: #fff; }
.btn-danger:hover { background: #a83224; box-shadow: 0 4px 12px rgba(192, 57, 43, 0.3); }
.btn-sm { padding: 5px 12px; font-size: 10px; }

/* Card */
.card-title {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 500;
  margin-bottom: 4px;
  letter-spacing: 0.3px;
}
.card-sub { color: var(--text-2); font-size: 12px; margin-bottom: 14px; }

/* Badge */
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 10px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  font-weight: 600;
  background: var(--ink-3);
  color: var(--text-2);
  border: 1px solid var(--ink-4);
}
.badge-active, .badge-ok { background: rgba(45, 212, 164, 0.18); color: var(--emerald-4); border-color: rgba(45, 212, 164, 0.4); }
.badge-error, .badge-bad { background: rgba(192, 57, 43, 0.18); color: #e08a7e; border-color: rgba(192, 57, 43, 0.4); }
.badge-muted, .badge-disabled { background: rgba(106, 119, 115, 0.18); color: var(--text-2); }
.badge-warn, .badge-pending { background: var(--gold-glow); color: var(--gold-3); border-color: rgba(212, 175, 55, 0.4); }
.badge-pulse { animation: gold-pulse 2s ease-in-out infinite; }

/* Stat */
.stat {
  background: var(--ink-2);
  border: 1px solid var(--ink-3);
  border-radius: 6px;
  padding: 18px 20px;
  position: relative;
  overflow: hidden;
  transition: border-color 0.2s;
}
.stat::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--gold-2), transparent);
  opacity: 0.6;
}
.stat:hover { border-color: var(--emerald-2); }
.stat-label {
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--text-3);
  font-weight: 600;
}
.stat-value {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 500;
  margin-top: 4px;
  color: var(--emerald-4);
  letter-spacing: 0.5px;
  font-variant-numeric: tabular-nums;
}
.stat-sub { font-size: 11px; color: var(--text-3); margin-top: 2px; }

/* Table */
table.tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.tbl th, .tbl td { text-align: left; padding: 10px 12px; border-bottom: 1px solid rgba(45, 212, 164, 0.08); }
.tbl th {
  font-size: 10px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--emerald-3);
  font-weight: 600;
  background: rgba(0, 0, 0, 0.2);
  position: sticky;
  top: 0;
}
.tbl tbody tr { transition: background 0.1s; }
.tbl tbody tr:hover { background: rgba(45, 212, 164, 0.04); cursor: pointer; }
.tbl td.mono, .tbl code { font-family: var(--font-mono); font-size: 12px; }

/* Switch */
.switch { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.switch input { display: none; }
.switch-track {
  width: 36px; height: 20px;
  background: var(--ink-3);
  border-radius: 10px;
  position: relative;
  transition: background 0.2s;
}
.switch-thumb {
  position: absolute; top: 2px; left: 2px;
  width: 16px; height: 16px;
  background: var(--text-2);
  border-radius: 50%;
  transition: transform 0.2s, background 0.2s;
}
.switch input:checked + .switch-track { background: var(--emerald-2); }
.switch input:checked + .switch-track .switch-thumb { transform: translateX(16px); background: var(--emerald-5); }

/* Progress */
.progress { height: 6px; background: var(--ink-3); border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, var(--emerald-3), var(--emerald-4)); transition: width 0.4s ease; }
.progress-fill.warn { background: linear-gradient(90deg, var(--gold-1), var(--gold-2)); }

/* Modal */
.modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(7, 9, 10, 0.6);
  backdrop-filter: blur(8px);
  z-index: 100;
  display: flex; align-items: center; justify-content: center;
  animation: fade-in 0.2s ease-out;
}
.modal {
  background: var(--ink-1);
  border: 1px solid var(--emerald-2);
  border-radius: 8px;
  padding: 0;
  max-width: 600px; max-height: 80vh; width: 90%;
  overflow: hidden;
  display: flex; flex-direction: column;
  animation: slide-up 0.25s ease-out;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
}
.modal-header {
  padding: 18px 24px;
  border-bottom: 1px solid var(--ink-3);
  display: flex; justify-content: space-between; align-items: center;
}
.modal-title { font-family: var(--font-display); font-size: 18px; font-weight: 500; }
.modal-body { padding: 20px 24px; overflow-y: auto; flex: 1; }
.modal-footer { padding: 14px 24px; border-top: 1px solid var(--ink-3); display: flex; justify-content: flex-end; gap: 8px; }
.modal-close {
  background: none; border: 0; color: var(--text-2); cursor: pointer;
  font-size: 20px; padding: 4px 8px; border-radius: 4px;
}
.modal-close:hover { background: var(--ink-3); color: var(--text-1); }

/* Toast */
.toast-stack {
  position: fixed; bottom: 24px; right: 24px;
  display: flex; flex-direction: column; gap: 8px;
  z-index: 200;
  max-width: 360px;
}
.toast {
  background: var(--ink-2);
  border: 1px solid var(--emerald-2);
  border-radius: 6px;
  padding: 12px 16px;
  font-size: 13px;
  color: var(--text-1);
  display: flex; align-items: center; gap: 10px;
  animation: slide-in-right 0.25s ease-out;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.toast-error { border-color: var(--danger); }
.toast-success { border-color: var(--emerald-3); }
.toast-icon { font-size: 16px; }
.toast-success .toast-icon { color: var(--emerald-4); }
.toast-error .toast-icon { color: var(--danger); }

/* Command palette */
.cmdk {
  position: fixed; inset: 0;
  background: rgba(7, 9, 10, 0.6);
  backdrop-filter: blur(8px);
  z-index: 300;
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 15vh;
  animation: fade-in 0.15s ease-out;
}
.cmdk-modal {
  background: var(--ink-1);
  border: 1px solid var(--emerald-2);
  border-radius: 8px;
  width: 90%; max-width: 560px;
  max-height: 60vh;
  display: flex; flex-direction: column;
  animation: slide-up 0.2s ease-out;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
}
.cmdk-input {
  width: 100%;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--ink-3);
  color: var(--text-1);
  font: inherit;
  font-size: 16px;
  padding: 18px 20px;
  outline: none;
}
.cmdk-input::placeholder { color: var(--text-3); }
.cmdk-list { overflow-y: auto; padding: 8px 0; }
.cmdk-item {
  padding: 10px 20px;
  display: flex; align-items: center; gap: 12px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-1);
}
.cmdk-item:hover, .cmdk-item.active { background: var(--emerald-glow); }
.cmdk-item-meta { color: var(--text-3); font-size: 11px; margin-left: auto; font-family: var(--font-mono); }

/* Sidebar */
.sidebar {
  background: linear-gradient(180deg, var(--ink-2) 0%, var(--ink-0) 100%);
  border-right: 1px solid var(--ink-3);
  position: sticky; top: 0; height: 100vh;
  width: 64px;
  transition: width 0.2s ease;
  display: flex; flex-direction: column;
  overflow: hidden;
  flex-shrink: 0;
}
.sidebar:hover { width: 240px; }
.brand {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 500;
  padding: 24px;
  border-bottom: 1px solid var(--ink-3);
  letter-spacing: 1px;
  color: var(--text-1);
  white-space: nowrap;
}
.brand::first-letter { color: var(--emerald-4); font-weight: 600; }
.brand-tag {
  display: block;
  font-family: var(--font-body);
  font-size: 9px;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: var(--emerald-3);
  margin-top: 4px;
  opacity: 0.7;
}
.nav { padding: 16px 0; flex: 1; }
.nav-item {
  display: flex; align-items: center;
  padding: 10px 20px;
  color: var(--text-2);
  font-size: 13px;
  font-weight: 500;
  border-left: 2px solid transparent;
  transition: all 0.15s;
  text-decoration: none;
  white-space: nowrap;
  gap: 14px;
}
.nav-item:hover { color: var(--text-1); background: var(--emerald-glow); }
.nav-item.active {
  color: var(--emerald-4);
  border-left-color: var(--emerald-3);
  background: linear-gradient(90deg, var(--emerald-glow) 0%, transparent 100%);
}
.nav-icon {
  width: 20px; height: 20px;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.nav-label {
  opacity: 0;
  transition: opacity 0.2s;
}
.sidebar:hover .nav-label, .sidebar:hover .brand-tag, .sidebar:hover .user-name { opacity: 1; }
.user-card {
  padding: 16px 20px;
  border-top: 1px solid var(--ink-3);
  font-size: 11px;
  color: var(--text-2);
  display: flex; align-items: center; justify-content: space-between;
}
.user-card button {
  background: none; border: 0; color: var(--text-3);
  font: inherit; cursor: pointer; font-size: 10px;
  letter-spacing: 1.5px; text-transform: uppercase; padding: 4px 0;
  opacity: 0;
  transition: opacity 0.2s, color 0.15s;
}
.sidebar:hover .user-card button { opacity: 1; }
.user-card button:hover { color: var(--emerald-4); }

/* Top bar */
.topbar {
  padding: 28px 36px 18px;
  border-bottom: 1px solid var(--ink-3);
  display: flex; align-items: flex-end; justify-content: space-between;
  margin-bottom: 28px;
}
.topbar-title {
  font-family: var(--font-display);
  font-size: 30px;
  font-weight: 500;
  letter-spacing: 0.5px;
}
.topbar-title::first-letter { color: var(--emerald-4); }
.topbar-actions { display: flex; gap: 8px; align-items: center; }

/* App layout */
.app-layout { display: flex; min-height: 100vh; }
.main { flex: 1; max-width: 1280px; padding: 0 36px 48px; min-width: 0; }
.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 24px; }

/* Empty state */
.empty {
  text-align: center; padding: 48px 24px;
  color: var(--text-3);
  border: 1px dashed var(--ink-3);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.15);
}
.empty h3 { color: var(--text-2); margin-bottom: 8px; font-family: var(--font-display); }

/* Alert */
.alert {
  border: 1px solid var(--emerald-2);
  border-left: 3px solid var(--emerald-3);
  background: var(--emerald-glow);
  padding: 14px 18px;
  border-radius: 0 4px 4px 0;
  margin-bottom: 18px;
  font-size: 13px;
  color: var(--text-1);
}
.alert ul { margin: 10px 0 0 18px; line-height: 1.8; }
```

- [ ] **Step 3: Write animations.css**

`client/src/styles/animations.css`:
```css
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes slide-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes slide-in-right {
  from { opacity: 0; transform: translateX(16px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes gold-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--gold-glow); }
  50% { box-shadow: 0 0 0 4px transparent; }
}
```

- [ ] **Step 4: Write failing Button test**

```typescript
// client/src/__tests__/Button.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/preact";
import { Button } from "../components/Button";

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText("Click me")).toBeInTheDocument();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByText("Go"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies variant class", () => {
    render(<Button variant="ghost">Ghost</Button>);
    expect(screen.getByText("Ghost")).toHaveClass("btn-ghost");
  });

  it("applies danger variant", () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByText("Delete")).toHaveClass("btn-danger");
  });
});
```

- [ ] **Step 5: Run test, expect fail**

Run: `cd client && npx vitest run src/__tests__/Button.test.tsx`
Expected: FAIL.

- [ ] **Step 6: Implement Button**

`client/src/components/Button.tsx`:
```typescript
import type { ComponentChildren, JSX } from "preact";

type Variant = "primary" | "ghost" | "danger" | "link";
type Size = "sm" | "md";

export interface ButtonProps {
  children: ComponentChildren;
  onClick?: (e: MouseEvent) => void;
  variant?: Variant;
  size?: Size;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  title?: string;
  style?: JSX.CSSProperties;
}

export function Button({
  children, onClick, variant = "primary", size = "md",
  type = "button", disabled, title, style,
}: ButtonProps) {
  const classes = [
    "btn",
    variant === "ghost" && "btn-ghost",
    variant === "danger" && "btn-danger",
    size === "sm" && "btn-sm",
  ].filter(Boolean).join(" ");
  return (
    <button type={type} class={classes} onClick={onClick} disabled={disabled} title={title} style={style}>
      {children}
    </button>
  );
}
```

- [ ] **Step 7: Run test, expect pass**

Run: `cd client && npx vitest run src/__tests__/Button.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 8: Implement Card, Badge, Stat**

`client/src/components/Card.tsx`:
```typescript
import type { ComponentChildren } from "preact";

export function Card({ children, title, sub }: { children: ComponentChildren; title?: string; sub?: string }) {
  return (
    <div class="surface">
      {title && <div class="card-title">{title}</div>}
      {sub && <p class="card-sub">{sub}</p>}
      {children}
    </div>
  );
}
```

`client/src/components/Badge.tsx`:
```typescript
import type { ComponentChildren } from "preact";

type Variant = "active" | "error" | "muted" | "warn" | "default";

export function Badge({ children, variant = "default", pulse }: { children: ComponentChildren; variant?: Variant; pulse?: boolean }) {
  const cls = variant === "default" ? "badge" : `badge badge-${variant}`;
  return <span class={`${cls}${pulse ? " badge-pulse" : ""}`}>{children}</span>;
}
```

`client/src/components/Stat.tsx`:
```typescript
export function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div class="stat">
      <div class="stat-label">{label}</div>
      <div class="stat-value">{value}</div>
      {sub && <div class="stat-sub">{sub}</div>}
    </div>
  );
}
```

- [ ] **Step 9: Commit**

```bash
git add client/src/components/ client/src/styles/ client/src/__tests__/setup.ts
git commit -m "feat(client): base components — Button, Card, Badge, Stat + theme CSS"
```

---

## Task 4: Modal + Toast + ToastProvider

**Files:**
- Create: `client/src/components/Modal.tsx`
- Create: `client/src/components/Toast.tsx`
- Create: `client/src/components/ToastProvider.tsx`
- Create: `client/src/__tests__/Modal.test.tsx`
- Create: `client/src/__tests__/Toast.test.tsx`

- [ ] **Step 1: Write Modal test**

```typescript
// client/src/__tests__/Modal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/preact";
import { Modal } from "../components/Modal";

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(<Modal open={false} onClose={() => {}} title="T">Body</Modal>);
    expect(screen.queryByText("Body")).not.toBeInTheDocument();
  });

  it("renders children when open", () => {
    render(<Modal open={true} onClose={() => {}} title="Hello">Body content</Modal>);
    expect(screen.getByText("Body content")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("calls onClose when backdrop clicked", () => {
    const onClose = vi.fn();
    const { container } = render(<Modal open={true} onClose={onClose} title="T">B</Modal>);
    const backdrop = container.querySelector(".modal-backdrop")!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when ESC pressed", () => {
    const onClose = vi.fn();
    render(<Modal open={true} onClose={onClose} title="T">B</Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd client && npx vitest run src/__tests__/Modal.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement Modal**

`client/src/components/Modal.tsx`:
```typescript
import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ComponentChildren;
  footer?: ComponentChildren;
  width?: number;
}

export function Modal({ open, onClose, title, children, footer, width }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div class="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="modal" style={width ? { maxWidth: `${width}px` } : undefined}>
        <div class="modal-header">
          <div class="modal-title">{title}</div>
          <button class="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div class="modal-body">{children}</div>
        {footer && <div class="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd client && npx vitest run src/__tests__/Modal.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Write Toast test**

```typescript
// client/src/__tests__/Toast.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/preact";
import { ToastProvider, useToast } from "../components/ToastProvider";

function Trigger() {
  const toast = useToast();
  return <button onClick={() => toast.success("Saved!")}>Go</button>;
}

describe("Toast", () => {
  it("renders success toast when triggered", () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    );
    act(() => { screen.getByText("Go").click(); });
    expect(screen.getByText("Saved!")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run, expect fail**

Run: `cd client && npx vitest run src/__tests__/Toast.test.tsx`
Expected: FAIL.

- [ ] **Step 7: Implement Toast + ToastProvider**

`client/src/components/Toast.tsx`:
```typescript
export type ToastVariant = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

export function ToastView({ item }: { item: ToastItem }) {
  const icon = item.variant === "success" ? "✓" : item.variant === "error" ? "✕" : "ℹ";
  return (
    <div class={`toast toast-${item.variant}`}>
      <span class="toast-icon">{icon}</span>
      <span>{item.message}</span>
    </div>
  );
}
```

`client/src/components/ToastProvider.tsx`:
```typescript
import { createContext } from "preact";
import { useCallback, useContext, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { ToastView, type ToastItem, type ToastVariant } from "./Toast";

interface ToastContext {
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
}
const Ctx = createContext<ToastContext | null>(null);

export function useToast(): ToastContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ComponentChildren }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const add = useCallback((message: string, variant: ToastVariant) => {
    const id = Date.now() + Math.random();
    setItems(prev => [...prev.slice(-4), { id, message, variant }]);
    setTimeout(() => {
      setItems(prev => prev.filter(i => i.id !== id));
    }, 3000);
  }, []);
  const ctx: ToastContext = {
    success: (m) => add(m, "success"),
    error: (m) => add(m, "error"),
    info: (m) => add(m, "info"),
  };
  return (
    <Ctx.Provider value={ctx}>
      {children}
      <div class="toast-stack">
        {items.map(i => <ToastView key={i.id} item={i} />)}
      </div>
    </Ctx.Provider>
  );
}
```

- [ ] **Step 8: Run, expect pass**

Run: `cd client && npx vitest run src/__tests__/Toast.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 9: Commit**

```bash
git add client/src/components/Modal.tsx client/src/components/Toast.tsx client/src/components/ToastProvider.tsx client/src/__tests__/Modal.test.tsx client/src/__tests__/Toast.test.tsx
git commit -m "feat(client): Modal + Toast + ToastProvider"
```

---

## Task 5: AppShell + Sidebar + TopBar + Router skeleton

**Files:**
- Create: `client/src/components/Icon.tsx`
- Create: `client/src/components/Switch.tsx`
- Create: `client/src/components/Progress.tsx`
- Create: `client/src/layout/Sidebar.tsx`
- Create: `client/src/layout/TopBar.tsx`
- Create: `client/src/layout/AppShell.tsx`
- Create: `client/src/pages/Placeholder.tsx`
- Create: `client/src/__tests__/Sidebar.test.tsx`

- [ ] **Step 1: Implement Icon (inline SVG set)**

`client/src/components/Icon.tsx`:
```typescript
type IconName = "overview" | "usage" | "client-keys" | "accounts" | "models" | "quota" | "settings" | "search";

const paths: Record<IconName, JSX.Element> = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  usage: <><path d="M3 3v18h18" /><path d="M7 14l4-4 4 4 5-5" /></>,
  "client-keys": <><circle cx="8" cy="15" r="4" /><path d="M10.85 12.15L19 4" /><path d="M18 5l3 3" /><path d="M15 8l3 3" /></>,
  accounts: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  models: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 9h6v6H9z" /><path d="M9 1v3" /><path d="M15 1v3" /><path d="M9 20v3" /><path d="M15 20v3" /><path d="M20 9h3" /><path d="M20 15h3" /><path d="M1 9h3" /><path d="M1 15h3" /></>,
  quota: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></>,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      {paths[name]}
    </svg>
  );
}
```

- [ ] **Step 2: Implement Switch + Progress**

`client/src/components/Switch.tsx`:
```typescript
export interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}
export function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <label class="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span class="switch-track"><span class="switch-thumb" /></span>
      {label && <span>{label}</span>}
    </label>
  );
}
```

`client/src/components/Progress.tsx`:
```typescript
export function Progress({ value, max, warn }: { value: number; max: number; warn?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div class="progress">
      <div class={`progress-fill${warn ? " warn" : ""}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
```

- [ ] **Step 3: Write Sidebar test**

```typescript
// client/src/__tests__/Sidebar.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/preact";
import { Sidebar } from "../layout/Sidebar";

describe("Sidebar", () => {
  it("renders brand and nav items", () => {
    render(<Sidebar current="overview" />);
    expect(screen.getByText("kelola-router")).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Usage")).toBeInTheDocument();
    expect(screen.getByText("Client keys")).toBeInTheDocument();
    expect(screen.getByText("Upstream")).toBeInTheDocument();
    expect(screen.getByText("Models")).toBeInTheDocument();
    expect(screen.getByText("Quota")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("marks current item as active", () => {
    render(<Sidebar current="usage" />);
    const usageLink = screen.getByText("Usage").closest("a")!;
    expect(usageLink.className).toContain("active");
  });
});
```

- [ ] **Step 4: Run, expect fail**

Run: `cd client && npx vitest run src/__tests__/Sidebar.test.tsx`
Expected: FAIL.

- [ ] **Step 5: Implement Sidebar**

`client/src/components/Sidebar.tsx` → move to `client/src/layout/Sidebar.tsx`:
```typescript
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Icon, type IconName } from "../components/Icon";

interface NavItem { key: string; label: string; href: string; icon: IconName; }

const NAV: NavItem[] = [
  { key: "overview", label: "Overview", href: "/admin", icon: "overview" },
  { key: "usage", label: "Usage", href: "/admin/usage", icon: "usage" },
  { key: "client-keys", label: "Client keys", href: "/admin/client-keys", icon: "client-keys" },
  { key: "accounts", label: "Upstream", href: "/admin/accounts", icon: "accounts" },
  { key: "models", label: "Models", href: "/admin/models", icon: "models" },
  { key: "quota", label: "Quota", href: "/admin/quota", icon: "quota" },
  { key: "settings", label: "Settings", href: "/admin/settings", icon: "settings" },
];

export function Sidebar({ current }: { current: string }) {
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<{ authed: boolean; passwordSet: boolean }>("/api/me"),
    refetchOnWindowFocus: true,
  });
  return (
    <aside class="sidebar">
      <div class="brand">
        kelola-router
        <span class="brand-tag">{me?.passwordSet ? "PROTECTED" : "OPEN MODE"}</span>
      </div>
      <nav class="nav">
        {NAV.map(n => (
          <a key={n.key} href={`#${n.href}`} class={`nav-item${n.key === current ? " active" : ""}`}>
            <span class="nav-icon"><Icon name={n.icon} /></span>
            <span class="nav-label">{n.label}</span>
          </a>
        ))}
      </nav>
      <div class="user-card">
        <span class="user-name">v0.9</span>
        {me?.passwordSet && (
          <button onClick={() => apiFetch("/api/logout", { method: "POST" }).then(() => location.reload())}>
            Sign out
          </button>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 6: Implement TopBar + AppShell + Placeholder**

`client/src/layout/TopBar.tsx`:
```typescript
import type { ComponentChildren } from "preact";
export function TopBar({ title, actions }: { title: string; actions?: ComponentChildren }) {
  return (
    <div class="topbar">
      <h1 class="topbar-title">{title}</h1>
      {actions && <div class="topbar-actions">{actions}</div>}
    </div>
  );
}
```

`client/src/pages/Placeholder.tsx`:
```typescript
export function Placeholder({ name }: { name: string }) {
  return (
    <div class="empty">
      <h3>{name}</h3>
      <p>Coming in Phase 3.</p>
    </div>
  );
}
```

`client/src/layout/AppShell.tsx`:
```typescript
import { useState, useEffect } from "preact/hooks";
import { Sidebar } from "./Sidebar";
import { CommandPalette } from "../components/CommandPalette";

export function AppShell() {
  const [current, setCurrent] = useState<string>(() => location.hash.replace(/^#\/admin\/?/, "") || "overview");
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onHash = () => {
      const path = location.hash.replace(/^#\/admin\/?/, "");
      setCurrent(path || "overview");
    };
    window.addEventListener("hashchange", onHash);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div class="app-layout">
      <Sidebar current={current} />
      <main class="main">
        {/* Phase 3 wires real pages here */}
        <p>Phase 2 scaffold — app shell rendering at /{current}</p>
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={(href) => { location.hash = href; setPaletteOpen(false); }} />
    </div>
  );
}
```

- [ ] **Step 7: Run Sidebar test, expect pass**

Run: `cd client && npx vitest run src/__tests__/Sidebar.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add client/src/components/Icon.tsx client/src/components/Switch.tsx client/src/components/Progress.tsx client/src/layout/ client/src/pages/Placeholder.tsx client/src/__tests__/Sidebar.test.tsx
git commit -m "feat(client): app shell — sidebar rail + topbar + router skeleton"
```

---

## Task 6: CommandPalette (basic, fuzzy list)

**Files:**
- Create: `client/src/components/CommandPalette.tsx`

- [ ] **Step 1: Implement**

```typescript
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Modal } from "./Modal";
import { Icon } from "./Icon";

const ITEMS = [
  { label: "Overview", href: "/admin", keys: "g o" },
  { label: "Usage", href: "/admin/usage", keys: "g u" },
  { label: "Client keys", href: "/admin/client-keys", keys: "g c" },
  { label: "Upstream accounts", href: "/admin/accounts", keys: "g a" },
  { label: "Models", href: "/admin/models", keys: "g m" },
  { label: "Quota", href: "/admin/quota", keys: "g q" },
  { label: "Settings", href: "/admin/settings", keys: "g s" },
];

function fuzzy(q: string, text: string): number {
  if (!q) return 1;
  q = q.toLowerCase(); text = text.toLowerCase();
  let i = 0, score = 0;
  for (const ch of text) { if (ch === q[i]) { i++; score += 1; if (i === q.length) break; } }
  return i === q.length ? score : 0;
}

export function CommandPalette({ open, onClose, onNavigate }: { open: boolean; onClose: () => void; onNavigate: (href: string) => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setQ(""); setActive(0); setTimeout(() => inputRef.current?.focus(), 50); } }, [open]);

  const items = useMemo(() => {
    return ITEMS
      .map(i => ({ ...i, score: fuzzy(q, i.label) }))
      .filter(i => i.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [q]);

  return (
    <div class="cmdk" style={open ? {} : { display: "none" }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="cmdk-modal">
        <input ref={inputRef} class="cmdk-input" placeholder="Search pages..." value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(items.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
            else if (e.key === "Enter" && items[active]) { onNavigate(items[active].href); }
            else if (e.key === "Escape") onClose();
          }} />
        <div class="cmdk-list">
          {items.length === 0
            ? <div class="cmdk-item" style={{ color: "var(--text-3)" }}>No matches</div>
            : items.map((it, i) => (
              <div key={it.href} class={`cmdk-item${i === active ? " active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => onNavigate(it.href)}>
                <Icon name="search" size={14} />
                <span>{it.label}</span>
                <span class="cmdk-item-meta">{it.keys}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify manually**

Run `npm run dev`, open http://localhost:5173, press `⌘K` (or `Ctrl+K`). Type "us" → see "Usage" highlighted. Press Enter → navigate.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/CommandPalette.tsx
git commit -m "feat(client): command palette with fuzzy search"
```

---

## Task 7: Phase 2 verification

- [ ] **Step 1: Type check client**

Run: `cd client && npm run typecheck`
Expected: exit 0.

- [ ] **Step 2: Run all client tests**

Run: `cd client && npm test`
Expected: PASS (10+ tests).

- [ ] **Step 3: Type check server (regression)**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Full server test suite**

Run: `npm test`
Expected: all tests pass (no regression from Phase 1).

- [ ] **Step 5: Manual smoke**

1. Run `npm run dev`.
2. Open http://localhost:5173 — see sidebar with 7 items, top bar, "Phase 2 scaffold" message.
3. Hover sidebar — expands to 240px with labels.
4. Press `⌘K` — palette opens.
5. Type "us" → see "Usage" in list.
6. Press Enter → navigate to `/admin/usage` (still shows placeholder until Phase 3).

- [ ] **Step 6: Final commit if cleanup needed**

```bash
git add -A
git commit -m "chore(phase-2): typecheck + test cleanup" --allow-empty
```

---

## Phase 2 Done

Client scaffold complete. Vite + Preact + theme system + 10 components + app shell + command palette. ~10 client tests, all green. ~2 dev artifacts (dev server, ~5s build).

Next: Phase 3 — page implementations (Overview, Usage, ClientKeys, Accounts, Models, Quota, Settings, Login).
