import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { confirmDialog } from '../components/Confirm';
import { ErrorState } from '../components/ErrorState';
import { Modal } from '../components/Modal';
import { TableSkeleton } from '../components/Skeleton';
import { useToast } from '../components/ToastProvider';
import { TopBar } from '../layout/TopBar';
import { apiFetch } from '../lib/api';
import { relativeTime } from '../lib/relative-time';

interface Alias {
  aliasName: string;
  upstreamModel: string;
  label: string | null;
  source: string;
  createdAt: string;
}
interface Model {
  name: string;
  enabled: boolean;
}

const NAME_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export function Aliases() {
  const qc = useQueryClient();
  const toast = useToast();
  const {
    data: aliases = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['aliases'],
    queryFn: () => apiFetch<{ aliases: Alias[] }>('/api/admin/aliases').then((r) => r.aliases),
  });
  const { data: models = [] } = useQuery({
    queryKey: ['models'],
    queryFn: () => apiFetch<Model[]>('/api/admin/models'),
  });

  // Parse ?target=... from hash for filter prefill
  const [search, setSearch] = useState('');
  useEffect(() => {
    const h = location.hash.split('?')[1] ?? '';
    const params = new URLSearchParams(h);
    const t = params.get('target');
    if (t) setSearch(t);
  }, []);

  const [editing, setEditing] = useState<Alias | 'new' | null>(null);

  const saveMut = useMutation({
    mutationFn: async (args: {
      aliasName: string;
      upstreamModel: string;
      label: string | null;
      originalName?: string;
    }) => {
      if (args.originalName) {
        return apiFetch<Alias>(`/api/admin/aliases/${encodeURIComponent(args.originalName)}`, {
          method: 'PUT',
          json: { upstreamModel: args.upstreamModel, label: args.label },
        });
      }
      return apiFetch<Alias>('/api/admin/aliases', {
        method: 'POST',
        json: { aliasName: args.aliasName, upstreamModel: args.upstreamModel, label: args.label },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aliases'] });
      qc.invalidateQueries({ queryKey: ['models'] });
      setEditing(null);
      toast.success('Saved');
    },
    onError: (e: Error) => toast.error(e.message || 'Save failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (name: string) =>
      apiFetch(`/api/admin/aliases/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aliases'] });
      qc.invalidateQueries({ queryKey: ['models'] });
      toast.success('Deleted');
    },
    onError: (e: Error) => toast.error(e.message || 'Delete failed'),
  });

  const filtered = useMemo(
    () =>
      aliases.filter(
        (a) =>
          !search ||
          a.aliasName.toLowerCase().includes(search.toLowerCase()) ||
          a.upstreamModel.toLowerCase().includes(search.toLowerCase()) ||
          (a.label?.toLowerCase().includes(search.toLowerCase()) ?? false)
      ),
    [aliases, search]
  );

  return (
    <>
      <TopBar
        title={
          <>
            Ali<em>as</em>es
          </>
        }
        eyebrow="Catalog / aliases"
        actions={<Button onClick={() => setEditing('new')}>+ New alias</Button>}
      />
      <Card
        eyebrow="ALIASES"
        title="Alias → model map"
        sub="User-defined names that resolve to upstream models (e.g. claude-opus-4-8 → MiniMax-M3)."
      >
        <input
          type="search"
          placeholder="Filter by alias, target, or label…"
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          class="input"
          style={{ width: '100%', maxWidth: 360, marginBottom: 12 }}
          aria-label="Search aliases"
        />
        {isError ? (
          <ErrorState error={error as Error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : filtered.length === 0 ? (
          <p class="card-sub mono" style={{ padding: 16 }}>
            {aliases.length === 0 ? (
              <>
                no aliases defined —{' '}
                <button type="button" class="btn-link" onClick={() => setEditing('new')}>
                  create one →
                </button>
              </>
            ) : (
              'no aliases match.'
            )}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table class="tbl">
              <thead>
                <tr>
                  <th>Alias</th>
                  <th>→ Target</th>
                  <th>Label</th>
                  <th>Source</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.aliasName}>
                    <td class="mono">{a.aliasName}</td>
                    <td class="mono">{a.upstreamModel}</td>
                    <td>{a.label ?? '—'}</td>
                    <td class="mono">
                      <span
                        class={`dot ${a.source === 'user' ? 'dot--active' : 'dot--idle'}`}
                        aria-hidden="true"
                        style={{ marginRight: 6 }}
                      />
                      <span style={{ fontSize: 11, letterSpacing: '0.06em' }}>{a.source}</span>
                    </td>
                    <td class="mono num" style={{ fontSize: 12 }} title={a.createdAt}>
                      {relativeTime(a.createdAt)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, whiteSpace: 'nowrap' }}>
                        <Button size="sm" onClick={() => setEditing(a)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={async () => {
                            if (
                              await confirmDialog({
                                title: 'Delete alias',
                                message: `Delete alias "${a.aliasName}"?`,
                                confirmLabel: 'Delete',
                                danger: true,
                              })
                            ) {
                              deleteMut.mutate(a.aliasName);
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <AliasModal
          alias={editing === 'new' ? null : editing}
          models={models}
          onClose={() => setEditing(null)}
          onSave={(payload) => saveMut.mutate(payload)}
          saving={saveMut.isPending}
        />
      )}
    </>
  );
}

function AliasModal({
  alias,
  models,
  onClose,
  onSave,
  saving,
}: {
  alias: Alias | null;
  models: Model[];
  onClose: () => void;
  onSave: (args: {
    aliasName: string;
    upstreamModel: string;
    label: string | null;
    originalName?: string;
  }) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(alias?.aliasName ?? '');
  const [target, setTarget] = useState(alias?.upstreamModel ?? models[0]?.name ?? '');
  const [label, setLabel] = useState(alias?.label ?? '');
  const enabledModels = models.filter((m) => m.enabled);

  const nameValid = NAME_RE.test(name);
  const targetValid = enabledModels.some((m) => m.name === target);

  return (
    <Modal
      open
      onClose={onClose}
      title={alias ? `Edit alias: ${alias.aliasName}` : 'New alias'}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSave({
                aliasName: name.trim(),
                upstreamModel: target.trim(),
                label: label.trim() || null,
                originalName: alias?.aliasName,
              })
            }
            disabled={saving || !nameValid || !targetValid}
          >
            {saving ? 'Saving…' : alias ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span class="card-sub mono" style={{ fontSize: 12, textTransform: 'uppercase' }}>
            Alias name
          </span>
          <input
            value={name}
            disabled={!!alias}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            placeholder="e.g. claude-opus-4-8…"
            class="input"
            aria-label="Alias name"
          />
          {name && !nameValid && (
            <span style={{ color: 'var(--alert)', fontSize: 12 }}>
              Letters, digits, . _ : - only (1-128 chars)
            </span>
          )}
          {name && models.some((m) => m.name === name) && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--gold, #c9a352)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                marginTop: 4,
              }}
            >
              ⚡ This alias shadows built-in model "{name}". Requests for this name route to the
              alias target instead.
            </span>
          )}
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span class="card-sub mono" style={{ fontSize: 12, textTransform: 'uppercase' }}>
            Target upstream model
          </span>
          <select
            value={target}
            onChange={(e) => setTarget((e.target as HTMLSelectElement).value)}
            class="input"
            aria-label="Target upstream model"
          >
            {enabledModels.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span class="card-sub mono" style={{ fontSize: 12, textTransform: 'uppercase' }}>
            Label (optional)
          </span>
          <input
            value={label}
            onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
            placeholder="e.g. Claude Code → M3…"
            class="input"
            aria-label="Label (optional)"
          />
        </label>
      </div>
    </Modal>
  );
}
