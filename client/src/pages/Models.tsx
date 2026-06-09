import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { confirmDialog } from '../components/Confirm';
import { ErrorState } from '../components/ErrorState';
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
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState<'all' | 'minimax' | 'kiro'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
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

  const filtered = models.filter(
    (m) =>
      (providerFilter === 'all' || m.provider === providerFilter) &&
      (!search ||
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        m.displayName?.toLowerCase().includes(search.toLowerCase()))
  );
  const selectAll = () => setSelected(new Set(filtered.map((m) => m.name)));

  return (
    <>
      <TopBar
        title={
          <>
            Mod<em>els</em>
          </>
        }
        eyebrow="Catalog / aliases"
        actions={
          <Button onClick={() => fetchMut.mutate()} disabled={fetchMut.isPending}>
            {fetchMut.isPending ? 'Fetching…' : 'Fetch from upstream'}
          </Button>
        }
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
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter((e.target as HTMLSelectElement).value as any)}
          >
            <option value="all">All providers</option>
            <option value="minimax">MiniMax</option>
            <option value="kiro">Kiro</option>
          </select>
        </div>
        {isError ? (
          <ErrorState error={error as Error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <TableSkeleton rows={5} cols={7} />
        ) : filtered.length === 0 ? (
          <p class="card-sub">No models match.</p>
        ) : (
          <>
            {selected.size > 0 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', background: 'var(--surface-2, rgba(255,255,255,0.03))', borderRadius: 8, marginBottom: 8, border: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{selected.size} selected</span>
                <Button size="sm" onClick={() => bulkMut.mutate(true)} disabled={bulkMut.isPending}>Enable all</Button>
                <Button size="sm" variant="danger" onClick={() => bulkMut.mutate(false)} disabled={bulkMut.isPending}>Disable all</Button>
                <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
              </div>
            )}
            <div style={{ overflowX: 'auto' }}>
            <table class="tbl">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <input
                      type="checkbox"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={() => selected.size === filtered.length ? clearSelection() : selectAll()}
                    />
                  </th>
                  <th>Name</th>
                  <th>Provider</th>
                  <th>Context</th>
                  <th class="num">In $/M</th>
                  <th class="num">Out $/M</th>
                  <th>Aliases</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.name}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(m.name)}
                        onChange={() => toggleSelect(m.name)}
                      />
                    </td>
                    <td class="mono">{m.name}</td>
                    <td>
                      <Badge variant={m.provider === 'kiro' ? 'active' : 'muted'}>{m.provider}</Badge>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
    </>
  );
}
