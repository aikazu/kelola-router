import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { Badge } from '../components/Badge';
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

interface Account {
  id: string;
  label: string;
  creditType: string;
  status: string;
  enabled: boolean;
  lastError: string | null;
  backoffLevel: number;
  rateLimitedUntil: string | null;
}

const inputStyle: any = {
  width: '100%',
  marginTop: 6,
  padding: '8px 10px',
  background: 'var(--ink-1)',
  border: '1px solid var(--ink-3)',
  color: 'var(--text-1)',
  borderRadius: 4,
  fontFamily: 'inherit',
  fontSize: 13,
};

export function Accounts() {
  const qc = useQueryClient();
  const toast = useToast();
  const {
    data: accounts = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => apiFetch<Account[]>('/api/admin/accounts'),
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ label: '', credit_type: 'payg', api_key: '' });
  const [editing, setEditing] = useState<Account | null>(null);
  const [editForm, setEditForm] = useState({ label: '', api_key: '' });

  const createMut = useMutation({
    mutationFn: () => apiFetch('/api/admin/accounts', { method: 'POST', json: form }),
    onSuccess: () => {
      setOpen(false);
      setForm({ label: '', credit_type: 'payg', api_key: '' });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      toast.success('Account added');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiFetch(`/api/admin/accounts/${id}/${enabled ? 'disable' : 'enable'}`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      toast.success('Updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const editMut = useMutation({
    mutationFn: ({ id, label, api_key }: { id: string; label?: string; api_key?: string }) =>
      apiFetch(`/api/admin/accounts/${id}`, { method: 'PATCH', json: { label, api_key } }),
    onSuccess: () => {
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['accounts'] });
      toast.success('Account updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      toast.success('Deleted');
    },
  });

  const statusVariant = (s: string, e: boolean) => {
    if (!e) return 'muted';
    if (s === 'active') return 'active';
    if (s === 'error') return 'error';
    if (s === 'rate_limited') return 'warn';
    return 'muted';
  };

  async function handleDelete(id: string, label: string) {
    const ok = await confirmDialog({
      title: 'Delete account',
      message: `Delete "${label}"? Cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) deleteMut.mutate(id);
  }

  return (
    <>
      <TopBar
        title={
          <>
            Upstream <em>accounts</em>
          </>
        }
        eyebrow="MiniMax key pool"
        actions={<Button onClick={() => setOpen(true)}>+ Add account</Button>}
      />
      <p class="card-sub">
        Pool of MiniMax API keys. The router fans out across enabled accounts with backoff +
        per-model locks when one returns 429/5xx.
      </p>
      <Card>
        {isError ? (
          <ErrorState error={error as Error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <TableSkeleton rows={3} cols={8} />
        ) : accounts.length === 0 ? (
          <div class="empty">
            <h3>No upstream accounts yet</h3>
            <p>Add a MiniMax API key to start routing requests.</p>
          </div>
        ) : (
          <table class="tbl">
            <thead>
              <tr>
                <th>ID</th>
                <th>Label</th>
                <th>Credit</th>
                <th>Status</th>
                <th>Last error</th>
                <th>Backoff</th>
                <th>Rate-limited until</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td class="mono">{a.id}</td>
                  <td>{a.label}</td>
                  <td>
                    <Badge variant={a.creditType === 'token-plan' ? 'warn' : 'active'}>
                      {a.creditType}
                    </Badge>
                  </td>
                  <td>
                    <Badge
                      variant={statusVariant(a.status, a.enabled)}
                      pulse={a.status === 'rate_limited'}
                    >
                      {a.enabled ? a.status : 'disabled'}
                    </Badge>
                  </td>
                  <td
                    class="mono"
                    style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}
                    title={a.lastError ?? ''}
                  >
                    {a.lastError ?? '—'}
                  </td>
                  <td>{a.backoffLevel}</td>
                  <td title={a.rateLimitedUntil ?? ''}>{relativeTime(a.rateLimitedUntil)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(a);
                        setEditForm({ label: a.label, api_key: '' });
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (a.enabled) {
                          const ok = await confirmDialog({
                            title: 'Disable account',
                            message: `Disable "${a.label}"? Requests will no longer route to it.`,
                            confirmLabel: 'Disable',
                            danger: true,
                          });
                          if (!ok) return;
                        }
                        toggleMut.mutate({ id: a.id, enabled: a.enabled });
                      }}
                    >
                      {a.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => handleDelete(a.id, a.label)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add MiniMax account"
        footer={
          <Button
            onClick={() => createMut.mutate()}
            disabled={!form.label || !form.api_key || createMut.isPending}
          >
            {createMut.isPending ? 'Adding…' : 'Add'}
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            Label{' '}
            <input
              value={form.label}
              onInput={(e) => setForm({ ...form, label: (e.target as HTMLInputElement).value })}
              style={inputStyle}
              aria-required="true"
            />
            {!form.label && (
              <span style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 4, display: 'block' }}>
                Required — a name to identify this account.
              </span>
            )}
          </label>
          <label>
            Credit type
            <select
              value={form.credit_type}
              onChange={(e) =>
                setForm({ ...form, credit_type: (e.target as HTMLSelectElement).value })
              }
              style={inputStyle}
            >
              <option value="payg">PAYG</option>
              <option value="token-plan">Token Plan</option>
            </select>
          </label>
          <label>
            MiniMax API key{' '}
            <input
              value={form.api_key}
              onInput={(e) => setForm({ ...form, api_key: (e.target as HTMLInputElement).value })}
              placeholder="mm_xxxxxxxx"
              style={inputStyle}
              aria-required="true"
            />
            {!form.api_key && (
              <span style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 4, display: 'block' }}>
                Required — your MiniMax API key starting with mm_.
              </span>
            )}
          </label>
        </div>
      </Modal>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Edit "${editing?.label ?? ''}"`}
        footer={
          <Button
            onClick={() =>
              editing &&
              editMut.mutate({
                id: editing.id,
                label: editForm.label || undefined,
                api_key: editForm.api_key || undefined,
              })
            }
            disabled={(!editForm.label && !editForm.api_key) || editMut.isPending}
          >
            {editMut.isPending ? 'Saving…' : 'Save'}
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            Label
            <input
              value={editForm.label}
              onInput={(e) => setEditForm({ ...editForm, label: (e.target as HTMLInputElement).value })}
              style={inputStyle}
            />
          </label>
          <label>
            New API key (leave empty to keep current)
            <input
              value={editForm.api_key}
              onInput={(e) => setEditForm({ ...editForm, api_key: (e.target as HTMLInputElement).value })}
              placeholder="mm_xxxxxxxx"
              style={inputStyle}
            />
          </label>
        </div>
      </Modal>
    </>
  );
}
