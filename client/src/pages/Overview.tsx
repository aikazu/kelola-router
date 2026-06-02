import { useState } from "preact/hooks";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Card } from "../components/Card";
import { Stat } from "../components/Stat";
import { StatSkeleton } from "../components/Skeleton";
import { TableSkeleton } from "../components/Skeleton";
import { ErrorState } from "../components/ErrorState";
import { TopBar } from "../layout/TopBar";
import { Badge } from "../components/Badge";
import { RequestDetail } from "./RequestDetail";
import { relativeTime } from "../lib/relativeTime";

interface OverviewData {
  stats: { totalCost: number; totalRequests: number; totalTokens: number; enabledAccounts: number; totalAccounts: number; activeClientKeys: number };
  byModel: Array<{ model: string; cost: number; requests: number }>;
  recent: Array<{ id: number; createdAt: string; model: string; statusCode: number; cost: number; latencyMs: number; clientKeyId: number | null; accountId: string | null }>;
}

export function Overview() {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["overview"], queryFn: () => apiFetch<OverviewData>("/api/admin/overview") });
  const [selected, setSelected] = useState<number | null>(null);

  if (isError) return <><TopBar title="Overview" /><ErrorState error={error as Error} onRetry={() => refetch()} /></>;

  return (
    <>
      <TopBar title="Overview" />
      <div class="stat-grid">
        {isLoading || !data ? <>
          <StatSkeleton /><StatSkeleton /><StatSkeleton /><StatSkeleton />
        </> : <>
          <Stat label="Cost (7d)" value={`$${data.stats.totalCost.toFixed(2)}`} sub={`${data.stats.totalRequests} requests`} />
          <Stat label="Tokens (7d)" value={data.stats.totalTokens.toLocaleString()} sub="prompt + completion + cache" />
          <Stat label="Upstream accounts" value={`${data.stats.enabledAccounts} / ${data.stats.totalAccounts}`} sub="enabled / total in pool" />
          <Stat label="Client keys" value={data.stats.activeClientKeys} sub="active bearers" />
        </>}
      </div>
      <Card title="By model (last 7 days)">
        {isLoading || !data ? <TableSkeleton rows={3} cols={3} /> :
         data.byModel.length === 0 ? <p class="card-sub">No requests yet.</p> : (
          <table class="tbl">
            <thead><tr><th>Model</th><th>Cost</th><th>Requests</th></tr></thead>
            <tbody>{data.byModel.map(m => <tr key={m.model}><td>{m.model}</td><td>${m.cost.toFixed(4)}</td><td>{m.requests.toLocaleString()}</td></tr>)}</tbody>
          </table>
        )}
      </Card>
      <Card title="Recent requests" actions={<a href="#/admin/usage" class="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }}>View all →</a>}>
        {isLoading || !data ? <TableSkeleton rows={5} cols={5} /> :
         data.recent.length === 0 ? <p class="card-sub">No traffic yet.</p> : (
          <table class="tbl">
            <thead><tr><th>Time</th><th>Model</th><th>Status</th><th>Latency</th><th>Cost</th></tr></thead>
            <tbody>{data.recent.map(r => (
              <tr key={r.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open request ${r.id}`}
                  onClick={() => setSelected(r.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(r.id); } }}
                  style={{ cursor: "pointer" }}>
                <td title={r.createdAt}>{relativeTime(r.createdAt)}</td>
                <td>{r.model}</td>
                <td><Badge variant={r.statusCode < 300 ? "active" : r.statusCode < 500 ? "warn" : "error"}>{r.statusCode}</Badge></td>
                <td>{r.latencyMs}ms</td>
                <td>${r.cost.toFixed(4)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      <RequestDetail id={selected} onClose={() => setSelected(null)} />
    </>
  );
}
