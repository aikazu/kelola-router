import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { apiFetch } from '../../lib/api';
import { callName, PROVIDERS_WITH_FETCH } from '../../lib/providerPrefix';
import { Button } from '../Button';
import { Card } from '../Card';
import { confirmDialog } from '../Confirm';
import { Switch } from '../Switch';
import { useToast } from '../ToastProvider';
import type { Provider } from './types';
import { fmtContext, fmtPrice, type Model, type TestState } from './types';

interface ProviderModelsSectionProps {
  title: string;
  provider: Provider;
  models: Model[];
  selected: Set<string>;
  onSelectChange: (next: Set<string>) => void;
  shadowedNames: Set<string>;
  onAddModel: () => void;
  onEditModel: (model: Model) => void;
}

export function ProviderModelsSection({
  title,
  provider,
  models,
  selected,
  onSelectChange,
  shadowedNames,
  onAddModel,
  onEditModel,
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
      apiFetch<{ added: number; total: number }>(`/api/admin/models/fetch/${provider}`, {
        method: 'POST',
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['models'] });
      toast.success(`Fetched (${r.total} total)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copyCallName = async (m: Model) => {
    const text = callName(provider, m.name);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    toast.success(`Copied ${text}`);
  };

  const deleteMut = useMutation({
    mutationFn: (name: string) =>
      apiFetch(`/api/admin/models/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['models'] });
      toast.success('Model deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onDelete = async (m: Model) => {
    let refs: { aliases: { aliasName: string }[]; combos: { comboName: string }[] };
    try {
      refs = await apiFetch(`/api/admin/models/${encodeURIComponent(m.name)}/refs`);
    } catch (e) {
      toast.error((e as Error).message);
      return;
    }
    if (refs.aliases.length > 0 || refs.combos.length > 0) {
      const aliasList = refs.aliases.map((a) => a.aliasName).join(', ');
      const comboList = refs.combos.map((c) => c.comboName).join(', ');
      toast.error(
        `Blocked: referenced by alias [${aliasList}] / combo [${comboList}]. Remove them first.`
      );
      return;
    }
    const ok = await confirmDialog({
      title: 'Delete model',
      message: `Delete "${m.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    deleteMut.mutate(m.name);
  };

  const canFetch = PROVIDERS_WITH_FETCH.has(provider);

  return (
    <Card
      title={title}
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          {canFetch && (
            <Button size="sm" onClick={() => fetchMut.mutate()} disabled={fetchMut.isPending}>
              {fetchMut.isPending ? 'Fetching…' : 'Fetch from upstream'}
            </Button>
          )}
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
                <th>ID</th>
                <th>Name</th>
                <th>Context In</th>
                <th>Context Out</th>
                <th class="num">In $/M</th>
                <th class="num">Out $/M</th>
                <th>Aliases</th>
                <th>Combo</th>
                <th>Status</th>
                <th>Test</th>
                <th>Actions</th>
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
                    {callName(provider, m.name)}
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
                  <td>{m.displayName ?? m.name}</td>
                  <td class="mono">{fmtContext(m.contextWindow)}</td>
                  <td class="mono">{fmtContext(m.contextOutput)}</td>
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
                    {m.comboCount > 0 ? (
                      <a href="#/admin/combos">
                        {m.comboCount} combo{m.comboCount === 1 ? '' : 's'}
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
                          <span class="mono" style={{ fontSize: 11, color: 'var(--alert)' }} title={t.error}>
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
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <Button size="sm" variant="ghost" onClick={() => copyCallName(m)}>
                        Copy
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onEditModel(m)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => onDelete(m)}>
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
  );
}
