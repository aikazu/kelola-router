import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'preact/hooks';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { confirmDialog } from '../components/Confirm';
import { ErrorState } from '../components/ErrorState';
import { Modal } from '../components/Modal';
import { TableSkeleton } from '../components/Skeleton';
import { Switch } from '../components/Switch';
import { useToast } from '../components/ToastProvider';
import { TopBar } from '../layout/TopBar';
import { apiFetch } from '../lib/api';

interface Model {
  name: string;
  displayName: string | null;
  family: string | null;
  contextWindow: number | null;
  provider: string;
  pricingInput: number | null;
  pricingOutput: number | null;
  source: string;
  enabled: boolean;
  aliasCount: number;
}

function fmtContext(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

function fmtPrice(n: number | null): string {
  if (n == null) return '—';
  return `$${n}`;
}

export function Models() {
  const qc = useQueryClient();
  const toast = useToast();
  const {
    data: models = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({ queryKey: ['models'], queryFn: () => apiFetch<Model[]>('/api/admin/models') });
  const { data: aliases = [] } = useQuery({
    queryKey: ['aliases'],
    queryFn: () => apiFetch<{ aliases: Array<{ aliasName: string }> }>('/api/admin/aliases').then((r) => r.aliases),
  });
  const shadowedNames = useMemo(
    () => new Set(aliases.filter((a) => models.some((m) => m.name === a.aliasName)).map((a) => a.aliasName)),
    [aliases, models]
  );

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState<null | 'minimax' | 'kiro'>(null);
  const [addForm, setAddForm] = useState({
    name: '',
    displayName: '',
    contextWindow: '',
    pricingInput: '',
    pricingOutput: '',
  });
  const toggleSelect = (name: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  const clearSelection = () => setSelected(new Set());
  const toggleMut = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      apiFetch(`/api/admin/models/${encodeURIComponent(name)}/${enabled ? 'disable' : 'enable'}`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['models'] });
      toast.success('Updated');
    },
    onError: (e: Error) => toast.error(e.message || 'Toggle failed'),
  });
  const fetchMut = useMutation({
    mutationFn: () =>
      apiFetch<{ added: number; updated: number; total: number }>('/api/admin/models/fetch', {
        method: 'POST',
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['models'] });
      toast.success(`Fetched (${r.total} total)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const bulkMut = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch('/api/admin/models/bulk-toggle', { method: 'POST', json: { names: [...selected], enabled } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['models'] });
      toast.success(`${selected.size} models updated`);
      clearSelection();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  type TestState =
    | { state: 'loading' }
    | { state: 'ok'; ms: number }
    | { state: 'fail'; error: string };
  const [testResults, setTestResults] = useState<Record<string, TestState>>({});
  const runTest = async (name: string) => {
    setTestResults((r) => ({ ...r, [name]: { state: 'loading' } }));
    try {
      const res = await apiFetch<{ ok: boolean; latencyMs: number; error?: string }>(
        `/api/admin/models/${encodeURIComponent(name)}/test`,
        { method: 'POST' }
      );
      setTestResults((r) => ({
        ...r,
        [name]: res.ok
          ? { state: 'ok', ms: res.latencyMs }
          : { state: 'fail', error: res.error ?? 'failed' },
      }));
    } catch (e) {
      setTestResults((r) => ({ ...r, [name]: { state: 'fail', error: (e as Error).message } }));
    }
  };

  const addMut = useMutation({
    mutationFn: (provider: 'minimax' | 'kiro') =>
      apiFetch('/api/admin/models', {
        method: 'POST',
        json: {
          name: addForm.name.trim(),
          provider,
          displayName: addForm.displayName.trim() || undefined,
          contextWindow: addForm.contextWindow ? Number(addForm.contextWindow) : undefined,
          pricingInput: addForm.pricingInput ? Number(addForm.pricingInput) : undefined,
          pricingOutput: addForm.pricingOutput ? Number(addForm.pricingOutput) : undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['models'] });
      toast.success('Model added');
      setAddOpen(null);
      setAddForm({ name: '', displayName: '', contextWindow: '', pricingInput: '', pricingOutput: '' });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = models.filter(
    (m) =>
      !search ||
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.displayName?.toLowerCase().includes(search.toLowerCase())
  );
  const selectAll = () => setSelected(new Set(filtered.map((m) => m.name)));

  const providerCard = (provider: 'minimax' | 'kiro', title: string) => {
    const list = filtered.filter((m) => m.provider === provider);
    return (
      <Card
        title={title}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="sm" onClick={() => fetchMut.mutate()} disabled={fetchMut.isPending}>
              {fetchMut.isPending ? 'Fetching…' : 'Fetch from upstream'}
            </Button>
            <Button size="sm" onClick={() => setAddOpen(provider)}>+ Add model</Button>
          </div>
        }
      >
        {list.length === 0 ? (
          <p class="card-sub">No {title} models.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table class="tbl">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <input
                      type="checkbox"
                      checked={selected.size === list.length && list.length > 0 && list.every((m) => selected.has(m.name))}
                      onChange={() => {
                        if (list.every((m) => selected.has(m.name))) {
                          const next = new Set(selected);
                          list.forEach((m) => next.delete(m.name));
                          setSelected(next);
                        } else {
                          const next = new Set(selected);
                          list.forEach((m) => next.add(m.name));
                          setSelected(next);
                        }
                      }}
                    />
                  </th>
                  <th>Name</th>
                  <th>Context</th>
                  <th class="num">In $/M</th>
                  <th class="num">Out $/M</th>
                  <th>Aliases</th>
                  <th>Status</th>
                  <th>Test</th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.name}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(m.name)}
                        onChange={() => toggleSelect(m.name)}
                      />
                    </td>
                    <td class="mono">
                      {m.name}
                      {shadowedNames.has(m.name) && (
                        <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--gold, #c9a352)', fontFamily: 'var(--font-body, inherit)' }}>
                          ⚡ shadowed
                        </span>
                      )}
                    </td>
                    <td class="mono">{fmtContext(m.contextWindow)}</td>
                    <td class="num mono">{fmtPrice(m.pricingInput)}</td>
                    <td class="num mono">{fmtPrice(m.pricingOutput)}</td>
                    <td>
                      {m.aliasCount > 0 ? (
                        <a href={`#/admin/aliases?target=${encodeURIComponent(m.name)}`}>
                          {m.aliasCount} alias{m.aliasCount === 1 ? '' : 'es'}
                        </a>
                      ) : (
                        <span class="card-sub">—</span>
                      )}
                    </td>
                    <td>
                      <Switch
                        checked={m.enabled}
                        onChange={async () => {
                          if (m.enabled) {
                            const ok = await confirmDialog({
                              title: 'Disable model',
                              message: `Disable "${m.name}"? Clients using this model will get 404.`,
                              confirmLabel: 'Disable',
                              danger: true,
                            });
                            if (!ok) return;
                          }
                          toggleMut.mutate({ name: m.name, enabled: m.enabled });
                        }}
                        label={m.enabled ? 'on' : 'off'}
                      />
                    </td>
                    <td>
                      {(() => {
                        const t = testResults[m.name];
                        if (t?.state === 'loading')
                          return <span class="mono" style={{ fontSize: 11 }}>…</span>;
                        if (t?.state === 'ok')
                          return (
                            <span class="mono" style={{ fontSize: 11, color: 'var(--signal)' }}>
                              ✓ {t.ms}ms
                            </span>
                          );
                        if (t?.state === 'fail')
                          return (
                            <span
                              class="mono"
                              style={{ fontSize: 11, color: 'var(--alert)' }}
                              title={t.error}
                            >
                              ✗ {t.error.slice(0, 24)}
                            </span>
                          );
                        return (
                          <Button size="sm" variant="ghost" onClick={() => runTest(m.name)}>
                            Test
                          </Button>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    );
  };

  return (
    <>
      <TopBar
        title={
          <>
            Mod<em>els</em>
          </>
        }
        eyebrow="Catalog / aliases"
      />
      <p class="card-sub">
        All models known to the router. Disabled models are rejected at the proxy layer.
      </p>
      <Card>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <input
            type="search"
            placeholder="Filter by name…"
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            style={{ flex: 1, minWidth: 180 }}
          />
        </div>
        {selected.size > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', background: 'var(--surface-2, rgba(255,255,255,0.03))', borderRadius: 8, marginBottom: 8, border: '1px solid var(--border)' }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{selected.size} selected</span>
            <Button size="sm" onClick={() => bulkMut.mutate(true)} disabled={bulkMut.isPending}>Enable all</Button>
            <Button size="sm" variant="danger" onClick={() => bulkMut.mutate(false)} disabled={bulkMut.isPending}>Disable all</Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
          </div>
        )}
      </Card>

      {isError ? (
        <ErrorState error={error as Error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={5} cols={7} />
      ) : (
        <>
          {providerCard('minimax', 'MiniMax')}
          {providerCard('kiro', 'Kiro')}
        </>
      )}

      <Modal
        open={addOpen !== null}
        onClose={() => setAddOpen(null)}
        title={`Add ${addOpen === 'kiro' ? 'Kiro' : 'MiniMax'} model`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(null)}>Cancel</Button>
            <Button
              onClick={() => addOpen && addMut.mutate(addOpen)}
              disabled={addMut.isPending || !addForm.name.trim()}
            >
              {addMut.isPending ? 'Adding…' : 'Add model'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label>
            Model name
            <input
              class="input"
              value={addForm.name}
              onInput={(e) => setAddForm({ ...addForm, name: (e.target as HTMLInputElement).value })}
              placeholder="exact upstream model id"
            />
          </label>
          <label>
            Display name (optional)
            <input
              class="input"
              value={addForm.displayName}
              onInput={(e) =>
                setAddForm({ ...addForm, displayName: (e.target as HTMLInputElement).value })
              }
            />
          </label>
          <label>
            Context window (optional)
            <input
              class="input"
              type="number"
              value={addForm.contextWindow}
              onInput={(e) =>
                setAddForm({ ...addForm, contextWindow: (e.target as HTMLInputElement).value })
              }
            />
          </label>
          <div style={{ display: 'flex', gap: 10 }}>
            <label style={{ flex: 1 }}>
              Pricing in $/M (optional)
              <input
                class="input"
                type="number"
                value={addForm.pricingInput}
                onInput={(e) =>
                  setAddForm({ ...addForm, pricingInput: (e.target as HTMLInputElement).value })
                }
              />
            </label>
            <label style={{ flex: 1 }}>
              Pricing out $/M (optional)
              <input
                class="input"
                type="number"
                value={addForm.pricingOutput}
                onInput={(e) =>
                  setAddForm({ ...addForm, pricingOutput: (e.target as HTMLInputElement).value })
                }
              />
            </label>
          </div>
        </div>
      </Modal>
    </>
  );
}
