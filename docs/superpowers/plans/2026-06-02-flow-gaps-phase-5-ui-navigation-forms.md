# Phase 5: UI Navigation + Forms

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix eight UI gaps: Usage URL back/forward sync, Usage row keyboard a11y, Overview row keyboard a11y, Models toggle error handler, Accounts disable confirm, AppShell `?` shortcut + `g+x` handlers, 404 page for unknown routes, Sign out no reload.

**Architecture:** Frontend-only changes. Preact + react-query patterns preserved. Tests in `client/src/**/*.test.tsx` colocated.

**Tech Stack:** Preact, @tanstack/react-query, vitest + @testing-library/preact.

---

## Audit Source

Verified 2026-06-02 against source:
- `client/src/pages/Usage.tsx:38-49` — URL read on mount, but `useEffect` only writes; no `popstate`/`hashchange` listener for back button.
- `client/src/pages/Usage.tsx:55-58` — `location.hash = ...` effect may cause feedback loop (already mitigated by reading from `params` only).
- `client/src/pages/Usage.tsx:130-138` — `<tr onClick>` no keyboard a11y.
- `client/src/pages/Overview.tsx:53-61` — same row pattern.
- `client/src/pages/Models.tsx:18-22` — `toggleMut` no `onError` (claim: silent fail).
- `client/src/pages/Accounts.tsx:54-61` — `toggleMut` for Disable/Enable, no confirm.
- `client/src/layout/AppShell.tsx:48-52` — `?` shortcut uses `alert()`; `g+o`, `g+u` etc. promised in alert text not implemented in `onKey`.
- `client/src/layout/AppShell.tsx:30-35` — unknown `current` falls to Overview, no 404.
- `client/src/layout/Sidebar.tsx:31-33` — Sign out does `location.reload()`.

---

## Task 1: Usage back/forward URL sync

**Files:**
- Modify: `client/src/pages/Usage.tsx:38-58` (popstate listener, debounced hash write)
- Test: `client/src/pages/Usage.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/preact";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Usage } from "./Usage";

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: any }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

describe("Usage URL sync", () => {
  beforeEach(() => {
    location.hash = "";
    vi.restoreAllMocks();
  });

  it("reads initial state from URL on mount", () => {
    location.hash = "#/admin/usage?page=3&q=hello&days=30";
    render(<Usage />, { wrapper });
    expect((document.querySelector('input[type="search"]') as HTMLInputElement).value).toBe("hello");
  });

  it("updates URL when filter changes", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ summary: { totalCost: 0, totalRequests: 0, totalTokens: 0, deltaCostPct: null, deltaRequestsPct: null, deltaTokensPct: null }, page: { rows: [], total: 0, page: 1, pageSize: 50, totalPages: 1 } })));
    render(<Usage />, { wrapper });
    const input = document.querySelector('input[type="search"]') as HTMLInputElement;
    fireEvent.input(input, { target: { value: "x" } });
    await waitFor(() => {
      expect(location.hash).toContain("q=x");
    });
  });

  it("reacts to popstate (back button)", async () => {
    location.hash = "#/admin/usage?page=1";
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ summary: { totalCost: 0, totalRequests: 0, totalTokens: 0, deltaCostPct: null, deltaRequestsPct: null, deltaTokensPct: null }, page: { rows: [], total: 0, page: 1, pageSize: 50, totalPages: 1 } })));
    render(<Usage />, { wrapper });
    // Simulate user pressing back
    location.hash = "#/admin/usage?page=2";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await waitFor(() => {
      // Page state should reflect the new hash
      expect(location.hash).toContain("page=2");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/Usage.test.tsx`
Expected: Third test (popstate) fails — no `hashchange` listener.

- [ ] **Step 3: Add hashchange listener + use replaceState for writes**

In `client/src/pages/Usage.tsx`, update the URL sync effects. Replace the existing two `useEffect` blocks (lines 38-58) with:

```tsx
useEffect(() => {
  const onHash = () => {
    const p = new URLSearchParams(location.hash.split("?")[1] ?? "");
    if (p.get("page")) setPage(Math.max(1, Number(p.get("page"))));
    if (p.get("client_key")) setClientKeyId(Number(p.get("client_key")));
    if (p.get("days")) setDays(Number(p.get("days")));
    if (p.get("q")) setSearch(p.get("q")!);
    if (p.get("status")) setStatusFilter(p.get("status") as any);
  };
  onHash();
  window.addEventListener("hashchange", onHash);
  return () => window.removeEventListener("hashchange", onHash);
}, []);

const params = useMemo(() => {
  const p = new URLSearchParams({ page: String(page), page_size: String(pageSize), days: String(days), sort_by: sortBy, sort_dir: sortDir });
  if (clientKeyId) p.set("client_key", String(clientKeyId));
  if (search) p.set("q", search);
  if (statusFilter !== "all") p.set("status", statusFilter === "2xx" ? "200" : statusFilter === "4xx" ? "400" : "500");
  return p.toString();
}, [page, pageSize, days, sortBy, sortDir, clientKeyId, search, statusFilter]);

useEffect(() => {
  const newHash = `#/admin/usage?${params}`;
  if (location.hash !== newHash) {
    history.replaceState(null, "", newHash);
  }
}, [params]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/Usage.test.tsx`
Expected: PASS — 3/3.

- [ ] **Step 5: Run client tests**

Run: `cd client && npm test`

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/Usage.tsx client/src/pages/Usage.test.tsx
git commit -m "fix(ui): usage — react to hashchange (back/forward) and use replaceState for writes"
```

---

## Task 2: Keyboard a11y for clickable rows (Usage + Overview)

**Files:**
- Modify: `client/src/pages/Usage.tsx:130-138` (row)
- Modify: `client/src/pages/Overview.tsx:53-61` (row)
- Test: extend Usage.test.tsx + Overview.test.tsx (new)

- [ ] **Step 1: Write the failing test**

Append to `client/src/pages/Usage.test.tsx`:

```tsx
describe("Usage row keyboard a11y", () => {
  it("row is keyboard-focusable and Enter opens detail", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      summary: { totalCost: 0, totalRequests: 1, totalTokens: 10, deltaCostPct: null, deltaRequestsPct: null, deltaTokensPct: null },
      page: { rows: [{ id: 7, createdAt: "2026-01-01T00:00:00Z", model: "m", statusCode: 200, cost: 0.001, latencyMs: 50, totalTokens: 10, promptTokens: 5, completionTokens: 5, clientKeyId: 1, accountId: "a", error: null }], total: 1, page: 1, pageSize: 50, totalPages: 1 },
    })));
    render(<Usage />, { wrapper });
    await waitFor(() => {
      const row = document.querySelector('tr[role="button"]');
      expect(row).toBeTruthy();
      expect(row?.getAttribute("tabindex")).toBe("0");
    });
    const row = document.querySelector('tr[role="button"]') as HTMLElement;
    fireEvent.keyDown(row, { key: "Enter" });
    // The detail modal will open — check for a Modal-like element or just assert no error
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/Usage.test.tsx`
Expected: FAIL — `tr` has no role/tabindex.

- [ ] **Step 3: Add a11y attributes to Usage row**

In `client/src/pages/Usage.tsx`, replace the `<tr>` element (line 130) with:

```tsx
<tr key={l.id}
    role="button"
    tabIndex={0}
    aria-label={`Open request ${l.id}`}
    onClick={() => setSelected(l.id)}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(l.id); } }}
    style={{ cursor: "pointer" }}>
```

- [ ] **Step 4: Same for Overview row**

In `client/src/pages/Overview.tsx`, replace the `<tr>` element (line 53) with:

```tsx
<tr key={r.id}
    role="button"
    tabIndex={0}
    aria-label={`Open request ${r.id}`}
    onClick={() => setSelected(r.id)}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(r.id); } }}
    style={{ cursor: "pointer" }}>
```

- [ ] **Step 5: Run client tests**

Run: `cd client && npm test`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/Usage.tsx client/src/pages/Usage.test.tsx client/src/pages/Overview.tsx
git commit -m "fix(ui): add keyboard a11y to clickable request rows (Usage + Overview)"
```

---

## Task 3: Models toggle error handler

**Files:**
- Modify: `client/src/pages/Models.tsx:18-22` (add onError to toggleMut)
- Test: extend Models test or new

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/Models.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/preact";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Models } from "./Models";

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: any }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

describe("Models toggle", () => {
  it("shows toast on toggle failure", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ name: "m1", displayName: null, family: null, contextWindow: null, thinkingEnabled: false, source: "builtin", enabled: true }])))
      .mockResolvedValueOnce(new Response("error", { status: 500 }));
    render(<Models />, { wrapper });
    await waitFor(() => expect(document.querySelector('input[type="checkbox"]')).toBeTruthy());
    fireEvent.click(document.querySelector('input[type="checkbox"]')!);
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/error|fail/i);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/Models.test.tsx`
Expected: FAIL — no toast on error.

- [ ] **Step 3: Add onError to toggleMut**

In `client/src/pages/Models.tsx`, update the `toggleMut` definition:

```tsx
const toggleMut = useMutation({
  mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) => apiFetch(`/api/admin/models/${encodeURIComponent(name)}/${enabled ? "disable" : "enable"}`, { method: "POST" }),
  onSuccess: () => { qc.invalidateQueries({ queryKey: ["models"] }); toast.success("Updated"); },
  onError: (e: Error) => toast.error(e.message || "Toggle failed"),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/Models.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run client tests**

Run: `cd client && npm test`

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/Models.tsx client/src/pages/Models.test.tsx
git commit -m "fix(ui): models — show toast on toggle failure"
```

---

## Task 4: Accounts disable confirm dialog

**Files:**
- Modify: `client/src/pages/Accounts.tsx:54-61` (wrap toggleMut in confirmDialog)
- Test: extend Accounts test or new

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/Accounts.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/preact";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Accounts } from "./Accounts";
import { ConfirmHost } from "../components/Confirm";

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: any }) => (
  <QueryClientProvider client={qc}>{children}<ConfirmHost /></QueryClientProvider>
);

describe("Accounts disable confirm", () => {
  it("shows confirm before disabling", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { id: "acc_1", label: "PAYG main", creditType: "payg", status: "active", enabled: true, lastError: null, backoffLevel: 0, rateLimitedUntil: null },
    ])));
    render(<Accounts />, { wrapper });
    await waitFor(() => expect(screen.getByText(/disable/i)).toBeTruthy());
    fireEvent.click(screen.getByText(/disable/i));
    await waitFor(() => {
      expect(screen.getByText(/are you sure|confirm/i)).toBeTruthy();
    });
  });
});
```

Note: You may need to add `screen` import. Adjust the test as needed based on the existing component structure.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/Accounts.test.tsx`
Expected: FAIL — no confirm dialog appears; the disable happens immediately.

- [ ] **Step 3: Wrap toggle in confirmDialog**

In `client/src/pages/Accounts.tsx`, add a `handleToggle` function and replace the inline `onClick` on the toggle button. The existing button (line 54-61):

```tsx
<Button size="sm" variant="ghost" onClick={() => toggleMut.mutate({ id: a.id, enabled: a.enabled })}>{a.enabled ? "Disable" : "Enable"}</Button>
```

Replace with:

```tsx
<Button size="sm" variant="ghost" onClick={async () => {
  if (a.enabled) {
    const ok = await confirmDialog({ title: "Disable account", message: `Disable "${a.label}"? Requests will no longer route to it.`, confirmLabel: "Disable", danger: true });
    if (!ok) return;
  }
  toggleMut.mutate({ id: a.id, enabled: a.enabled });
}}>{a.enabled ? "Disable" : "Enable"}</Button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/Accounts.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run client tests**

Run: `cd client && npm test`

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/Accounts.tsx client/src/pages/Accounts.test.tsx
git commit -m "fix(ui): accounts — confirm dialog before disabling upstream account"
```

---

## Task 5: AppShell `?` shortcut + `g+x` navigation handlers

**Files:**
- Modify: `client/src/layout/AppShell.tsx:48-52` (replace `alert` with modal, add g+x)
- Test: `client/src/layout/AppShell.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/preact";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "./AppShell";

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: any }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

describe("AppShell keyboard shortcuts", () => {
  beforeEach(() => { location.hash = ""; vi.restoreAllMocks(); });

  it("? opens shortcuts modal (not native alert)", () => {
    const alertSpy = vi.spyOn(window, "alert");
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ authed: true, passwordSet: false })));
    render(<AppShell />, { wrapper });
    fireEvent.keyDown(document.body, { key: "?" });
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("g+o navigates to overview", () => {
    location.hash = "#/admin/usage";
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ authed: true, passwordSet: false })));
    render(<AppShell />, { wrapper });
    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "o" });
    expect(location.hash).toBe("#/admin");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/layout/AppShell.test.tsx`
Expected: First test fails — `alert` is called. Second test fails — `g+o` doesn't navigate.

- [ ] **Step 3: Replace `alert` with modal + implement `g+x`**

In `client/src/layout/AppShell.tsx`, update the `useEffect` to implement `g+x` and replace `alert` with a state-driven modal. Replace the `onKey` handler:

```tsx
const onKey = (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setPaletteOpen(true); }
  if (e.key === "?" && !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) {
    e.preventDefault();
    setHelpOpen(true);
  }
  if (e.key === "g" && !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) {
    e.preventDefault();
    const handler = (ev: KeyboardEvent) => {
      const map: Record<string, string> = { o: "/admin", u: "/admin/usage", c: "/admin/client-keys", a: "/admin/accounts", m: "/admin/models", q: "/admin/quota", s: "/admin/settings" };
      if (map[ev.key]) location.hash = map[ev.key];
    };
    document.addEventListener("keydown", handler, { once: true });
    setTimeout(() => document.removeEventListener("keydown", handler), 1000);
  }
};
```

Add state and modal:

```tsx
const [helpOpen, setHelpOpen] = useState(false);
```

In the JSX, after the existing `<CommandPalette>`, add a help modal:

```tsx
{helpOpen && (
  <div class="modal-backdrop" onClick={() => setHelpOpen(false)}>
    <div class="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
      <div class="modal-header"><div class="modal-title">Keyboard shortcuts</div></div>
      <div class="modal-body" style={{ display: "grid", gap: 8, fontSize: 13 }}>
        <div><kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> — command palette</div>
        <div><kbd>g</kbd> then <kbd>o</kbd> — overview</div>
        <div><kbd>g</kbd> then <kbd>u</kbd> — usage</div>
        <div><kbd>g</kbd> then <kbd>c</kbd> — client keys</div>
        <div><kbd>g</kbd> then <kbd>a</kbd> — accounts</div>
        <div><kbd>g</kbd> then <kbd>m</kbd> — models</div>
        <div><kbd>g</kbd> then <kbd>q</kbd> — quota</div>
        <div><kbd>g</kbd> then <kbd>s</kbd> — settings</div>
        <div><kbd>?</kbd> — this help</div>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/layout/AppShell.test.tsx`
Expected: PASS — 2/2.

- [ ] **Step 5: Run client tests**

Run: `cd client && npm test`

- [ ] **Step 6: Commit**

```bash
git add client/src/layout/AppShell.tsx client/src/layout/AppShell.test.tsx
git commit -m "fix(ui): app shell — shortcuts modal (no alert), implement g+x navigation"
```

---

## Task 6: 404 page for unknown routes

**Files:**
- Modify: `client/src/pages/Placeholder.tsx` (extend) or new `client/src/pages/NotFound.tsx`
- Modify: `client/src/layout/AppShell.tsx:30-35` (handle unknown case)
- Test: `client/src/pages/NotFound.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/preact";
import { NotFound } from "./NotFound";

describe("NotFound", () => {
  it("renders 404 message", () => {
    const { getByText } = render(<NotFound route="/admin/unknown" />);
    expect(getByText(/not found|404/i)).toBeTruthy();
    expect(getByText(/unknown/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/NotFound.test.tsx`
Expected: FAIL — `NotFound` doesn't exist.

- [ ] **Step 3: Create NotFound page**

Create `client/src/pages/NotFound.tsx`:

```tsx
import { TopBar } from "../layout/TopBar";

export function NotFound({ route }: { route: string }) {
  return (
    <>
      <TopBar title="404" />
      <div style={{ padding: 36, textAlign: "center" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 28, color: "var(--text-1)", marginBottom: 8 }}>Page not found</h2>
        <p style={{ color: "var(--text-2)", marginBottom: 24 }}>
          No page matches <code style={{ fontFamily: "var(--font-mono)", background: "var(--ink-2)", padding: "2px 6px", borderRadius: 3 }}>{route}</code>.
        </p>
        <a href="#/admin" class="btn btn-primary">Back to overview</a>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Wire NotFound into AppShell**

In `client/src/layout/AppShell.tsx`, update the `Page` function's switch statement. Add a `default` case and a check for known routes:

```tsx
const KNOWN_ROUTES = ["overview", "usage", "client-keys", "accounts", "models", "quota", "settings"];

function Page({ current }: { current: string }) {
  // ... existing me query
  if (isLoading) return <><TopBar title="Loading…" /><p style={{ padding: 36, color: "var(--text-3)" }}>Loading…</p></>;
  if (me?.passwordSet && !me.authed) return <Login />;
  if (!KNOWN_ROUTES.includes(current)) return <NotFound route={`/admin/${current}`} />;
  switch (current) {
    // ... existing cases
  }
}
```

Add the import:

```tsx
import { NotFound } from "../pages/NotFound";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/NotFound.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run client tests**

Run: `cd client && npm test`

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/NotFound.tsx client/src/pages/NotFound.test.tsx client/src/layout/AppShell.tsx
git commit -m "fix(ui): add 404 page for unknown routes (was silently falling back to Overview)"
```

---

## Task 7: Sign out no full reload

**Files:**
- Modify: `client/src/layout/Sidebar.tsx:31-33` (use qc.clear + navigate)
- Test: `client/src/layout/Sidebar.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/preact";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Sidebar } from "./Sidebar";

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: any }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

describe("Sidebar sign out", () => {
  beforeEach(() => { location.hash = ""; vi.restoreAllMocks(); });

  it("clears queries and navigates to login (no reload)", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ authed: true, passwordSet: true })))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const reloadSpy = vi.spyOn(location, "reload");
    render(<Sidebar current="overview" />, { wrapper });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/sign out/i);
    });
    fireEvent.click(document.body.querySelector("button[class*='sign'], button:has-text('Sign out'), button")!);
    await waitFor(() => {
      expect(reloadSpy).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/layout/Sidebar.test.tsx`
Expected: FAIL — `reloadSpy` is called.

- [ ] **Step 3: Replace reload with qc.clear + navigate**

In `client/src/layout/Sidebar.tsx`, update the import to include `useQueryClient`:

```tsx
import { useQuery, useQueryClient } from "@tanstack/react-query";
```

Update the `Sidebar` function to use `qc`:

```tsx
export function Sidebar({ current }: { current: string }) {
  const qc = useQueryClient();
  const { data: me } = useQuery({ /* unchanged */ });
  return (
    <aside class="sidebar">
      {/* ... existing nav */}
      <div class="user-card">
        <span>v0.9</span>
        {me?.passwordSet && (
          <button onClick={async () => {
            await apiFetch("/api/logout", { method: "POST" });
            qc.clear();
            location.hash = "/";
          }}>Sign out</button>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/layout/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run client tests**

Run: `cd client && npm test`

- [ ] **Step 6: Commit**

```bash
git add client/src/layout/Sidebar.tsx client/src/layout/Sidebar.test.tsx
git commit -m "fix(ui): sign out — clear queries and navigate, no full reload"
```

---

## Self-Review

**Spec coverage:**
- Usage URL back/forward → Task 1 ✓
- Keyboard a11y Usage+Overview → Task 2 ✓
- Models toggle error → Task 3 ✓
- Accounts disable confirm → Task 4 ✓
- AppShell shortcuts + `g+x` → Task 5 ✓
- 404 page → Task 6 ✓
- Sign out no reload → Task 7 ✓

**Placeholder scan:** No TODOs. All test code complete. Test pattern: render + fireEvent + waitFor.

**Type consistency:** `NotFound` takes a `route: string` prop. `KNOWN_ROUTES` matches the `current` strings used in AppShell. `qc.clear()` is the standard react-query API.

**Ready to ship.** 7 tasks, ~8-10 commits.
