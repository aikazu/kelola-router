import { useState } from "preact/hooks";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Card } from "../components/Card";
import { Stat } from "../components/Stat";
import { TopBar } from "../layout/TopBar";
import { Badge } from "../components/Badge";
import { RequestDetail } from "./RequestDetail";

interface OverviewData {
  stats: { totalCost: number; totalRequests: number; totalTokens: number; enabledAccounts: number; totalAccounts: number; activeClientKeys: number };
  byModel: Array<{ model: string; cost: number; requests: number }>;
  recent: Array<{ id: number; createdAt: string; model: string; statusCode: number; cost: number; latencyMs: number; clientKeyId: number | null; accountId: string | null }>;
}

export function Overview() {
  const { data, isLoading } = useQuery({ queryKey: ["overview"], queryFn: () => apiFetch<OverviewData>("/api/admin/overview") });
  const [selected, setSelected] = useState<number | null>(null);

  if (isLoading || !data) return <><TopBar title="Overview" /><p style={{ color: "var(--text-3)" }}>Loading…</p></>;

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
