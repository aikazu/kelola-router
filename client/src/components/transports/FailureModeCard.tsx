import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import { Card } from '../Card';
import { useToast } from '../ToastProvider';

/** "On proxy failure" control card. Self-contained: owns its query + mutation. */
export function FailureModeCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: failureMode } = useQuery({
    queryKey: ['proxy-failure-mode'],
    queryFn: () => apiFetch<{ mode: 'direct' | 'block' }>('/api/admin/transports/failure-mode'),
  });

  const failureModeMut = useMutation({
    mutationFn: (mode: 'direct' | 'block') =>
      apiFetch('/api/admin/transports/failure-mode', { method: 'PUT', json: { mode } }),
    onSuccess: (_d, mode) => {
      qc.invalidateQueries({ queryKey: ['proxy-failure-mode'] });
      toast.success(
        mode === 'block'
          ? 'On proxy failure: requests will be blocked'
          : 'On proxy failure: fallback to direct connection'
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h3 style={{ margin: '0 0 2px' }}>On proxy failure</h3>
          <p class="card-sub" style={{ margin: 0 }}>
            {failureMode?.mode === 'block'
              ? 'Requests blocked (HTTP 502) — real IP protected, request fails.'
              : 'Fallback to direct connection — request proceeds but real IP is exposed.'}
          </p>
        </div>
        <select
          name="failure-mode"
          class="input"
          style={{ maxWidth: 200 }}
          value={failureMode?.mode ?? 'direct'}
          disabled={failureModeMut.isPending}
          onChange={(e) =>
            failureModeMut.mutate((e.target as HTMLSelectElement).value as 'direct' | 'block')
          }
        >
          <option value="direct">Fallback to direct</option>
          <option value="block">Block request</option>
        </select>
      </div>
    </Card>
  );
}
