import { useState } from "preact/hooks";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Card } from "../components/Card";
import { Stat } from "../components/Stat";
import { TopBar } from "../layout/TopBar";
import { Badge } from "../components/Badge";
import { RequestDetail } from "./RequestDetail";

interface ClientKey { id: number; label: string; enabled: boolean; }
interface UsageLog { id: number; createdAt: string; model: string; statusCode: number; cost: number; latencyMs: number; totalTokens: number; promptTokens: number; completionTokens: number; clientKeyId: number | null; accountId: string | null; }

export function Usage() {
  const [clientKeyId, setClientKeyId] = useState<number | undefined>(undefined);
  const [selected, setSelected] = useState<number | null>(null);

  const { data: keys } = useQuery({ queryKey: ["client-keys"], queryFn: () => apiFetch<ClientKey[]>("/api/admin/client-keys") });
  const url = clientKeyId ? `/api/admin/usage?client_key=${clientKeyId}` : "/api/admin/usage?days=30";
  const { data, isLoading } = useQuery({ queryKey: ["usage", clientKeyId], queryFn: () => apiFetch<{ summary: { totalCost: number; totalRequests: number; totalTokens: number }; logs: UsageLog[] }>(url) });

  return (
    <>
      <TopBar title="Usage" />
      <div class="card-sub" style={{ marginBottom: 18 }}>Filter:&nbsp;
        <a href="#/admin/usage" onClick={(e) => { e.preventDefault(); setClientKeyId(undefined); }} style={clientKeyId === undefined ? { color: "var(--emerald-4)", fontWeight: 700 } : {}}>all</a>
        &nbsp;
        {keys?.map(k => (
          <a key={k.id} href="#" onClick={(e) => { e.preventDefault(); setClientKeyId(k.id); }}
             style={clientKeyId === k.id ? { color: "var(--emerald-4)", fontWeight: 700, marginLeft: 6 } : { marginLeft: 6 }}>{k.label}</a>
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
        {isLoading || !data ? <p style={{ color: "var(--text-3)" }}>Loading…</p> : data.logs.length === 0 ? <p class="card-sub">No traffic yet.</p> : (
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
