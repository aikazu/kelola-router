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

interface Transport {
  id: string;
  label: string;
  type: 'proxy' | 'relay';
  kind: 'http' | 'socks5' | 'vercel' | 'cloudflare';
  url: string;
  enabled: boolean;
  createdAt: string;
}

interface TestResult {
  ok: boolean;
  status?: number;
  latencyMs: number;
  error?: string;
}

const PROXY_KINDS = ['http', 'socks5'] as const;
const RELAY_KINDS = ['vercel', 'cloudflare'] as const;

export function Transports() {
  const qc = useQueryClient();
  const toast = useToast();
  const {
    data: transports = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['transports'],
    queryFn: () => apiFetch<Transport[]>('/api/admin/transports'),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ label: string; type: 'proxy' | 'relay'; kind: string; url: string }>({
    label: '',
    type: 'proxy',
    kind: 'http',
    url: '',
  });
  const [testResults, setTestResults] = useState<Record<string, TestResult | 'loading'>>({});

  function resetForm() {
    setForm({ label: '', type: 'proxy', kind: 'http', url: '' });
  }

  const createMut = useMutation({
    mutationFn: () => apiFetch('/api/admin/transports', { method: 'POST', json: form }),
    onSuccess: () => {
      setOpen(false);
      resetForm();
      qc.invalidateQueries({ queryKey: ['transports'] });
      toast.success('Transport added');
    },
    onError: (e: Error) => toast.error(e.message),
  });

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

  async function runTest(id: string) {
    setTestResults((r) => ({ ...r, [id]: 'loading' }));
    try {
      const res = await apiFetch<TestResult>(`/api/admin/transports/${id}/test`, { method: 'POST' });
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

  function onTypeChange(type: 'proxy' | 'relay') {
    setForm({ ...form, type, kind: type === 'proxy' ? 'http' : 'vercel' });
  }

  const kindOptions = form.type === 'proxy' ? PROXY_KINDS : RELAY_KINDS;

  return (
    <>
      <TopBar
        title={<>Pro<em>xies</em></>}
        eyebrow="Network transports"
        actions={<Button onClick={() => setOpen(true)}>+ Add transport</Button>}
      />
      <p class="card-sub">
        Define HTTP/SOCKS5 proxies and Vercel/Cloudflare relays here, then assign them per account on
        the Upstream page. Proxies can be pooled and rotated; relays are assigned one at a time.
      </p>
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
            <table class="tbl">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Type</th>
                  <th>URL</th>
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
                        <span style={{ fontWeight: 500 }}>{t.label}</span>
                        <span class="mono" style={{ fontSize: 10, color: 'var(--text-3)', display: 'block' }}>
                          {t.id}
                        </span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <Badge variant={t.type === 'relay' ? 'warn' : 'active'}>
                          {t.type} · {t.kind}
                        </Badge>
                      </td>
                      <td class="mono" style={{ maxWidth: 260, fontSize: 11, color: 'var(--text-3)' }}>
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.url}>
                          {t.url}
                        </span>
                      </td>
                      <td>
                        <Badge variant={t.enabled ? 'active' : 'muted'}>
                          {t.enabled ? 'enabled' : 'disabled'}
                        </Badge>
                        {tr && tr !== 'loading' && (
                          <span
                            style={{ fontSize: 10, display: 'block', color: tr.ok ? 'var(--signal, #6cc3a6)' : 'var(--alert, #d27a6e)' }}
                          >
                            {tr.ok ? `✓ ${tr.latencyMs}ms` : `✗ ${tr.error?.slice(0, 24) ?? 'failed'}`}
                          </span>
                        )}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <Button size="sm" variant="ghost" disabled={tr === 'loading'} onClick={() => runTest(t.id)}>
                            {tr === 'loading' ? 'Testing…' : 'Test'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => toggleMut.mutate({ id: t.id, enabled: t.enabled })}>
                            {t.enabled ? 'Disable' : 'Enable'}
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => handleDelete(t.id, t.label)}>
                            Del
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

      <Modal
        open={open}
        onClose={() => { setOpen(false); resetForm(); }}
        title="Add transport"
        footer={
          <Button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending || !form.label.trim() || !form.url.trim()}
          >
            {createMut.isPending ? 'Adding…' : 'Add'}
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            Type
            <select
              value={form.type}
              onChange={(e) => onTypeChange((e.target as HTMLSelectElement).value as 'proxy' | 'relay')}
              class="input"
            >
              <option value="proxy">Proxy (HTTP / SOCKS5)</option>
              <option value="relay">Relay (Vercel / Cloudflare)</option>
            </select>
          </label>
          <label>
            Kind
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: (e.target as HTMLSelectElement).value })}
              class="input"
            >
              {kindOptions.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Label
            <input
              value={form.label}
              onInput={(e) => setForm({ ...form, label: (e.target as HTMLInputElement).value })}
              placeholder={form.type === 'proxy' ? 'home socks' : 'vercel edge'}
              class="input"
            />
          </label>
          <label>
            URL
            <input
              value={form.url}
              onInput={(e) => setForm({ ...form, url: (e.target as HTMLInputElement).value })}
              placeholder={
                form.type === 'proxy'
                  ? form.kind === 'socks5'
                    ? 'socks5://127.0.0.1:1080'
                    : 'http://user:pass@host:8080'
                  : 'https://your-relay.vercel.app/api'
              }
              class="input" style={{ fontFamily: 'var(--font-mono, monospace)' }}
            />
            <span style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 4, display: 'block' }}>
              {form.type === 'relay'
                ? 'Relay endpoint that forwards using x-relay-target / x-relay-path headers.'
                : 'Proxy URL. Credentials may be embedded as user:pass@host.'}
            </span>
          </label>
        </div>
      </Modal>
    </>
  );
}
