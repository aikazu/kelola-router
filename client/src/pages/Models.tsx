import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'preact/hooks';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ErrorState } from '../components/ErrorState';
import { AddModelModal } from '../components/models/AddModelModal';
import { EditModelModal } from '../components/models/EditModelModal';
import { ProviderModelsSection } from '../components/models/ProviderModelsSection';
import type { Model, Provider } from '../components/models/types';
import { TableSkeleton } from '../components/Skeleton';
import { useToast } from '../components/ToastProvider';
import { TopBar } from '../layout/TopBar';
import { apiFetch } from '../lib/api';

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
    queryFn: () =>
      apiFetch<{ aliases: Array<{ aliasName: string }> }>('/api/admin/aliases').then(
        (r) => r.aliases
      ),
  });
  const shadowedNames = useMemo(
    () =>
      new Set(
        aliases.filter((a) => models.some((m) => m.name === a.aliasName)).map((a) => a.aliasName)
      ),
    [aliases, models]
  );

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState<null | Provider>(null);
  const [editTarget, setEditTarget] = useState<Model | null>(null);

  const clearSelection = () => setSelected(new Set());

  const bulkMut = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch('/api/admin/models/bulk-toggle', {
        method: 'POST',
        json: { names: [...selected], enabled },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['models'] });
      toast.success(`${selected.size} models updated`);
      clearSelection();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = models.filter(
    (m) =>
      !search ||
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.displayName?.toLowerCase().includes(search.toLowerCase())
  );

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
      <Card
        eyebrow="MODELS"
        title="Catalog"
        sub="All models known to the router. Disabled models are rejected at the proxy layer."
      >
        <div
          style={{
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <input
            type="search"
            class="input"
            aria-label="Search models"
            name="search"
            autoComplete="off"
            placeholder="Filter by name…"
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            style={{ flex: 1, minWidth: 180 }}
          />
        </div>
        {selected.size > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              padding: '8px 12px',
              background: 'var(--obsidian-3)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: 8,
              border: '1px solid var(--grid)',
            }}
          >
            <span class="mono" style={{ fontSize: 12, color: 'var(--gold)' }}>
              {selected.size} selected
            </span>
            <Button size="sm" onClick={() => bulkMut.mutate(true)} disabled={bulkMut.isPending}>
              {bulkMut.isPending ? 'Enabling…' : 'Enable all'}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => bulkMut.mutate(false)}
              disabled={bulkMut.isPending}
            >
              {bulkMut.isPending ? 'Disabling…' : 'Disable all'}
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              Clear
            </Button>
          </div>
        )}
      </Card>

      {isError ? (
        <ErrorState error={error as Error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={5} cols={7} />
      ) : (
        <>
          <ProviderModelsSection
            title="MiniMax"
            provider="minimax"
            models={filtered.filter((m) => m.provider === 'minimax')}
            selected={selected}
            onSelectChange={setSelected}
            shadowedNames={shadowedNames}
            onAddModel={() => setAddOpen('minimax')}
            onEditModel={(m) => setEditTarget(m)}
          />
          <ProviderModelsSection
            title="Kiro"
            provider="kiro"
            models={filtered.filter((m) => m.provider === 'kiro')}
            selected={selected}
            onSelectChange={setSelected}
            shadowedNames={shadowedNames}
            onAddModel={() => setAddOpen('kiro')}
            onEditModel={(m) => setEditTarget(m)}
          />
          <ProviderModelsSection
            title="Pioneer"
            provider="pioneer"
            models={filtered.filter((m) => m.provider === 'pioneer')}
            selected={selected}
            onSelectChange={setSelected}
            shadowedNames={shadowedNames}
            onAddModel={() => setAddOpen('pioneer')}
            onEditModel={(m) => setEditTarget(m)}
          />
          <ProviderModelsSection
            title="CodeBuddy"
            provider="codebuddy"
            models={filtered.filter((m) => m.provider === 'codebuddy')}
            selected={selected}
            onSelectChange={setSelected}
            shadowedNames={shadowedNames}
            onAddModel={() => setAddOpen('codebuddy')}
            onEditModel={(m) => setEditTarget(m)}
          />
          <ProviderModelsSection
            title="Z.AI"
            provider="zai"
            models={filtered.filter((m) => m.provider === 'zai')}
            selected={selected}
            onSelectChange={setSelected}
            shadowedNames={shadowedNames}
            onAddModel={() => setAddOpen('zai')}
            onEditModel={(m) => setEditTarget(m)}
          />
          <ProviderModelsSection
            title="TabiToken"
            provider="tabi"
            models={filtered.filter((m) => m.provider === 'tabi')}
            selected={selected}
            onSelectChange={setSelected}
            shadowedNames={shadowedNames}
            onAddModel={() => setAddOpen('tabi')}
            onEditModel={(m) => setEditTarget(m)}
          />
        </>
      )}

      <AddModelModal
        open={addOpen !== null}
        onClose={() => setAddOpen(null)}
        provider={addOpen ?? 'minimax'}
      />
      <EditModelModal model={editTarget} onClose={() => setEditTarget(null)} />
    </>
  );
}
