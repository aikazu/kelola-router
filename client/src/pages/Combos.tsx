import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { confirmDialog } from '../components/Confirm';
import { ErrorState } from '../components/ErrorState';
import { Modal } from '../components/Modal';
import { TableSkeleton } from '../components/Skeleton';
import { useToast } from '../components/ToastProvider';
import { TopBar } from '../layout/TopBar';
import { apiFetch } from '../lib/api';
import { relativeTime } from '../lib/relativeTime';

interface Combo {
  id: string;
  name: string;
  models: string[];
  created_at: string;
  updated_at: string;
}

interface Model {
  name: string;
  enabled: boolean;
}

const NAME_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export function Combos() {
  const qc = useQueryClient();
  const toast = useToast();
  const {
    data: combos = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['combos'],
    queryFn: () => apiFetch<{ combos: Combo[] }>('/api/admin/combos').then((r) => r.combos),
  });

  const { data: models = [] } = useQuery({
    queryKey: ['models'],
    queryFn: () => apiFetch<Model[]>('/api/admin/models'),
  });

  const [editing, setEditing] = useState<Combo | 'new' | null>(null);

  const saveMut = useMutation({
    mutationFn: async (args: { id?: string; name: string; models: string[] }) => {
      if (args.id) {
        return apiFetch<Combo>(`/api/admin/combos/${encodeURIComponent(args.id)}`, {
          method: 'PUT',
          json: { name: args.name, models: args.models },
        });
      }
      return apiFetch<Combo>('/api/admin/combos', {
        method: 'POST',
        json: { name: args.name, models: args.models },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['combos'] });
      setEditing(null);
      toast.success('Saved');
    },
    onError: (e: Error) => toast.error(e.message || 'Save failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/admin/combos/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['combos'] });
      toast.success('Deleted');
    },
    onError: (e: Error) => toast.error(e.message || 'Delete failed'),
  });

  return (
    <>
      <TopBar
        title={
          <>
            Com<em>bo</em>s
          </>
        }
        eyebrow="Catalog / combos"
        actions={<Button onClick={() => setEditing('new')}>+ New Combo</Button>}
      />
      <Card
        eyebrow="COMBOS"
        title="Fallback chains"
        sub="Ordered sequences of models — requests route through the list in priority order for fallback or load distribution."
      >
        {isError ? (
          <ErrorState error={error as Error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <TableSkeleton rows={4} cols={4} />
        ) : combos.length === 0 ? (
          <p class="card-sub mono" style={{ padding: 16 }}>
            no combos defined —{' '}
            <button type="button" class="btn-link" onClick={() => setEditing('new')}>
              create one →
            </button>
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {combos.map((c) => (
              <div key={c.id} class="surface" style={{ padding: 0 }}>
                <div class="card-head" style={{ justifyContent: 'space-between' }}>
                  <div class="card-head-text">
                    <span class="card-eyebrow">{c.name.toUpperCase()}</span>
                    <h3 class="card-title mono" style={{ fontSize: 14 }}>
                      {c.models.length} model{c.models.length !== 1 ? 's' : ''}
                      <span
                        class="card-sub mono"
                        style={{ marginLeft: 8, fontSize: 11 }}
                        title={c.updated_at}
                      >
                        updated {relativeTime(c.updated_at)}
                      </span>
                    </h3>
                  </div>
                  <div style={{ display: 'flex', gap: 4, whiteSpace: 'nowrap' }}>
                    <Button size="sm" onClick={() => setEditing(c)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        if (
                          await confirmDialog({
                            title: 'Delete combo',
                            message: `Delete combo "${c.name}"? This cannot be undone.`,
                            confirmLabel: 'Delete',
                            danger: true,
                          })
                        ) {
                          deleteMut.mutate(c.id);
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
                <div style={{ padding: '0 16px 12px', display: 'grid', gap: 4 }}>
                  {c.models.map((m, idx) => (
                    <div
                      key={`${c.id}-${idx}-${m}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                      <span
                        class={`dot ${idx === 0 ? 'dot--active' : 'dot--idle'}`}
                        aria-hidden="true"
                      />
                      <span
                        class="mono"
                        style={{ fontSize: 11, color: 'var(--ink-faint)', width: 16 }}
                      >
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <span class="mono" style={{ fontSize: 13 }}>
                        {m}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {editing && (
        <ComboModal
          combo={editing === 'new' ? null : editing}
          models={models}
          onClose={() => setEditing(null)}
          onSave={(payload) => saveMut.mutate(payload)}
          saving={saveMut.isPending}
        />
      )}
    </>
  );
}

function ComboModal({
  combo,
  models,
  onClose,
  onSave,
  saving,
}: {
  combo: Combo | null;
  models: Model[];
  onClose: () => void;
  onSave: (args: { id?: string; name: string; models: string[] }) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(combo?.name ?? '');
  const [comboModels, setComboModels] = useState<string[]>(combo?.models ?? []);
  const [addingModel, setAddingModel] = useState(false);

  const enabledModels = models.filter((m) => m.enabled);
  const availableModels = enabledModels.filter((m) => !comboModels.includes(m.name));

  const nameValid = NAME_RE.test(name);
  const nameTooLong = name.length > 128;
  const hasModels = comboModels.length > 0;

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const next = [...comboModels];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setComboModels(next);
  };

  const moveDown = (idx: number) => {
    if (idx >= comboModels.length - 1) return;
    const next = [...comboModels];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    setComboModels(next);
  };

  const removeModel = (idx: number) => {
    setComboModels(comboModels.filter((_, i) => i !== idx));
  };

  const addModel = (modelName: string) => {
    setComboModels([...comboModels, modelName]);
    setAddingModel(false);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={combo ? `Edit combo: ${combo.name}` : 'New combo'}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSave({
                id: combo?.id,
                name: name.trim(),
                models: comboModels,
              })
            }
            disabled={saving || !nameValid || nameTooLong || !hasModels}
          >
            {saving ? 'Saving…' : combo ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span class="card-sub mono" style={{ fontSize: 12, textTransform: 'uppercase' }}>
            Combo name
          </span>
          <input
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            placeholder="e.g. my-combo-1…"
            class="input"
            aria-label="Combo name"
          />
          {name && !nameValid && (
            <span style={{ color: 'var(--alert)', fontSize: 12 }}>
              Letters, digits, . _ - : only (max 128 chars)
            </span>
          )}
          {nameTooLong && (
            <span style={{ color: 'var(--alert)', fontSize: 12 }}>
              Name too long — max 128 characters
            </span>
          )}
        </label>

        <div style={{ display: 'grid', gap: 8 }}>
          <span class="card-sub mono" style={{ fontSize: 12, textTransform: 'uppercase' }}>
            Models (priority order)
          </span>

          {comboModels.length === 0 ? (
            <p class="card-sub mono" style={{ margin: 0 }}>
              no models added yet.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 4 }}>
              {comboModels.map((m, idx) => (
                <div
                  key={`${m}-${idx}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    borderRadius: 4,
                    background: 'var(--obsidian-3)',
                  }}
                >
                  <span
                    class={`dot ${idx === 0 ? 'dot--active' : 'dot--idle'}`}
                    aria-hidden="true"
                  />
                  <span
                    class="mono"
                    style={{ fontSize: 11, color: 'var(--ink-faint)', width: 20, flexShrink: 0 }}
                  >
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span class="mono" style={{ flex: 1, fontSize: 13 }}>
                    {m}
                  </span>
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      onClick={() => moveUp(idx)}
                      disabled={idx === 0}
                      title="Move up"
                      aria-label={`Move ${m} up`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      onClick={() => moveDown(idx)}
                      disabled={idx === comboModels.length - 1}
                      title="Move down"
                      aria-label={`Move ${m} down`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      class="btn btn-danger btn-sm"
                      onClick={() => removeModel(idx)}
                      title="Remove"
                      aria-label={`Remove ${m}`}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {addingModel ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                class="input"
                style={{ flex: 1 }}
                aria-label="Select model to add"
                onChange={(e) => {
                  const val = (e.target as HTMLSelectElement).value;
                  if (val) addModel(val);
                }}
              >
                <option value="">Select a model…</option>
                {availableModels.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
              <Button variant="ghost" size="sm" onClick={() => setAddingModel(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAddingModel(true)}
              disabled={availableModels.length === 0}
            >
              + Add Model
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
