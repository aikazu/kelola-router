import { useState, useEffect, useMemo } from "preact/hooks";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Card } from "../components/Card";
import { Stat } from "../components/Stat";
import { TopBar } from "../layout/TopBar";
import { Badge } from "../components/Badge";
import { RequestDetail } from "./RequestDetail";
import { Pagination } from "../components/Pagination";
import { TableSkeleton } from "../components/Skeleton";
import { ErrorState } from "../components/ErrorState";
import { relativeTime } from "../lib/relativeTime";

interface ClientKey { id: number; label: string; enabled: boolean; }
interface UsageLog { id: number; createdAt: string; model: string; statusCode: number; cost: number; latencyMs: number; totalTokens: number; promptTokens: number; completionTokens: number; clientKeyId: number | null; accountId: string | null; error: string | null; }
interface UsageSummary { totalCost: number; totalRequests: number; totalTokens: number; deltaCostPct: number | null; deltaRequestsPct: number | null; deltaTokensPct: number | null; }
interface UsagePage { rows: UsageLog[]; total: number; page: number; pageSize: number; totalPages: number; }

function Delta({ pct, label }: { pct: number | null; label: string }) {
  if (pct === null) return <span class="delta-flat">— {label}</span>;
  const cls = pct > 0 ? "delta-up" : pct < 0 ? "delta-down" : "delta-flat";
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "—";
  return <span class={cls} style={{ fontSize: 11, marginLeft: 8 }}>{arrow} {Math.abs(pct).toFixed(1)}% {label}</span>;
}

export function Usage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [clientKeyId, setClientKeyId] = useState<number | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "2xx" | "4xx" | "5xx">("all");
  const [sortBy, setSortBy] = useState<"created_at" | "cost_usd" | "latency_ms" | "total_tokens">("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [days, setDays] = useState(7);
  const [selected, setSelected] = useState<number | null>(null);

  // URL sync: read on mount + react to hashchange (back/forward), write on change via replaceState
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

  const { data: keys } = useQuery({ queryKey: ["client-keys"], queryFn: () => apiFetch<ClientKey[]>("/api/admin/client-keys") });
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["usage", params],
    queryFn: () => apiFetch<{ summary: UsageSummary; page: UsagePage }>(`/api/admin/usage?${params}`),
    placeholderData: (prev) => prev,
  });

  const setSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("desc"); }
    setPage(1);
  };
  const sortArrow = (col: typeof sortBy) => sortBy === col ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <>
      <TopBar title={<>Us<em>age</em></>} eyebrow="Request log / analytics" actions={
        <select value={days} onChange={(e) => { setDays(Number((e.target as HTMLSelectElement).value)); setPage(1); }} style={{ background: "var(--ink-1)", border: "1px solid var(--ink-3)", color: "var(--text-1)", padding: "8px 10px", borderRadius: 4, fontSize: 12, fontFamily: "inherit" }}>
          {[1, 7, 30, 90].map(n => <option key={n} value={n}>Last {n} day{n > 1 ? "s" : ""}</option>)}
        </select>
      } />

      <Card>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="search" placeholder="Search by model, id, error..."
            value={search} onInput={(e) => { setSearch((e.target as HTMLInputElement).value); setPage(1); }}
            style={{ flex: 1, minWidth: 200, background: "var(--ink-1)", border: "1px solid var(--ink-3)", color: "var(--text-1)", padding: "8px 10px", borderRadius: 4, fontFamily: "inherit", fontSize: 13 }} />
          <select value={statusFilter} onChange={(e) => { setStatusFilter((e.target as HTMLSelectElement).value as any); setPage(1); }} style={{ background: "var(--ink-1)", border: "1px solid var(--ink-3)", color: "var(--text-1)", padding: "8px 10px", borderRadius: 4, fontSize: 12, fontFamily: "inherit" }}>
            <option value="all">All status</option>
            <option value="2xx">2xx success</option>
            <option value="4xx">4xx client error</option>
            <option value="5xx">5xx server error</option>
          </select>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>
            Client:
            <a href="#" onClick={(e) => { e.preventDefault(); setClientKeyId(undefined); setPage(1); }} style={clientKeyId === undefined ? { color: "var(--emerald-4)", fontWeight: 700, marginLeft: 6 } : { marginLeft: 6 }}>all</a>
            {keys?.map(k => (
              <a key={k.id} href="#" onClick={(e) => { e.preventDefault(); setClientKeyId(k.id); setPage(1); }}
                style={clientKeyId === k.id ? { color: "var(--emerald-4)", fontWeight: 700, marginLeft: 6 } : { marginLeft: 6 }}>{k.label}</a>
            ))}
          </div>
        </div>
      </Card>

      {data && (
        <div class="stat-grid">
          <Stat label="Total cost" value={`$${data.summary.totalCost.toFixed(4)}`} sub={<Delta pct={data.summary.deltaCostPct} label="vs prev period" />} />
          <Stat label="Requests" value={data.summary.totalRequests.toLocaleString()} sub={<Delta pct={data.summary.deltaRequestsPct} label="vs prev period" />} />
          <Stat label="Tokens" value={data.summary.totalTokens.toLocaleString()} sub={<Delta pct={data.summary.deltaTokensPct} label="vs prev period" />} />
        </div>
      )}

      <Card title="Requests">
        {isError ? <ErrorState error={error as Error} onRetry={() => refetch()} /> :
         isLoading || !data ? <TableSkeleton rows={5} cols={6} /> :
         data.page.rows.length === 0 ? <p class="card-sub">No requests match these filters.</p> : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table class="tbl">
                <thead>
                  <tr>
                    <th onClick={() => setSort("created_at")} style={{ cursor: "pointer" }}>Time{sortArrow("created_at")}</th>
                    <th>Model</th>
                    <th onClick={() => setSort("total_tokens")} style={{ cursor: "pointer" }}>Tokens{sortArrow("total_tokens")}</th>
                    <th onClick={() => setSort("cost_usd")} style={{ cursor: "pointer" }}>Cost{sortArrow("cost_usd")}</th>
                    <th onClick={() => setSort("latency_ms")} style={{ cursor: "pointer" }}>Latency{sortArrow("latency_ms")}</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.page.rows.map(l => (
                    <tr key={l.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Open request ${l.id}`}
                        onClick={() => setSelected(l.id)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(l.id); } }}
                        style={{ cursor: "pointer" }}>
                      <td title={l.createdAt}>{relativeTime(l.createdAt)}</td>
                      <td>{l.model}</td>
                      <td>{l.totalTokens.toLocaleString()}</td>
                      <td>${l.cost.toFixed(4)}</td>
                      <td>{l.latencyMs}ms</td>
                      <td><Badge variant={l.statusCode < 300 ? "active" : l.statusCode < 500 ? "warn" : "error"}>{l.statusCode}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={data.page.page} pageSize={data.page.pageSize}
              total={data.page.total} totalPages={data.page.totalPages}
              onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
            />
          </>
        )}
      </Card>
      <RequestDetail id={selected} onClose={() => setSelected(null)} />
    </>
  );
}
