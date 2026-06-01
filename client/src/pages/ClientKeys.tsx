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

const inputStyle: any = { width: "100%", marginTop: 6, padding: "8px 10px", background: "var(--ink-1)", border: "1px solid var(--ink-3)", color: "var(--text-1)", borderRadius: 4, fontFamily: "inherit", fontSize: 13 };

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
            <pre style={{ background: "var(--ink-2)", padding: 12, borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 12, wordBreak: "break-all" }}>{created.key}</pre>
          </>
        ) : (
          <label style={{ display: "block" }}>Label <input value={label} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} placeholder="my-app" style={inputStyle} /></label>
        )}
      </Modal>
    </>
  );
}
