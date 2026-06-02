import { useState } from "preact/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Card } from "../components/Card";
import { TopBar } from "../layout/TopBar";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { Switch } from "../components/Switch";
import { useToast } from "../components/ToastProvider";
import { TableSkeleton } from "../components/Skeleton";
import { ErrorState } from "../components/ErrorState";

interface Model { name: string; displayName: string | null; family: string | null; contextWindow: number | null; thinkingEnabled: boolean; source: string; enabled: boolean; }

export function Models() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: models = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ["models"], queryFn: () => apiFetch<Model[]>("/api/admin/models") });
  const [search, setSearch] = useState("");
  const toggleMut = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) => apiFetch(`/api/admin/models/${encodeURIComponent(name)}/${enabled ? "disable" : "enable"}`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["models"] }); toast.success("Updated"); },
  });
  const fetchMut = useMutation({
    mutationFn: () => apiFetch<{ added: number; updated: number; total: number }>("/api/admin/models/fetch", { method: "POST" }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["models"] }); toast.success(`Fetched (${r.total} total)`); },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = models.filter(m => !search || m.name.toLowerCase().includes(search.toLowerCase()) || (m.displayName?.toLowerCase().includes(search.toLowerCase())));

  return (
    <>
      <TopBar title="Models" actions={<Button onClick={() => fetchMut.mutate()} disabled={fetchMut.isPending}>{fetchMut.isPending ? "Fetching…" : "Fetch from upstream"}</Button>} />
      <p class="card-sub">All models known to the router. Disabled models are rejected at the proxy layer.</p>
      <Card>
        <input type="search" placeholder="Filter by name…" value={search} onInput={(e) => setSearch((e.target as HTMLInputElement).value)} style={{ width: "100%", marginBottom: 12, padding: "8px 10px", background: "var(--ink-1)", border: "1px solid var(--ink-3)", color: "var(--text-1)", borderRadius: 4, fontFamily: "inherit", fontSize: 13 }} />
        {isError ? <ErrorState error={error as Error} onRetry={() => refetch()} /> :
         isLoading ? <TableSkeleton rows={5} cols={7} /> :
         filtered.length === 0 ? <p class="card-sub">No models match.</p> : (
          <table class="tbl">
            <thead><tr><th>Name</th><th>Display</th><th>Family</th><th>Context</th><th>Thinking</th><th>Source</th><th>Status</th></tr></thead>
            <tbody>{filtered.map(m => (
              <tr key={m.name}>
                <td class="mono">{m.name}</td>
                <td>{m.displayName ?? "—"}</td>
                <td>{m.family ?? "—"}</td>
                <td>{m.contextWindow ?? "—"}</td>
                <td>{m.thinkingEnabled ? "yes" : "no"}</td>
                <td><Badge variant={m.source === "builtin" ? "muted" : "active"}>{m.source}</Badge></td>
                <td>
                  <Switch checked={m.enabled} onChange={() => toggleMut.mutate({ name: m.name, enabled: m.enabled })} label={m.enabled ? "on" : "off"} />
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
