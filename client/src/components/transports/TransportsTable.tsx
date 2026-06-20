import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { apiFetch } from '../../lib/api';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { Card } from '../Card';
import { confirmDialog } from '../Confirm';
import { ErrorState } from '../ErrorState';
import { TableSkeleton } from '../Skeleton';
import { useToast } from '../ToastProvider';
import type { TestResult, Transport } from './types';

interface TransportsTableProps {
  transports: Transport[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  onEdit: (t: Transport) => void;
}

/**
 * Transports list card. Owns row-level interaction state (selection, per-row
 * test results) and the toggle / delete / bulk-delete mutations. The parent
 * supplies the transports query result and an `onEdit` callback to open the
 * edit modal.
 */
export function TransportsTable({
  transports,
  isLoading,
  isError,
  error,
  refetch,
  onEdit,
}: TransportsTableProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const [testResults, setTestResults] = useState<Record<string, TestResult | 'loading'>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = transports.length > 0 && selected.size === transports.length;

  function toggleSelectAll() {
    setSelected((s) =>
      s.size === transports.length ? new Set() : new Set(transports.map((t) => t.id))
    );
  }

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiFetch(`/api/admin/transports/${id}`, { method: 'PATCH', json: { enabled: !enabled } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transports'] });
      toast.success('Updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/transports/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transports'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      toast.success('Deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<{ deleted: number }>('/api/admin/transports/bulk-delete', {
        method: 'POST',
        json: { ids },
      }),
    onSuccess: (res) => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['transports'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      toast.success(`Deleted ${res.deleted} transport${res.deleted !== 1 ? 's' : ''}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function runTest(id: string) {
    setTestResults((r) => ({ ...r, [id]: 'loading' }));
    try {
      const res = await apiFetch<TestResult>(`/api/admin/transports/${id}/test`, {
        method: 'POST',
      });
      setTestResults((r) => ({ ...r, [id]: res }));
      if (res.ok) toast.success(`Reachable · ${res.latencyMs}ms (HTTP ${res.status})`);
      else toast.error(`Failed: ${res.error}`);
    } catch (e: any) {
      setTestResults((r) => ({ ...r, [id]: { ok: false, latencyMs: 0, error: e.message } }));
      toast.error(e.message);
    }
  }

  async function handleDelete(id: string, label: string) {
    const ok = await confirmDialog({
      title: 'Delete transport',
      message: `Delete "${label}"? Accounts using it will fall back to direct / global config.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) deleteMut.mutate(id);
  }

  async function handleBulkDelete() {
    const ids = [...selected];
    if (!ids.length) return;
    const ok = await confirmDialog({
      title: 'Delete transports',
      message: `Delete ${ids.length} selected transport${ids.length !== 1 ? 's' : ''}? Accounts using them will fall back to direct / global config.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) bulkDeleteMut.mutate(ids);
  }

  return (
    <Card>
      {isError ? (
        <ErrorState error={error as Error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton rows={3} cols={5} />
      ) : transports.length === 0 ? (
        <div class="empty">
          <h3>No transports</h3>
          <p>Add a proxy or relay to route upstream traffic through it.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          {selected.size > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 10,
                padding: '8px 12px',
                background: 'var(--surface-2, rgba(201,163,82,0.08))',
                borderRadius: 8,
              }}
            >
              <span style={{ fontSize: 13 }}>{selected.size} selected</span>
              <Button
                size="sm"
                variant="danger"
                disabled={bulkDeleteMut.isPending}
                onClick={handleBulkDelete}
              >
                {bulkDeleteMut.isPending ? 'Deleting…' : `Delete ${selected.size}`}
              </Button>
            </div>
          )}
          <table class="tbl">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all transports"
                  />
                </th>
                <th>Label</th>
                <th>Type</th>
                <th>Geo</th>
                <th>URL</th>
                <th>Used by</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {transports.map((t) => {
                const tr = testResults[t.id];
                return (
                  <tr key={t.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(t.id)}
                        onChange={() => toggleSelect(t.id)}
                        aria-label={`Select ${t.label}`}
                      />
                    </td>
                    <td>
                      <span style={{ fontWeight: 500 }}>{t.label}</span>
                      <span
                        class="mono"
                        style={{ fontSize: 10, color: 'var(--text-3)', display: 'block' }}
                      >
                        {t.id}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Badge variant={t.type === 'relay' ? 'warn' : 'active'}>
                        {t.type} · {t.kind}
                      </Badge>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {t.country ? (
                        <Badge variant="active">{t.country}</Badge>
                      ) : (
                        <span style={{ color: 'var(--text-3)' }}>—</span>
                      )}
                    </td>
                    <td
                      class="mono"
                      style={{ maxWidth: 260, fontSize: 11, color: 'var(--text-3)' }}
                    >
                      <span
                        style={{
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={t.url}
                      >
                        {t.url}
                      </span>
                    </td>
                    <td>
                      {t.usageCount > 0 ? (
                        <span style={{ fontWeight: 500 }}>
                          {t.usageCount} account{t.usageCount !== 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-3)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <Badge variant={t.enabled ? 'active' : 'muted'}>
                        {t.enabled ? 'enabled' : 'disabled'}
                      </Badge>
                      {tr && tr !== 'loading' && (
                        <span
                          style={{
                            fontSize: 10,
                            display: 'block',
                            color: tr.ok ? 'var(--signal, #6cc3a6)' : 'var(--alert, #d27a6e)',
                          }}
                        >
                          {tr.ok
                            ? `✓ ${tr.latencyMs}ms`
                            : `✗ ${tr.error?.slice(0, 24) ?? 'failed'}`}
                        </span>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Button size="sm" variant="ghost" onClick={() => onEdit(t)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={tr === 'loading'}
                          onClick={() => runTest(t.id)}
                        >
                          {tr === 'loading' ? 'Testing…' : 'Test'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleMut.mutate({ id: t.id, enabled: t.enabled })}
                        >
                          {t.enabled ? 'Disable' : 'Enable'}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleDelete(t.id, t.label)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
