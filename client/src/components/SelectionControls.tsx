import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useToast } from './ToastProvider';

export interface SelectionSettings {
  mode: string;
  step: number;
}

/** Inline selection mode + step controls for one provider card (auto-saves). */
export function SelectionControls({
  provider,
}: {
  provider: 'minimax' | 'kiro' | 'pioneer' | 'notion' | 'zai' | 'tabi' | 'qwencloud';
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({
    queryKey: ['selection', provider],
    queryFn: () => apiFetch<SelectionSettings>(`/api/admin/settings/selection/${provider}`),
  });
  const mut = useMutation({
    mutationFn: (body: SelectionSettings) =>
      apiFetch(`/api/admin/settings/selection/${provider}`, { method: 'POST', json: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['selection', provider] });
      toast.success('Saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const mode = data?.mode ?? 'lowest-backoff';
  const step = data?.step ?? 1;

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span class="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
        Selection
      </span>
      <select
        class="input"
        name="selectionMode"
        aria-label="Selection mode"
        value={mode}
        disabled={mut.isPending}
        onChange={(e) => mut.mutate({ mode: (e.target as HTMLSelectElement).value, step })}
      >
        <option value="lowest-backoff">Lowest backoff</option>
        <option value="round-robin">Round-robin</option>
        <option value="sticky">Sticky</option>
      </select>
      {mode === 'round-robin' && (
        <input
          class="input"
          type="number"
          min={1}
          name="step"
          aria-label="Step"
          style={{ width: 72 }}
          value={step}
          disabled={mut.isPending}
          onChange={(e) => {
            const v = Number((e.target as HTMLInputElement).value);
            if (Number.isInteger(v) && v >= 1) mut.mutate({ mode, step: v });
          }}
        />
      )}
    </div>
  );
}
