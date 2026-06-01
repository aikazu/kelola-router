# Dashboard SPA Rebuild — Phase 3: Pages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 8 page routes (Overview, Usage, ClientKeys, Accounts, Models, Quota, Settings, Login) consuming the Phase 1 API + Phase 2 components. Real data, no placeholders. Hook pages into router.

**Architecture:** Each page is a Preact component under `client/src/pages/`. Data via `@tanstack/react-query` calling `apiFetch`. Mutations invalidate relevant queries + show toast. Per-request drilldown modal wired in Usage.

**Tech Stack:** Preact, react-query, preact-router, Vitest.

**Phase 3 scope:** All 8 page implementations + drilldown modal + per-page tests. **No global features** (those in Phase 4). Server HTML routes from `src/dashboard/*` still exist — they get deleted in Phase 4 cleanup.

---

## File Structure

### New files (Phase 3)

```
client/src/pages/
  Overview.tsx
  Usage.tsx
  ClientKeys.tsx
  Accounts.tsx
  Models.tsx
  Quota.tsx
  Settings.tsx
  Login.tsx
  RequestDetail.tsx                  — drilldown modal
  __tests__/
    Overview.test.tsx
    Usage.test.tsx
    Settings.test.tsx
    RequestDetail.test.tsx
```

### Modified files (Phase 3)

```
client/src/layout/AppShell.tsx       — wire all pages to router
client/src/pages/Placeholder.tsx     — keep for routes still in development (none after Phase 3)
```

---

## Task 1: Overview page

**Files:**
- Create: `client/src/pages/Overview.tsx`
- Create: `client/src/pages/__tests__/Overview.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// client/src/pages/__tests__/Overview.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/preact";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Overview } from "../Overview";

function wrap(ui: preact.ComponentChildren) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("Overview page", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("renders 4 stat cards", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/admin/overview")) {
        return new Response(JSON.stringify({
          stats: { totalCost: 1.23, totalRequests: 50, totalTokens: 10000, enabledAccounts: 2, totalAccounts: 3, activeClientKeys: 1 },
          byModel: [{ model: "m1", cost: 1.0, requests: 40 }, { model: "m2", cost: 0.23, requests: 10 }],
          recent: [],
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    wrap(<Overview />);
    await waitFor(() => { expect(screen.getByText("$1.23")).toBeInTheDocument(); });
    expect(screen.getByText("50 requests")).toBeInTheDocument();
    expect(screen.getByText(/2.*\/.*3/)).toBeInTheDocument();
    expect(screen.getByText("m1")).toBeInTheDocument();
  });

  it("shows empty states when no data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ stats: { totalCost: 0, totalRequests: 0, totalTokens: 0, enabledAccounts: 0, totalAccounts: 0, activeClientKeys: 0 }, byModel: [], recent: [] }), { status: 200 })
    );
    wrap(<Overview />);
    await waitFor(() => { expect(screen.getByText(/No requests yet/)).toBeInTheDocument(); });
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd client && npx vitest run src/pages/__tests__/Overview.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement Overview**

`client/src/pages/Overview.tsx`:
```typescript
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Card } from "../components/Card";
import { Stat } from "../components/Stat";
import { TopBar } from "../layout/TopBar";
import { Badge } from "../components/Badge";
import { RequestDetail } from "./RequestDetail";
import { useState } from "preact/hooks";

interface OverviewData {
  stats: { totalCost: number; totalRequests: number; totalTokens: number; enabledAccounts: number; totalAccounts: number; activeClientKeys: number };
  byModel: Array<{ model: string; cost: number; requests: number }>;
  recent: Array<{ id: string; createdAt: string; model: string; statusCode: number; cost: number; latencyMs: number; clientKeyId: number | null; accountId: number | null }>;
}

export function Overview() {
  const { data, isLoading } = useQuery({ queryKey: ["overview"], queryFn: () => apiFetch<OverviewData>("/api/admin/overview") });
  const [selected, setSelected] = useState<string | null>(null);

  if (isLoading || !data) return <><TopBar title="Overview" /><p>Loading...</p></>;

  return (
    <>
      <TopBar title="Overview" />
      <div class="stat-grid">
        <Stat label="Cost (7d)" value={`$${data.stats.totalCost.toFixed(2)}`} sub={`${data.stats.totalRequests} requests`} />
        <Stat label="Tokens (7d)" value={data.stats.totalTokens.toLocaleString()} sub="prompt + completion + cache" />
        <Stat label="Upstream accounts" value={`${data.stats.enabledAccounts} / ${data.stats.totalAccounts}`} sub="enabled / total in pool" />
        <Stat label="Client keys" value={data.stats.activeClientKeys} sub="active bearers" />
      </div>
      <Card title="By model (last 7 days)">
        {data.byModel.length === 0 ? <p class="card-sub">No requests yet.</p> : (
          <table class="tbl">
            <thead><tr><th>Model</th><th>Cost</th><th>Requests</th></tr></thead>
            <tbody>{data.byModel.map(m => <tr key={m.model}><td>{m.model}</td><td>${m.cost.toFixed(4)}</td><td>{m.requests}</td></tr>)}</tbody>
          </table>
        )}
      </Card>
      <Card title="Recent requests">
        {data.recent.length === 0 ? <p class="card-sub">No traffic yet.</p> : (
          <table class="tbl">
            <thead><tr><th>Time</th><th>Model</th><th>Status</th><th>Latency</th><th>Cost</th></tr></thead>
            <tbody>{data.recent.map(r => (
              <tr key={r.id} onClick={() => setSelected(r.id)}>
                <td>{r.createdAt}</td><td>{r.model}</td>
                <td><Badge variant={r.statusCode < 300 ? "active" : r.statusCode < 500 ? "warn" : "error"}>{r.statusCode}</Badge></td>
                <td>{r.latencyMs}ms</td><td>${r.cost.toFixed(4)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      <RequestDetail id={selected} onClose={() => setSelected(null)} />
    </>
  );
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd client && npx vitest run src/pages/__tests__/Overview.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/Overview.tsx client/src/pages/__tests__/Overview.test.tsx
git commit -m "feat(client): Overview page"
```

---

## Task 2: RequestDetail modal (drilldown)

**Files:**
- Create: `client/src/pages/RequestDetail.tsx`
- Create: `client/src/pages/__tests__/RequestDetail.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// client/src/pages/__tests__/RequestDetail.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/preact";
import { RequestDetail } from "../RequestDetail";

describe("RequestDetail modal", () => {
  it("renders nothing when id is null", () => {
    render(<RequestDetail id={null} onClose={() => {}} />);
    expect(screen.queryByText("Summary")).not.toBeInTheDocument();
  });

  it("shows 4 tabs and loads data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        id: "abc", createdAt: "2026-06-02 12:00:00", model: "m1", statusCode: 200,
        latencyMs: 100, promptTokens: 5, completionTokens: 10, totalTokens: 15, cost: 0.0001,
        clientKeyId: 1, accountId: 1,
        requestBody: '{"messages":[]}', responseBody: '{"content":"hi"}',
        requestHeaders: { "content-type": "application/json" },
        responseHeaders: { "x-request-id": "xyz" },
        error: null,
      }), { status: 200 })
    );
    render(<RequestDetail id="abc" onClose={() => {}} />);
    await waitFor(() => { expect(screen.getByText("Summary")).toBeInTheDocument(); });
    expect(screen.getByText("Request")).toBeInTheDocument();
    expect(screen.getByText("Response")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText(/m1/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd client && npx vitest run src/pages/__tests__/RequestDetail.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement RequestDetail**

`client/src/pages/RequestDetail.tsx`:
```typescript
import { useState } from "preact/hooks";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Modal } from "../components/Modal";
import { Badge } from "../components/Badge";

interface RequestLog {
  id: string; createdAt: string; model: string; statusCode: number;
  latencyMs: number; promptTokens: number; completionTokens: number;
  totalTokens: number; cost: number; clientKeyId: number | null; accountId: number | null;
  requestBody: string | null; responseBody: string | null;
  requestHeaders: Record<string, string> | null; responseHeaders: Record<string, string> | null;
  error: string | null;
}

type Tab = "summary" | "request" | "response" | "error";

function JsonView({ data }: { data: string | Record<string, unknown> | null }) {
  if (data == null) return <p style={{ color: "var(--text-3)" }}>No data</p>;
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  let formatted: string;
  try { formatted = JSON.stringify(JSON.parse(text), null, 2); } catch { formatted = text; }
  return <pre style={{ maxHeight: "50vh", overflow: "auto" }}>{formatted}</pre>;
}

function HeadersView({ headers }: { headers: Record<string, string> | null }) {
  if (!headers || Object.keys(headers).length === 0) return <p style={{ color: "var(--text-3)" }}>No headers</p>;
  return (
    <table class="tbl">
      <thead><tr><th>Header</th><th>Value</th></tr></thead>
      <tbody>{Object.entries(headers).map(([k, v]) => <tr key={k}><td class="mono">{k}</td><td class="mono">{v}</td></tr>)}</tbody>
    </table>
  );
}

export function RequestDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("summary");
  const { data, isLoading } = useQuery({
    queryKey: ["request-log", id],
    queryFn: () => apiFetch<RequestLog>(`/api/admin/request-logs/${id}`),
    enabled: id !== null,
  });

  return (
    <Modal open={id !== null} onClose={onClose} title={data ? `Request ${data.id.slice(0, 12)}…` : "Loading…"} width={760}>
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--ink-3)", marginBottom: 16 }}>
        {(["summary", "request", "response", "error"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              background: "none", border: 0, padding: "8px 14px",
              color: tab === t ? "var(--emerald-4)" : "var(--text-2)",
              borderBottom: tab === t ? "2px solid var(--emerald-3)" : "2px solid transparent",
              fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer",
            }}>
            {t}
          </button>
        ))}
      </div>
      {isLoading && <p>Loading…</p>}
      {data && tab === "summary" && (
        <table class="tbl">
          <tbody>
            <tr><th>Model</th><td>{data.model}</td></tr>
            <tr><th>Status</th><td><Badge variant={data.statusCode < 300 ? "active" : data.statusCode < 500 ? "warn" : "error"}>{data.statusCode}</Badge></td></tr>
            <tr><th>Latency</th><td>{data.latencyMs}ms</td></tr>
            <tr><th>Tokens</th><td>{data.promptTokens} prompt + {data.completionTokens} completion = {data.totalTokens}</td></tr>
            <tr><th>Cost</th><td>${data.cost.toFixed(6)}</td></tr>
            <tr><th>Time</th><td>{data.createdAt}</td></tr>
            <tr><th>Client key ID</th><td>{data.clientKeyId ?? "—"}</td></tr>
            <tr><th>Account ID</th><td>{data.accountId ?? "—"}</td></tr>
          </tbody>
        </table>
      )}
      {data && tab === "request" && <><h4 style={{ fontFamily: "var(--font-body)", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--text-3)", marginBottom: 8 }}>Body</h4><JsonView data={data.requestBody} /><h4 style={{ fontFamily: "var(--font-body)", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--text-3)", margin: "16px 0 8px" }}>Headers</h4><HeadersView headers={data.requestHeaders} /></>}
      {data && tab === "response" && <><h4 style={{ fontFamily: "var(--font-body)", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--text-3)", marginBottom: 8 }}>Body</h4><JsonView data={data.responseBody} /><h4 style={{ fontFamily: "var(--font-body)", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--text-3)", margin: "16px 0 8px" }}>Headers</h4><HeadersView headers={data.responseHeaders} /></>}
      {data && tab === "error" && <p style={{ color: data.error ? "var(--danger)" : "var(--text-3)" }}>{data.error ?? "No error"}</p>}
    </Modal>
  );
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd client && npx vitest run src/pages/__tests__/RequestDetail.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/RequestDetail.tsx client/src/pages/__tests__/RequestDetail.test.tsx
git commit -m "feat(client): per-request drilldown modal"
```

---

## Task 3: Usage page

**Files:**
- Create: `client/src/pages/Usage.tsx`
- Create: `client/src/pages/__tests__/Usage.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// client/src/pages/__tests__/Usage.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/preact";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Usage } from "../Usage";

function wrap(ui: preact.ComponentChildren) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("Usage page", () => {
  it("renders summary + logs table", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/api/admin/usage")) {
        return new Response(JSON.stringify({
          summary: { totalCost: 0.5, totalRequests: 10, totalTokens: 5000 },
          logs: [
            { id: "abc", createdAt: "2026-06-02 12:00:00", model: "m1", statusCode: 200, cost: 0.001, latencyMs: 100, totalTokens: 50, promptTokens: 20, completionTokens: 30, clientKeyId: 1, accountId: 1 },
          ],
        }), { status: 200 });
      }
      return new Response("[]", { status: 200 });
    });
    wrap(<Usage />);
    await waitFor(() => { expect(screen.getByText("$0.5000")).toBeInTheDocument(); });
    expect(screen.getByText("m1")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd client && npx vitest run src/pages/__tests__/Usage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement Usage**

`client/src/pages/Usage.tsx`:
```typescript
import { useState } from "preact/hooks";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Card } from "../components/Card";
import { Stat } from "../components/Stat";
import { TopBar } from "../layout/TopBar";
import { Badge } from "../components/Badge";
import { RequestDetail } from "./RequestDetail";

interface ClientKey { id: number; label: string; enabled: boolean; }
interface UsageLog { id: string; createdAt: string; model: string; statusCode: number; cost: number; latencyMs: number; totalTokens: number; promptTokens: number; completionTokens: number; clientKeyId: number | null; accountId: number | null; }

export function Usage() {
  const params = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const clientKeyQ = params.get("client_key");
  const [clientKeyId, setClientKeyId] = useState<number | undefined>(clientKeyQ ? Number(clientKeyQ) : undefined);
  const [selected, setSelected] = useState<string | null>(null);

  const { data: keys } = useQuery({ queryKey: ["client-keys"], queryFn: () => apiFetch<ClientKey[]>("/api/admin/client-keys") });
  const url = clientKeyId ? `/api/admin/usage?client_key=${clientKeyId}` : "/api/admin/usage?days=30";
  const { data, isLoading } = useQuery({ queryKey: ["usage", clientKeyId], queryFn: () => apiFetch<{ summary: { totalCost: number; totalRequests: number; totalTokens: number }; logs: UsageLog[] }>(url) });

  return (
    <>
      <TopBar title="Usage" />
      <div class="card-sub">Filter:&nbsp;
        <a href="#/admin/usage" onClick={(e) => { e.preventDefault(); setClientKeyId(undefined); }} style={clientKeyId === undefined ? { color: "var(--emerald-4)", fontWeight: 700 } : {}}>all</a>
        &nbsp;
        {keys?.map(k => (
          <a key={k.id} href="#" onClick={(e) => { e.preventDefault(); setClientKeyId(k.id); }}
             style={clientKeyId === k.id ? { color: "var(--emerald-4)", fontWeight: 700 } : {}}>{k.label}</a>
        ))}
      </div>
      {data && (
        <div class="stat-grid">
          <Stat label="Total cost" value={`$${data.summary.totalCost.toFixed(4)}`} />
          <Stat label="Requests" value={data.summary.totalRequests} />
          <Stat label="Tokens" value={data.summary.totalTokens.toLocaleString()} />
        </div>
      )}
      <Card title="Requests">
        {isLoading || !data ? <p>Loading…</p> : data.logs.length === 0 ? <p class="card-sub">No traffic yet.</p> : (
          <table class="tbl">
            <thead><tr><th>Time</th><th>Model</th><th>Tokens</th><th>Cost</th><th>Status</th><th>Latency</th></tr></thead>
            <tbody>{data.logs.map(l => (
              <tr key={l.id} onClick={() => setSelected(l.id)}>
                <td>{l.createdAt}</td><td>{l.model}</td>
                <td>{l.totalTokens}</td><td>${l.cost.toFixed(4)}</td>
                <td><Badge variant={l.statusCode < 300 ? "active" : l.statusCode < 500 ? "warn" : "error"}>{l.statusCode}</Badge></td>
                <td>{l.latencyMs}ms</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      <RequestDetail id={selected} onClose={() => setSelected(null)} />
    </>
  );
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd client && npx vitest run src/pages/__tests__/Usage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/Usage.tsx client/src/pages/__tests__/Usage.test.tsx
git commit -m "feat(client): Usage page with filter + drilldown"
```

---

## Task 4: ClientKeys page

**Files:**
- Create: `client/src/pages/ClientKeys.tsx`

- [ ] **Step 1: Implement**

```typescript
import { useState } from "preact/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Card } from "../components/Card";
import { TopBar } from "../layout/TopBar";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { Modal } from "../components/Modal";
import { useToast } from "../components/ToastProvider";

interface ClientKey { id: number; label: string; enabled: boolean; createdAt: string; keyPreview: string; }

export function ClientKeys() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: keys = [] } = useQuery({ queryKey: ["client-keys"], queryFn: () => apiFetch<ClientKey[]>("/api/admin/client-keys") });
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<{ key: string; label: string } | null>(null);

  const createMut = useMutation({
    mutationFn: (l: string) => apiFetch<{ key: string; label: string }>("/api/admin/client-keys", { method: "POST", json: { label: l } }),
    onSuccess: (res) => { setCreated(res); setLabel(""); qc.invalidateQueries({ queryKey: ["client-keys"] }); toast.success("Key created"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => apiFetch(`/api/admin/client-keys/${id}/${enabled ? "disable" : "enable"}`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["client-keys"] }); toast.success("Updated"); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/admin/client-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["client-keys"] }); toast.success("Deleted"); },
  });

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast.success("Copied"); } catch { toast.error("Clipboard blocked"); }
  }

  return (
    <>
      <TopBar title="Client keys" actions={<Button onClick={() => setCreateOpen(true)}>+ Create key</Button>} />
      <p class="card-sub">Bearer credentials for clients. Each key gets its own usage tracking on /admin/usage.</p>
      <Card>
        {keys.length === 0 ? <div class="empty"><h3>No client keys yet</h3><p>Create one to give an app access to the proxy.</p></div> : (
          <table class="tbl">
            <thead><tr><th>ID</th><th>Label</th><th>Bearer key</th><th>Status</th><th>Created</th><th></th></tr></thead>
            <tbody>{keys.map(k => (
              <tr key={k.id}>
                <td>{k.id}</td><td>{k.label}</td>
                <td class="mono"><code>{k.keyPreview}</code></td>
                <td><Badge variant={k.enabled ? "active" : "muted"}>{k.enabled ? "active" : "disabled"}</Badge></td>
                <td>{k.createdAt}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <Button size="sm" variant="ghost" onClick={() => toggleMut.mutate({ id: k.id, enabled: k.enabled })}>{k.enabled ? "Disable" : "Enable"}</Button>
                  <Button size="sm" variant="danger" onClick={() => { if (confirm("Delete this key?")) deleteMut.mutate(k.id); }}>Delete</Button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      <Modal open={createOpen} onClose={() => { setCreateOpen(false); setCreated(null); }} title={created ? "Key created" : "Create client key"}
        footer={created ? <Button onClick={() => copy(created.key)}>Copy key</Button> : <Button onClick={() => createMut.mutate(label)} disabled={!label}>Generate</Button>}>
        {created ? (
          <>
            <p style={{ marginBottom: 12 }}>This is the only time the full key will be shown. Copy it now.</p>
            <pre style={{ background: "var(--ink-2)", padding: 12, borderRadius: 4, fontFamily: "var(--font-mono)" }}>{created.key}</pre>
          </>
        ) : (
          <label>Label <input value={label} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} placeholder="my-app" style={{ width: "100%", marginTop: 6, padding: "8px 10px", background: "var(--ink-1)", border: "1px solid var(--ink-3)", color: "var(--text-1)", borderRadius: 4 }} /></label>
        )}
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/ClientKeys.tsx
git commit -m "feat(client): ClientKeys page"
```

---

## Task 5: Accounts page

**Files:**
- Create: `client/src/pages/Accounts.tsx`

- [ ] **Step 1: Implement**

```typescript
import { useState } from "preact/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Card } from "../components/Card";
import { TopBar } from "../layout/TopBar";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { Modal } from "../components/Modal";
import { useToast } from "../components/ToastProvider";

interface Account { id: number; label: string; creditType: string; status: string; enabled: boolean; lastError: string | null; backoffLevel: number; rateLimitedUntil: string | null; }

export function Accounts() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: () => apiFetch<Account[]>("/api/admin/accounts") });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ label: "", credit_type: "payg", api_key: "" });

  const createMut = useMutation({
    mutationFn: () => apiFetch("/api/admin/accounts", { method: "POST", json: form }),
    onSuccess: () => { setOpen(false); setForm({ label: "", credit_type: "payg", api_key: "" }); qc.invalidateQueries({ queryKey: ["accounts"] }); toast.success("Account added"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => apiFetch(`/api/admin/accounts/${id}/${enabled ? "disable" : "enable"}`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts"] }); toast.success("Updated"); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/admin/accounts/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts"] }); toast.success("Deleted"); },
  });

  const statusVariant = (s: string, e: boolean) => {
    if (!e) return "muted";
    if (s === "active") return "active";
    if (s === "error") return "error";
    if (s === "rate_limited") return "warn";
    return "muted";
  };

  return (
    <>
      <TopBar title="Upstream accounts" actions={<Button onClick={() => setOpen(true)}>+ Add account</Button>} />
      <p class="card-sub">Pool of MiniMax API keys. The router fans out across enabled accounts with backoff + per-model locks when one returns 429/5xx.</p>
      <Card>
        {accounts.length === 0 ? <div class="empty"><h3>No upstream accounts yet</h3><p>Add a MiniMax API key to start routing requests.</p></div> : (
          <table class="tbl">
            <thead><tr><th>ID</th><th>Label</th><th>Credit</th><th>Status</th><th>Last error</th><th>Backoff</th><th>Rate-limited until</th><th></th></tr></thead>
            <tbody>{accounts.map(a => (
              <tr key={a.id}>
                <td class="mono">{a.id}</td>
                <td>{a.label}</td>
                <td><Badge variant={a.creditType === "token-plan" ? "warn" : "active"}>{a.creditType}</Badge></td>
                <td><Badge variant={statusVariant(a.status, a.enabled)} pulse={a.status === "rate_limited"}>{a.enabled ? a.status : "disabled"}</Badge></td>
                <td class="mono" style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{a.lastError ?? "—"}</td>
                <td>{a.backoffLevel}</td>
                <td>{a.rateLimitedUntil ?? "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <Button size="sm" variant="ghost" onClick={() => toggleMut.mutate({ id: a.id, enabled: a.enabled })}>{a.enabled ? "Disable" : "Enable"}</Button>
                  <Button size="sm" variant="danger" onClick={() => { if (confirm(`Delete ${a.label}?`)) deleteMut.mutate(a.id); }}>Delete</Button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Add MiniMax account"
        footer={<Button onClick={() => createMut.mutate()} disabled={!form.label || !form.api_key}>Add</Button>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label>Label <input value={form.label} onInput={(e) => setForm({ ...form, label: (e.target as HTMLInputElement).value })} style={inputStyle} /></label>
          <label>Credit type
            <select value={form.credit_type} onChange={(e) => setForm({ ...form, credit_type: (e.target as HTMLSelectElement).value })} style={inputStyle}>
              <option value="payg">PAYG</option>
              <option value="token-plan">Token Plan</option>
            </select>
          </label>
          <label>MiniMax API key <input value={form.api_key} onInput={(e) => setForm({ ...form, api_key: (e.target as HTMLInputElement).value })} placeholder="mm_xxxxxxxx" style={inputStyle} /></label>
        </div>
      </Modal>
    </>
  );
}

const inputStyle: preact.JSX.CSSProperties = { width: "100%", marginTop: 6, padding: "8px 10px", background: "var(--ink-1)", border: "1px solid var(--ink-3)", color: "var(--text-1)", borderRadius: 4 };
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/Accounts.tsx
git commit -m "feat(client): Accounts page"
```

---

## Task 6: Models page

**Files:**
- Create: `client/src/pages/Models.tsx`

- [ ] **Step 1: Implement**

```typescript
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Card } from "../components/Card";
import { TopBar } from "../layout/TopBar";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { Switch } from "../components/Switch";
import { useToast } from "../components/ToastProvider";

interface Model { name: string; displayName: string | null; family: string | null; contextWindow: number | null; thinkingEnabled: boolean; source: string; enabled: boolean; }

export function Models() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: models = [] } = useQuery({ queryKey: ["models"], queryFn: () => apiFetch<Model[]>("/api/admin/models") });
  const toggleMut = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) => apiFetch(`/api/admin/models/${encodeURIComponent(name)}/${enabled ? "disable" : "enable"}`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["models"] }); toast.success("Updated"); },
  });
  const fetchMut = useMutation({
    mutationFn: () => apiFetch<{ added: number; updated: number }>("/api/admin/models/fetch", { method: "POST" }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["models"] }); toast.success(`Fetched ${r.added} new, ${r.updated} updated`); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <TopBar title="Models" actions={<Button onClick={() => fetchMut.mutate()} disabled={fetchMut.isPending}>{fetchMut.isPending ? "Fetching…" : "Fetch from upstream"}</Button>} />
      <p class="card-sub">All models known to the router. Disabled models are rejected at the proxy layer.</p>
      <Card>
        <table class="tbl">
          <thead><tr><th>Name</th><th>Display</th><th>Family</th><th>Context</th><th>Thinking</th><th>Source</th><th>Status</th></tr></thead>
          <tbody>{models.map(m => (
            <tr key={m.name}>
              <td class="mono">{m.name}</td>
              <td>{m.displayName ?? "—"}</td>
              <td>{m.family ?? "—"}</td>
              <td>{m.contextWindow ?? "—"}</td>
              <td>{m.thinkingEnabled ? "yes" : "no"}</td>
              <td><Badge variant={m.source === "builtin" ? "muted" : "active"}>{m.source}</Badge></td>
              <td>
                <Switch checked={m.enabled} onChange={(v) => toggleMut.mutate({ name: m.name, enabled: m.enabled })} label={m.enabled ? "on" : "off"} />
              </td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/Models.tsx
git commit -m "feat(client): Models page with toggle + fetch"
```

---

## Task 7: Quota page

**Files:**
- Create: `client/src/pages/Quota.tsx`

- [ ] **Step 1: Implement**

```typescript
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Card } from "../components/Card";
import { TopBar } from "../layout/TopBar";
import { Progress } from "../components/Progress";
import { Badge } from "../components/Badge";

interface QuotaWindow { windowType: string; usedCount: number; totalCount: number; remainingCount: number; windowEnd: string | null; }
interface AccountQuota { accountId: number; label: string; creditType: string; windows: QuotaWindow[]; }

export function Quota() {
  const { data: quotas = [], isLoading } = useQuery({ queryKey: ["quota"], queryFn: () => apiFetch<AccountQuota[]>("/api/admin/quota") });

  return (
    <>
      <TopBar title="Quota" />
      {isLoading && <p>Loading…</p>}
      {quotas.length === 0 && !isLoading && <div class="empty"><h3>No accounts</h3><p>Add an upstream account to see quota windows.</p></div>}
      {quotas.map(q => {
        const h5 = q.windows.find(w => w.windowType === "5h");
        const wk = q.windows.find(w => w.windowType === "weekly");
        return (
          <Card key={q.accountId} title={`${q.label}`} sub={<Badge variant={q.creditType === "token-plan" ? "warn" : "active"}>{q.creditType}</Badge> as unknown as string}>
            {h5 ? (
              <>
                <div class="card-sub">5h window — resets {h5.windowEnd ?? "?"}</div>
                <Progress value={h5.usedCount} max={h5.totalCount} warn={h5.remainingCount < h5.totalCount * 0.2} />
                <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>{h5.usedCount} / {h5.totalCount} ({h5.remainingCount} remaining)</p>
              </>
            ) : <p class="card-sub">5h: no data</p>}
            {wk && <div style={{ marginTop: 16 }}>
              <div class="card-sub">Weekly — resets {wk.windowEnd ?? "?"}</div>
              <Progress value={wk.usedCount} max={wk.totalCount} warn={wk.remainingCount < wk.totalCount * 0.2} />
              <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>{wk.usedCount} / {wk.totalCount} ({wk.remainingCount} remaining)</p>
            </div>}
          </Card>
        );
      })}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/Quota.tsx
git commit -m "feat(client): Quota page with progress bars"
```

---

## Task 8: Settings page (auto-save on toggle)

**Files:**
- Create: `client/src/pages/Settings.tsx`
- Create: `client/src/pages/__tests__/Settings.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// client/src/pages/__tests__/Settings.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/preact";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "../../components/ToastProvider";
import { Settings } from "../Settings";

function wrap(ui: preact.ComponentChildren) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider>{ui}</ToastProvider></QueryClientProvider>);
}

describe("Settings page", () => {
  it("renders all 5 sections", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ caveman: { level: "off" }, caching: { autoBreakpoints: true }, rtk: { enabled: true }, minimax: { upstreamFormat: "auto" } }), { status: 200 })
    );
    wrap(<Settings />);
    await waitFor(() => { expect(screen.getByText("Dashboard access")).toBeInTheDocument(); });
    expect(screen.getByText("Caveman mode")).toBeInTheDocument();
    expect(screen.getByText("RTK compression")).toBeInTheDocument();
    expect(screen.getByText("Prompt caching")).toBeInTheDocument();
    expect(screen.getByText("MiniMax provider")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd client && npx vitest run src/pages/__tests__/Settings.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement Settings**

`client/src/pages/Settings.tsx`:
```typescript
import { useEffect, useState } from "preact/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Card } from "../components/Card";
import { TopBar } from "../layout/TopBar";
import { Switch } from "../components/Switch";
import { useToast } from "../components/ToastProvider";
import { isPasswordSet as _isSet } from "../lib/auth";

interface SettingsData { caveman: { level: string }; caching: { autoBreakpoints: boolean }; rtk: { enabled: boolean }; minimax: { upstreamFormat?: string; reasoningSplitDefault?: boolean; m3DefaultMaxCompletionTokens?: number }; }

async function save<T>(path: string, body: T) {
  return apiFetch(path, { method: "POST", json: body });
}

export function Settings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ["settings"], queryFn: () => apiFetch<SettingsData>("/api/admin/settings") });
  const [me, setMe] = useState<{ authed: boolean; passwordSet: boolean } | null>(null);
  useEffect(() => { apiFetch<{ authed: boolean; passwordSet: boolean }>("/api/me").then(setMe); }, []);

  const cavemanMut = useMutation({ mutationFn: (level: string) => save("/api/admin/settings/caveman", { level }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast.success("Saved"); } });
  const rtkMut = useMutation({ mutationFn: (enabled: boolean) => save("/api/admin/settings/rtk", { enabled }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast.success("Saved"); } });
  const cachingMut = useMutation({ mutationFn: (autoBreakpoints: boolean) => save("/api/admin/settings/caching", { autoBreakpoints }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast.success("Saved"); } });
  const minimaxMut = useMutation({ mutationFn: (b: object) => save("/api/admin/settings/minimax", b), onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast.success("Saved"); } });
  const pwMut = useMutation({ mutationFn: (b: { action: string; password?: string }) => save("/api/admin/settings/password", b), onSuccess: () => { qc.invalidateQueries({ queryKey: ["me"] }); toast.success("Updated"); } });

  if (isLoading || !data) return <><TopBar title="Settings" /><p>Loading…</p></>;

  return (
    <>
      <TopBar title="Settings" />
      <p class="card-sub">Toggles applied to every proxy request. Changes save immediately.</p>
      <Card title="Dashboard access" sub={me?.passwordSet ? "Password set" : "Open mode"}>
        {me?.passwordSet
          ? <Button variant="danger" onClick={() => { if (confirm("Clear password?")) pwMut.mutate({ action: "clear" }); }}>Remove password</Button>
          : <PasswordForm onSubmit={(p) => pwMut.mutate({ action: "set", password: p })} />}
      </Card>
      <Card title="Caveman mode" sub="Injects a terse system prompt to force concise output.">
        <select value={data.caveman.level} onChange={(e) => cavemanMut.mutate((e.target as HTMLSelectElement).value)} style={inputStyle}>
          <option value="off">Off</option>
          <option value="terse">Terse</option>
          <option value="ultra">Ultra</option>
        </select>
      </Card>
      <Card title="RTK compression" sub="Token-saving compression on messages before forwarding.">
        <Switch checked={data.rtk.enabled} onChange={(v) => rtkMut.mutate(v)} label={data.rtk.enabled ? "Enabled" : "Disabled"} />
      </Card>
      <Card title="Prompt caching" sub="Auto-inject dual cache_control breakpoints on Anthropic system prompts.">
        <Switch checked={data.caching.autoBreakpoints} onChange={(v) => cachingMut.mutate(v)} label={data.caching.autoBreakpoints ? "Enabled" : "Disabled"} />
      </Card>
      <Card title="MiniMax provider" sub="Cross-format routing + M3 defaults.">
        <label>Upstream format override
          <select value={data.minimax.upstreamFormat ?? "auto"} onChange={(e) => minimaxMut.mutate({ upstreamFormat: (e.target as HTMLSelectElement).value })} style={inputStyle}>
            <option value="auto">Auto</option>
            <option value="openai">Always OpenAI</option>
            <option value="anthropic">Always Anthropic</option>
          </select>
        </label>
      </Card>
    </>
  );
}

const inputStyle: preact.JSX.CSSProperties = { width: "100%", marginTop: 6, padding: "8px 10px", background: "var(--ink-1)", border: "1px solid var(--ink-3)", color: "var(--text-1)", borderRadius: 4 };

import { useState as useS } from "preact/hooks";
import { Button } from "../components/Button";
function PasswordForm({ onSubmit }: { onSubmit: (pw: string) => void }) {
  const [pw, setPw] = useS("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (pw.length >= 4) onSubmit(pw); }}>
      <input type="password" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} placeholder="New password (min 4)" minLength={4} required style={inputStyle} />
      <Button type="submit" style={{ marginTop: 8 }}>Set password</Button>
    </form>
  );
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd client && npx vitest run src/pages/__tests__/Settings.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/Settings.tsx client/src/pages/__tests__/Settings.test.tsx
git commit -m "feat(client): Settings page with auto-save toggles"
```

---

## Task 9: Login page

**Files:**
- Create: `client/src/pages/Login.tsx`

- [ ] **Step 1: Implement**

```typescript
import { useState } from "preact/hooks";
import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Button } from "../components/Button";

export function Login() {
  const [pw, setPw] = useState("");
  const loginMut = useMutation({
    mutationFn: (password: string) => apiFetch("/api/login", { method: "POST", json: { password } }),
    onSuccess: () => { location.hash = "/admin"; location.reload(); },
    onError: () => { alert("Wrong password"); },
  });

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--ink-0)" }}>
      <form onSubmit={(e) => { e.preventDefault(); loginMut.mutate(pw); }} style={{ background: "var(--ink-1)", border: "1px solid var(--emerald-2)", borderRadius: 8, padding: 36, width: 360, boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 500, textAlign: "center", marginBottom: 4 }}>
          <span style={{ color: "var(--emerald-4)" }}>k</span>elola-router
        </div>
        <div style={{ textAlign: "center", fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: "var(--gold-2)", marginBottom: 24 }}>Restricted access</div>
        <input type="password" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} placeholder="Password" autoFocus style={{ width: "100%", padding: "10px 12px", background: "var(--ink-2)", border: "1px solid var(--ink-3)", color: "var(--text-1)", borderRadius: 4, marginBottom: 12 }} />
        <Button type="submit" disabled={!pw || loginMut.isPending} style={{ width: "100%" }}>{loginMut.isPending ? "Signing in…" : "Sign in"}</Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/Login.tsx
git commit -m "feat(client): Login page"
```

---

## Task 10: Wire router in AppShell

**Files:**
- Modify: `client/src/layout/AppShell.tsx`

- [ ] **Step 1: Implement router**

```typescript
import { useState, useEffect } from "preact/hooks";
import { Sidebar } from "./Sidebar";
import { CommandPalette } from "../components/CommandPalette";
import { Overview } from "../pages/Overview";
import { Usage } from "../pages/Usage";
import { ClientKeys } from "../pages/ClientKeys";
import { Accounts } from "../pages/Accounts";
import { Models } from "../pages/Models";
import { Quota } from "../pages/Quota";
import { Settings } from "../pages/Settings";
import { Login } from "../pages/Login";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";

function Page({ current }: { current: string }) {
  const { data: me, isLoading } = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<{ authed: boolean; passwordSet: boolean }>("/api/me"), retry: false });
  if (isLoading) return <p style={{ padding: 36 }}>Loading…</p>;
  if (me?.passwordSet && !me.authed) return <Login />;
  switch (current) {
    case "usage": return <Usage />;
    case "client-keys": return <ClientKeys />;
    case "accounts": return <Accounts />;
    case "models": return <Models />;
    case "quota": return <Quota />;
    case "settings": return <Settings />;
    case "overview": default: return <Overview />;
  }
}

export function AppShell() {
  const [current, setCurrent] = useState<string>(() => {
    const h = location.hash.replace(/^#\/admin\/?/, "").split("?")[0];
    return h || "overview";
  });
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onHash = () => {
      const h = location.hash.replace(/^#\/admin\/?/, "").split("?")[0];
      setCurrent(h || "overview");
    };
    window.addEventListener("hashchange", onHash);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setPaletteOpen(true); }
      if (e.key === "?" && !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        alert("Keyboard shortcuts:\n⌘K — command palette\ng+o — overview\ng+u — usage\ng+c — client keys\n? — this help");
      }
      if (e.key === "g" && !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) {
        const next = (e2: KeyboardEvent) => {
          window.removeEventListener("keydown", next);
          const map: Record<string, string> = { o: "overview", u: "usage", c: "client-keys", a: "accounts", m: "models", q: "quota", s: "settings" };
          if (map[e2.key]) location.hash = `/admin${map[e2.key] === "overview" ? "" : "/" + map[e2.key]}`;
        };
        window.addEventListener("keydown", next, { once: true });
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
        <Page current={current} />
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={(href) => { location.hash = href; setPaletteOpen(false); }} />
    </div>
  );
}
```

- [ ] **Step 2: Manual smoke**

Run `npm run dev`. Visit http://localhost:5173/admin — see Overview. Click each sidebar item — navigates. Press `⌘K` — palette works. Type "us" → see Usage → Enter → navigate.

- [ ] **Step 3: Commit**

```bash
git add client/src/layout/AppShell.tsx
git commit -m "feat(client): wire all pages to router"
```

---

## Task 11: Phase 3 verification

- [ ] **Step 1: Type check**

Run: `cd client && npm run typecheck && cd .. && npm run typecheck`
Expected: exit 0 both.

- [ ] **Step 2: All client tests**

Run: `cd client && npm test`
Expected: all pass (~15+ tests).

- [ ] **Step 3: All server tests (regression)**

Run: `npm test`
Expected: all pass (no regression).

- [ ] **Step 4: E2E manual test**

1. Start `npm run dev`.
2. Open http://localhost:5173/admin.
3. Click each sidebar item — pages load.
4. Add a client key, see it in table.
5. Click a usage row — drilldown modal opens with 4 tabs.
6. Toggle a setting — toast appears.
7. Add upstream account — see in list.
8. Fetch models — new model appears.

- [ ] **Step 5: Commit cleanup if needed**

```bash
git add -A
git commit -m "chore(phase-3): typecheck + test cleanup" --allow-empty
```

---

## Phase 3 Done

All 8 pages implemented. Drilldown modal works. Auto-save settings. Mutations invalidate queries + show toasts. ~15 client tests passing.

Next: Phase 4 — global features (charts, keymap persistence) + server HTML deletion + README.
