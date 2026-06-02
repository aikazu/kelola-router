import { useState, useMemo, useEffect } from "preact/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { Card } from "../components/Card";
import { TopBar } from "../layout/TopBar";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { Modal } from "../components/Modal";
import { confirmDialog } from "../components/Confirm";
import { useToast } from "../components/ToastProvider";
import { TableSkeleton } from "../components/Skeleton";
import { ErrorState } from "../components/ErrorState";

interface Alias {
  aliasName: string;
  upstreamModel: string;
  label: string | null;
  source: string;
  createdAt: string;
}
interface Model { name: string; enabled: boolean; }

const NAME_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export function Aliases() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: aliases = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["aliases"],
    queryFn: () => apiFetch<{ aliases: Alias[] }>("/api/admin/aliases").then(r => r.aliases),
  });
  const { data: models = [] } = useQuery({
    queryKey: ["models"],
    queryFn: () => apiFetch<Model[]>("/api/admin/models"),
  });

  // Parse ?target=... from hash for filter prefill
  const [search, setSearch] = useState("");
  useEffect(() => {
    const h = location.hash.split("?")[1] ?? "";
    const params = new URLSearchParams(h);
    const t = params.get("target");
    if (t) setSearch(t);
  }, []);

  const [editing, setEditing] = useState<Alias | "new" | null>(null);

  const saveMut = useMutation({
    mutationFn: async (args: { aliasName: string; upstreamModel: string; label: string | null; originalName?: string }) => {
      if (args.originalName) {
        return apiFetch<Alias>(`/api/admin/aliases/${encodeURIComponent(args.originalName)}`, {
          method: "PUT", json: { upstreamModel: args.upstreamModel, label: args.label },
        });
      }
      return apiFetch<Alias>("/api/admin/aliases", {
        method: "POST", json: { aliasName: args.aliasName, upstreamModel: args.upstreamModel, label: args.label },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["aliases"] });
      qc.invalidateQueries({ queryKey: ["models"] });
      setEditing(null);
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message || "Save failed"),
  });

  const deleteMut = useMutation({
    mutationFn: (name: string) => apiFetch(`/api/admin/aliases/${encodeURIComponent(name)}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["aliases"] });
      qc.invalidateQueries({ queryKey: ["models"] });
      toast.success("Deleted");
    },
    onError: (e: Error) => toast.error(e.message || "Delete failed"),
  });

  const filtered = useMemo(() => aliases.filter(a =>
    !search ||
    a.aliasName.toLowerCase().includes(search.toLowerCase()) ||
    a.upstreamModel.toLowerCase().includes(search.toLowerCase()) ||
    (a.label?.toLowerCase().includes(search.toLowerCase()) ?? false)
  ), [aliases, search]);

  return (
    <>
      <TopBar
        title={<>Ali<em>as</em>es</>}
        eyebrow="Catalog / aliases"
        actions={<Button onClick={() => setEditing("new")}>+ New alias</Button>}
      />
      <p class="card-sub">
        User-defined names that resolve to upstream models. Useful for matching client
        expectations (e.g. <code>claude-opus-4-8 → MiniMax-M3</code>).
      </p>
      <Card>
        <input
          type="search"
          placeholder="Filter by alias, target, or label…"
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          style={{ width: "100%", marginBottom: 12, padding: "8px 10px", background: "var(--ink-1)", border: "1px solid var(--ink-3)", color: "var(--text-1)", borderRadius: 4, fontFamily: "inherit", fontSize: 13 }}
        />
        {isError ? <ErrorState error={error as Error} onRetry={() => refetch()} /> :
         isLoading ? <TableSkeleton rows={5} cols={6} /> :
         filtered.length === 0 ? (
          <p class="card-sub">
            {aliases.length === 0
              ? <>No aliases yet. <a href="#" onClick={(e) => { e.preventDefault(); setEditing("new"); }}>Create one →</a></>
              : "No aliases match."}
          </p>
         ) : (
          <table class="tbl">
            <thead><tr><th>Alias</th><th>→ Target</th><th>Label</th><th>Source</th><th>Created</th><th></th></tr></thead>
            <tbody>{filtered.map(a => (
              <tr key={a.aliasName}>
                <td class="mono">{a.aliasName}</td>
                <td class="mono">{a.upstreamModel}</td>
                <td>{a.label ?? "—"}</td>
                <td><Badge variant={a.source === "user" ? "active" : "muted"}>{a.source}</Badge></td>
                <td class="card-sub mono" style={{ fontSize: 12 }}>{a.createdAt}</td>
                <td style={{ textAlign: "right" }}>
                  <Button size="sm" onClick={() => setEditing(a)}>Edit</Button>{" "}
                  <Button size="sm" variant="ghost" onClick={async () => {
                    if (await confirmDialog({ title: "Delete alias", message: `Delete alias "${a.aliasName}"?`, confirmLabel: "Delete", danger: true })) {
                      deleteMut.mutate(a.aliasName);
                    }
                  }}>Delete</Button>
                </td>
              </tr>
            ))}</tbody>
          </table>
         )}
      </Card>

      {editing && (
        <AliasModal
          alias={editing === "new" ? null : editing}
          models={models}
          onClose={() => setEditing(null)}
          onSave={(payload) => saveMut.mutate(payload)}
          saving={saveMut.isPending}
        />
      )}
    </>
  );
}

function AliasModal({ alias, models, onClose, onSave, saving }: {
  alias: Alias | null;
  models: Model[];
  onClose: () => void;
  onSave: (args: { aliasName: string; upstreamModel: string; label: string | null; originalName?: string }) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(alias?.aliasName ?? "");
  const [target, setTarget] = useState(alias?.upstreamModel ?? models[0]?.name ?? "");
  const [label, setLabel] = useState(alias?.label ?? "");
  const enabledModels = models.filter(m => m.enabled);

  const nameValid = NAME_RE.test(name);
  const targetValid = enabledModels.some(m => m.name === target);

  return (
    <Modal open onClose={onClose} title={alias ? `Edit alias: ${alias.aliasName}` : "New alias"} width={480}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          onClick={() => onSave({
            aliasName: name.trim(),
            upstreamModel: target.trim(),
            label: label.trim() || null,
            originalName: alias?.aliasName,
          })}
          disabled={saving || !nameValid || !targetValid}
        >{saving ? "Saving…" : alias ? "Save" : "Create"}</Button>
      </>}>
      <div style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span class="card-sub mono" style={{ fontSize: 12, textTransform: "uppercase" }}>Alias name</span>
          <input
            value={name}
            disabled={!!alias}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            placeholder="claude-opus-4-8"
            style={{ padding: "8px 10px", background: "var(--ink-1)", border: "1px solid var(--ink-3)", color: "var(--text-1)", borderRadius: 4, fontFamily: "inherit", fontSize: 13 }}
          />
          {name && !nameValid && <span style={{ color: "var(--alert)", fontSize: 12 }}>Letters, digits, . _ : - only (1-128 chars)</span>}
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span class="card-sub mono" style={{ fontSize: 12, textTransform: "uppercase" }}>Target upstream model</span>
          <select
            value={target}
            onChange={(e) => setTarget((e.target as HTMLSelectElement).value)}
            style={{ padding: "8px 10px", background: "var(--ink-1)", border: "1px solid var(--ink-3)", color: "var(--text-1)", borderRadius: 4, fontFamily: "inherit", fontSize: 13 }}
          >
            {enabledModels.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span class="card-sub mono" style={{ fontSize: 12, textTransform: "uppercase" }}>Label (optional)</span>
          <input
            value={label}
            onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
            placeholder="Claude Code → M3"
            style={{ padding: "8px 10px", background: "var(--ink-1)", border: "1px solid var(--ink-3)", color: "var(--text-1)", borderRadius: 4, fontFamily: "inherit", fontSize: 13 }}
          />
        </label>
      </div>
    </Modal>
  );
}
