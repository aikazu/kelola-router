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
    mutationFn: () => apiFetch<{ added: number; updated: number; total: number }>("/api/admin/models/fetch", { method: "POST" }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["models"] }); toast.success(`Fetched (${r.total} total)`); },
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
                <Switch checked={m.enabled} onChange={() => toggleMut.mutate({ name: m.name, enabled: m.enabled })} label={m.enabled ? "on" : "off"} />
              </td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
    </>
  );
}
