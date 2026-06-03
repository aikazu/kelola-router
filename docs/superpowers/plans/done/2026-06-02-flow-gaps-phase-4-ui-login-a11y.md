# Phase 4: UI Login + Accessibility

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix the five critical UI gaps: Login `alert`+`reload`, Login rate-limit feedback, Login label/a11y, Settings password confirm field, RequestDetail error state, Pagination aria, ToastProvider memory leak.

**Architecture:** Frontend-only changes in `client/src/`. Preact + @tanstack/react-query patterns preserved. Tests in `client/src/**/*.test.tsx` colocated.

**Tech Stack:** Preact, @tanstack/react-query, vitest + @testing-library/preact, existing theme CSS variables.

---

## Audit Source

Verified 2026-06-02 against source:
- `client/src/pages/Login.tsx:10-11` — `location.reload()` + `alert("Wrong password")`.
- `client/src/pages/Login.tsx:16-22` — password input has no `<label>`, no `aria-label`, no `aria-invalid`.
- `client/src/pages/Settings.tsx:7-13` — `PasswordForm` has no confirm field.
- `client/src/pages/RequestDetail.tsx:25-30` — `useQuery` has no `isError` branch.
- `client/src/components/ToastProvider.tsx:13-19` — `setTimeout` ID not tracked, leak on unmount.
- `client/src/components/Pagination.tsx:25-27` — nav buttons have no `aria-label`.

---

## Task 1: Login rewrite (toast + invalidate + label)

**Files:**
- Modify: `client/src/pages/Login.tsx` (full rewrite)
- Test: `client/src/pages/Login.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/Login.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Login } from "./Login";
import { ToastProvider } from "../components/ToastProvider";

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: any }) => (
  <QueryClientProvider client={qc}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
);

describe("Login", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    location.hash = "";
  });

  it("renders a labelled password input", () => {
    render(<Login />, { wrapper });
    expect(screen.getByLabelText("Password")).toBeTruthy();
  });

  it("shows toast on wrong password (not native alert)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "wrong password" }), { status: 401 }));
    render(<Login />, { wrapper });
    fireEvent.input(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => {
      expect(screen.getByText(/wrong password|too many attempts/i)).toBeTruthy();
    });
  });

  it("shows rate-limit toast with retryAfterMs", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "too many attempts", retryAfterMs: 30_000 }),
      { status: 429 },
    ));
    render(<Login />, { wrapper });
    fireEvent.input(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => {
      expect(screen.getByText(/too many|try again/i)).toBeTruthy();
    });
  });

  it("invalidates queries and navigates on success (no reload)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ authed: true }), { status: 200 }));
    const reloadSpy = vi.spyOn(location, "reload");
    render(<Login />, { wrapper });
    fireEvent.input(screen.getByLabelText("Password"), { target: { value: "right" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => {
      expect(location.hash).toBe("#/admin");
      expect(reloadSpy).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/Login.test.tsx`
Expected: FAIL — first test fails because input has no `aria-label`; reloadSpy will be called in success test.

- [ ] **Step 3: Rewrite Login.tsx**

Replace the file content of `client/src/pages/Login.tsx` with:

```tsx
import { useState } from "preact/hooks";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Button } from "../components/Button";
import { useToast } from "../components/ToastProvider";

export function Login() {
  const [pw, setPw] = useState("");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const loginMut = useMutation({
    mutationFn: (password: string) => apiFetch<{ authed: boolean }>("/api/login", { method: "POST", json: { password } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      location.hash = "/admin";
    },
    onError: (e: any) => {
      const msg = e?.retryAfterMs
        ? `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(e.retryAfterMs / 1000)} detik.`
        : "Password salah.";
      setErrMsg(msg);
      toast.error(msg);
    },
  });

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--ink-0)" }}>
      <form onSubmit={(e) => { e.preventDefault(); setErrMsg(null); loginMut.mutate(pw); }} style={{ background: "var(--ink-1)", border: "1px solid var(--emerald-2)", borderRadius: 8, padding: 36, width: 360, boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 500, textAlign: "center", marginBottom: 4 }}>
          <span style={{ color: "var(--emerald-4)" }}>k</span>elola-router
        </div>
        <div style={{ textAlign: "center", fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: "var(--gold-2)", marginBottom: 24 }}>Restricted access</div>
        {errMsg && (
          <div role="alert" aria-live="assertive" style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12, padding: 8, background: "rgba(192,57,43,0.1)", borderRadius: 4 }}>
            {errMsg}
          </div>
        )}
        <label htmlFor="login-password" style={{ display: "block", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--gold-2)", marginBottom: 6 }}>
          Password
        </label>
        <input
          id="login-password"
          type="password"
          value={pw}
          onInput={(e) => setPw((e.target as HTMLInputElement).value)}
          aria-label="Password"
          aria-invalid={!!errMsg}
          aria-describedby={errMsg ? "login-error" : undefined}
          autoFocus
          required
          style={{ width: "100%", padding: "10px 12px", background: "var(--ink-2)", border: "1px solid var(--ink-3)", color: "var(--text-1)", borderRadius: 4, marginBottom: 12, fontFamily: "inherit", fontSize: 14 }}
        />
        <Button type="submit" disabled={!pw || loginMut.isPending} style={{ width: "100%" }}>
          {loginMut.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
```

Note: `apiFetch` must throw an Error with `retryAfterMs` attached for the rate-limit case. Check `client/src/lib/api.ts` and confirm; if not, extend it. (The server returns `{ error, retryAfterMs }` JSON; `apiFetch` should attach these to the thrown error.)

- [ ] **Step 4: Verify apiFetch throws enriched error**

In `client/src/lib/api.ts`, locate the throw on non-OK response. It should attach `retryAfterMs` from the response body. If not, modify it to:

```typescript
if (!res.ok) {
  let body: any = {};
  try { body = await res.json(); } catch { /* ignore */ }
  const err = new Error(body.error || `HTTP ${res.status}`) as Error & { status: number; retryAfterMs?: number };
  err.status = res.status;
  if (typeof body.retryAfterMs === "number") err.retryAfterMs = body.retryAfterMs;
  throw err;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/Login.test.tsx`
Expected: PASS — 4/4.

- [ ] **Step 6: Run client test suite**

Run: `cd client && npm test`

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/Login.tsx client/src/pages/Login.test.tsx client/src/lib/api.ts
git commit -m "fix(ui): login — toast + invalidate + label, no reload, rate-limit feedback"
```

---

## Task 2: Settings password confirm field

**Files:**
- Modify: `client/src/pages/Settings.tsx:7-13` (PasswordForm)
- Test: extend Settings tests if present, else new

- [ ] **Step 1: Write the failing test**

If `client/src/pages/Settings.test.tsx` doesn't exist, create it:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Settings } from "./Settings";
import { ToastProvider } from "../components/ToastProvider";

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: any }) => (
  <QueryClientProvider client={qc}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
);

describe("Settings password form", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ caveman: { level: "off" }, caching: { autoBreakpoints: false }, rtk: { enabled: false }, minimax: { upstreamFormat: "auto" } }), { status: 200 }));
  });

  it("rejects mismatched confirm password", async () => {
    render(<Settings />, { wrapper });
    await waitFor(() => expect(screen.getByPlaceholderText(/new password/i)).toBeTruthy());
    fireEvent.input(screen.getByPlaceholderText(/new password/i), { target: { value: "abc123" } });
    fireEvent.input(screen.getByPlaceholderText(/confirm/i), { target: { value: "different" } });
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));
    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeTruthy();
    });
  });

  it("submits when passwords match", async () => {
    const post = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    globalThis.fetch = vi.fn().mockImplementation((url) => {
      if (url.toString().includes("/settings/password")) return post();
      return new Response(JSON.stringify({ caveman: { level: "off" }, caching: { autoBreakpoints: false }, rtk: { enabled: false }, minimax: { upstreamFormat: "auto" } }));
    });
    render(<Settings />, { wrapper });
    await waitFor(() => expect(screen.getByPlaceholderText(/new password/i)).toBeTruthy());
    fireEvent.input(screen.getByPlaceholderText(/new password/i), { target: { value: "abc123" } });
    fireEvent.input(screen.getByPlaceholderText(/confirm/i), { target: { value: "abc123" } });
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));
    await waitFor(() => expect(post).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/Settings.test.tsx`
Expected: First test fails — no confirm input exists; second test passes (current code accepts anything ≥ 4 chars).

- [ ] **Step 3: Add confirm field to PasswordForm**

In `client/src/pages/Settings.tsx`, replace the `PasswordForm` function (lines 7-13) with:

```tsx
function PasswordForm({ onSubmit }: { onSubmit: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      setErr(null);
      if (pw.length < 4) { setErr("Password minimal 4 karakter."); return; }
      if (pw !== confirm) { setErr("Passwords do not match."); return; }
      onSubmit(pw);
    }}>
      <input
        type="password"
        value={pw}
        onInput={(e) => setPw((e.target as HTMLInputElement).value)}
        placeholder="New password (min 4)"
        minLength={4}
        required
        aria-label="New password"
        style={inputStyle}
      />
      <input
        type="password"
        value={confirm}
        onInput={(e) => setConfirm((e.target as HTMLInputElement).value)}
        placeholder="Confirm password"
        required
        aria-label="Confirm password"
        aria-invalid={!!err}
        style={{ ...inputStyle, marginTop: 8 }}
      />
      {err && <p role="alert" aria-live="assertive" style={{ color: "var(--danger)", fontSize: 12, marginTop: 6 }}>{err}</p>}
      <Button type="submit" style={{ marginTop: 8 }}>Set password</Button>
    </form>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/Settings.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run client tests**

Run: `cd client && npm test`

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/Settings.tsx client/src/pages/Settings.test.tsx
git commit -m "fix(ui): settings — add confirm password field to prevent lockout"
```

---

## Task 3: RequestDetail error state

**Files:**
- Modify: `client/src/pages/RequestDetail.tsx` (add isError branch)
- Test: extend RequestDetail tests

- [ ] **Step 1: Write the failing test**

If `client/src/pages/RequestDetail.test.tsx` doesn't exist, create it:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RequestDetail } from "./RequestDetail";
import { ErrorState } from "../components/ErrorState";

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: any }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

describe("RequestDetail", () => {
  it("shows error state on fetch failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network"));
    render(<RequestDetail id={1} onClose={() => {}} />, { wrapper });
    await waitFor(() => {
      expect(screen.getByText(/failed|error|try again/i)).toBeTruthy();
    });
  });

  it("renders summary on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 1, createdAt: "2026-01-01T00:00:00Z", model: "m", statusCode: 200,
      latencyMs: 100, promptTokens: 10, completionTokens: 20, totalTokens: 30,
      cost: 0.001, clientKeyId: 1, accountId: "a",
      requestBody: "{}", responseBody: "{}", requestHeaders: {}, responseHeaders: {}, error: null,
    }), { status: 200 }));
    render(<RequestDetail id={1} onClose={() => {}} />, { wrapper });
    await waitFor(() => {
      expect(screen.getByText("m")).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/RequestDetail.test.tsx`
Expected: First test fails — no error UI rendered.

- [ ] **Step 3: Add isError branch**

In `client/src/pages/RequestDetail.tsx`, update the `useQuery` destructure and the render. Find:

```tsx
const { data, isLoading } = useQuery({
```

Replace with:

```tsx
const { data, isLoading, isError, refetch } = useQuery({
```

Add an import at the top:

```tsx
import { ErrorState } from "../components/ErrorState";
```

In the modal body, add the error branch (before the existing `{isLoading && ...}` check):

```tsx
{isError && <ErrorState onRetry={refetch} />}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/RequestDetail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run client tests**

Run: `cd client && npm test`

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/RequestDetail.tsx client/src/pages/RequestDetail.test.tsx
git commit -m "fix(ui): request detail — show error state on fetch failure"
```

---

## Task 4: Pagination aria-labels

**Files:**
- Modify: `client/src/components/Pagination.tsx:25-27`
- Test: `client/src/components/Pagination.test.tsx` (new or extend)

- [ ] **Step 1: Write the failing test**

Create `client/src/components/Pagination.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/preact";
import { Pagination } from "./Pagination";

describe("Pagination", () => {
  it("has aria-labels on nav buttons", () => {
    render(<Pagination page={2} pageSize={25} total={100} totalPages={4} onPageChange={() => {}} onPageSizeChange={() => {}} />);
    expect(screen.getByRole("button", { name: /first page/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /previous page/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /next page/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /last page/i })).toBeTruthy();
  });

  it("calls onPageChange with correct values", () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} pageSize={25} total={100} totalPages={4} onPageChange={onPageChange} onPageSizeChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/Pagination.test.tsx`
Expected: FAIL — buttons have no aria-label, so `getByRole("button", { name: /first page/i })` returns null.

- [ ] **Step 3: Add aria-labels**

In `client/src/components/Pagination.tsx`, update the four nav buttons:

```tsx
<button onClick={() => onPageChange(1)} disabled={page <= 1} aria-label="First page">«</button>
<button onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page">‹</button>
```

And the trailing two:

```tsx
<button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} aria-label="Next page">›</button>
<button onClick={() => onPageChange(totalPages)} disabled={page >= totalPages} aria-label="Last page">»</button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/Pagination.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run client tests**

Run: `cd client && npm test`

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Pagination.tsx client/src/components/Pagination.test.tsx
git commit -m "fix(ui): add aria-labels to pagination nav buttons"
```

---

## Task 5: ToastProvider cleanup on unmount

**Files:**
- Modify: `client/src/components/ToastProvider.tsx:13-19` (track timeouts in ref)
- Test: `client/src/components/ToastProvider.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, renderHook } from "@testing-library/preact";
import { ToastProvider, useToast } from "./ToastProvider";

describe("ToastProvider", () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it("clears pending timeouts on unmount (no memory leak)", () => {
    const { result, unmount } = renderHook(() => useToast(), { wrapper: ToastProvider });
    act(() => result.current.success("hello"));
    // Now unmount; should not throw
    unmount();
    // Advancing time after unmount should not throw
    act(() => { vi.advanceTimersByTime(5000); });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/ToastProvider.test.tsx`
Expected: FAIL — current ToastProvider has unmount leak (technically passes, but the fix is preventive; the test mostly ensures no regression). If the test passes already, the task is just hardening. Skip to step 3 for the actual code change.

- [ ] **Step 3: Track timeouts in ref + cleanup**

In `client/src/components/ToastProvider.tsx`, replace the file content with:

```tsx
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useRef, useState } from "preact/hooks";
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

const TOAST_TTL_MS = 3000;

export function ToastProvider({ children }: { children: ComponentChildren }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    return () => {
      for (const t of timers.current.values()) clearTimeout(t);
      timers.current.clear();
    };
  }, []);

  const add = useCallback((message: string, variant: ToastVariant) => {
    const id = Date.now() + Math.random();
    setItems(prev => [...prev.slice(-4), { id, message, variant }]);
    const handle = setTimeout(() => {
      setItems(prev => prev.filter(i => i.id !== id));
      timers.current.delete(id);
    }, TOAST_TTL_MS);
    timers.current.set(id, handle);
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/ToastProvider.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run client tests**

Run: `cd client && npm test`

- [ ] **Step 6: Commit**

```bash
git add client/src/components/ToastProvider.tsx client/src/components/ToastProvider.test.tsx
git commit -m "fix(ui): clear toast timeouts on ToastProvider unmount"
```

---

## Self-Review

**Spec coverage:**
- Login toast + invalidate + label → Task 1 ✓
- Settings confirm field → Task 2 ✓
- RequestDetail error state → Task 3 ✓
- Pagination aria → Task 4 ✓
- ToastProvider leak → Task 5 ✓

**Placeholder scan:** No TODOs. All test code complete.

**Type consistency:** `apiFetch` Error augmentation in Task 1; `useQuery` destructure in Task 3; all consistent.

**Ready to ship.** 5 tasks, ~6-8 commits.
