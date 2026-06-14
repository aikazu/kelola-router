import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { apiFetch } from '../../lib/api';
import { Button } from '../Button';
import { Card } from '../Card';
import { confirmDialog } from '../Confirm';
import { Switch } from '../Switch';
import { useToast } from '../ToastProvider';
import { fmtContext, fmtPrice, type Model, type TestState } from './types';

interface ProviderModelsSectionProps {
  title: string;
  models: Model[];
  selected: Set<string>;
  onSelectChange: (next: Set<string>) => void;
  shadowedNames: Set<string>;
  onAddModel: () => void;
}

/**
 * Per-provider models card (MiniMax / Kiro). Owns row-level interaction state
 * (per-row test results) and the toggle / fetch mutations. The parent supplies
 * the filtered list, the shared selection set (+ mutator), the shadowed-name
 * set, and an `onAddModel` callback to open the add modal.
 *
 * Extracted verbatim from the `providerCard` render helper in Models.tsx —
 * no behavior or className changes.
 */
export function ProviderModelsSection({
  title,
  models,
  selected,
  onSelectChange,
  shadowedNames,
  onAddModel,
}: ProviderModelsSectionProps) {
  const qc = useQueryClient();
  const toast = useToast();

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

  return (
    <Card
      title={title}
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" onClick={() => fetchMut.mutate()} disabled={fetchMut.isPending}>
            {fetchMut.isPending ? 'Fetching…' : 'Fetch from upstream'}
          </Button>
          <Button size="sm" onClick={onAddModel}>
            + Add model
          </Button>
        </div>
      }
    >
      {models.length === 0 ? (
        <p class="card-sub">No {title} models.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table class="tbl">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    checked={models.length > 0 && models.every((m) => selected.has(m.name))}
                    onChange={() => {
                      if (models.every((m) => selected.has(m.name))) {
                        const next = new Set(selected);
                        models.forEach((m) => {
                          next.delete(m.name);
                        });
                        onSelectChange(next);
                      } else {
                        const next = new Set(selected);
                        models.forEach((m) => {
                          next.add(m.name);
                        });
                        onSelectChange(next);
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
              {models.map((m) => (
                <tr key={m.name}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(m.name)}
                      onChange={() => {
                        const next = new Set(selected);
                        if (next.has(m.name)) next.delete(m.name);
                        else next.add(m.name);
                        onSelectChange(next);
                      }}
                    />
                  </td>
                  <td class="mono">
                    {m.name}
                    {shadowedNames.has(m.name) && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 9,
                          color: 'var(--gold, #c9a352)',
                          fontFamily: 'var(--font-body, inherit)',
                        }}
                      >
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
                        return (
                          <span class="mono" style={{ fontSize: 11 }}>
                            …
                          </span>
                        );
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
}
