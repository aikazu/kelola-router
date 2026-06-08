import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
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
  provider?: string;
  authMethod?: string | null;
  persona?: string | null;
  creditType: string;
  status: string;
  enabled: boolean;
  lastError: string | null;
  backoffLevel: number;
  rateLimitedUntil: string | null;
}

interface DeviceCodeData {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
  clientId: string;
  clientSecret: string;
  region: string;
  authMethod: string;
  startUrl: string;
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
  const [provider, setProvider] = useState<'minimax' | 'kiro'>('minimax');
  const [form, setForm] = useState({ label: '', credit_type: 'payg', api_key: '' });
  const [kiroMethod, setKiroMethod] = useState<'builder-id' | 'idc' | 'token' | 'auto-import'>('builder-id');
  const [kiroForm, setKiroForm] = useState({
    label: '',
    credentialJson: '',
    refreshToken: '',
    region: '',
    startUrl: '',
  });

  // Device code flow state
  const [deviceStep, setDeviceStep] = useState<'idle' | 'loading' | 'code' | 'polling' | 'success' | 'error'>('idle');
  const [deviceData, setDeviceData] = useState<DeviceCodeData | null>(null);
  const [deviceError, setDeviceError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef(false);

  // Auto-import state
  const [autoImportStatus, setAutoImportStatus] = useState<'idle' | 'loading' | 'found' | 'error'>('idle');
  const [autoImportToken, setAutoImportToken] = useState('');
  const [autoImportSource, setAutoImportSource] = useState('');
  const [autoImportError, setAutoImportError] = useState('');

  const [editing, setEditing] = useState<Account | null>(null);
  const [editForm, setEditForm] = useState({ label: '', api_key: '', persona: 'ide' });

  function resetForms() {
    setProvider('minimax');
    setForm({ label: '', credit_type: 'payg', api_key: '' });
    setKiroMethod('builder-id');
    setKiroForm({ label: '', credentialJson: '', refreshToken: '', region: '', startUrl: '' });
    setDeviceStep('idle');
    setDeviceData(null);
    setDeviceError('');
    setAutoImportStatus('idle');
    setAutoImportToken('');
    setAutoImportSource('');
    setAutoImportError('');
    abortRef.current = true;
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  // Cleanup polling on unmount
  useEffect(() => () => { abortRef.current = true; if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Start device code flow
  const startDeviceCode = useCallback(async () => {
    setDeviceStep('loading');
    setDeviceError('');
    abortRef.current = false;
    try {
      const data = await apiFetch<DeviceCodeData>('/api/admin/accounts/kiro/device-code', {
        method: 'POST',
        json: {
          authMethod: kiroMethod,
          region: kiroForm.region || undefined,
          startUrl: kiroForm.startUrl || undefined,
        },
      });
      setDeviceData(data);
      setDeviceStep('code');
    } catch (e: any) {
      setDeviceError(e.message || 'Failed to start device code flow');
      setDeviceStep('error');
    }
  }, [kiroMethod, kiroForm.region, kiroForm.startUrl]);

  // Start polling after user code is shown
  const startPolling = useCallback(() => {
    if (!deviceData) return;
    setDeviceStep('polling');
    abortRef.current = false;
    const interval = (deviceData.interval || 5) * 1000;
    const deadline = Date.now() + (deviceData.expiresIn || 300) * 1000;

    pollRef.current = setInterval(async () => {
      if (abortRef.current || Date.now() > deadline) {
        if (pollRef.current) clearInterval(pollRef.current);
        if (!abortRef.current) {
          setDeviceError('Device code expired. Please try again.');
          setDeviceStep('error');
        }
        return;
      }
      try {
        const res = await apiFetch<any>('/api/admin/accounts/kiro/poll', {
          method: 'POST',
          json: {
            deviceCode: deviceData.deviceCode,
            clientId: deviceData.clientId,
            clientSecret: deviceData.clientSecret,
            region: deviceData.region,
            authMethod: deviceData.authMethod,
            startUrl: deviceData.startUrl,
            label: kiroForm.label || undefined,
          },
        });
        if (res.status === 'success') {
          if (pollRef.current) clearInterval(pollRef.current);
          setDeviceStep('success');
          qc.invalidateQueries({ queryKey: ['accounts'] });
          toast.success(`Kiro account "${res.label}" added`);
          setTimeout(() => { setOpen(false); resetForms(); }, 1500);
        } else if (res.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          setDeviceError(res.error || 'Authorization failed');
          setDeviceStep('error');
        }
        // status === 'pending' → keep polling
      } catch (e: any) {
        // Network errors → keep polling (transient)
      }
    }, interval);
  }, [deviceData, kiroForm.label, qc, toast]);

  // Auto-import
  const doAutoImport = useCallback(async () => {
    setAutoImportStatus('loading');
    setAutoImportError('');
    try {
      const res = await apiFetch<{ found: boolean; refreshToken?: string; source?: string; error?: string }>(
        '/api/admin/accounts/kiro/auto-import'
      );
      if (res.found && res.refreshToken) {
        setAutoImportToken(res.refreshToken);
        setAutoImportSource(res.source || '');
        setAutoImportStatus('found');
      } else {
        setAutoImportError(res.error || 'No token found');
        setAutoImportStatus('error');
      }
    } catch (e: any) {
      setAutoImportError(e.message || 'Auto-import failed');
      setAutoImportStatus('error');
    }
  }, []);

  // Save auto-imported token
  const saveAutoImport = useMutation({
    mutationFn: () =>
      apiFetch('/api/admin/accounts/kiro', {
        method: 'POST',
        json: { label: kiroForm.label || 'kiro-auto', method: 'token', refreshToken: autoImportToken },
      }),
    onSuccess: () => {
      setOpen(false);
      resetForms();
      qc.invalidateQueries({ queryKey: ['accounts'] });
      toast.success('Account imported from Kiro IDE');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Manual token/JSON save
  const createMut = useMutation({
    mutationFn: () =>
      provider === 'kiro'
        ? apiFetch('/api/admin/accounts/kiro', {
            method: 'POST',
            json: { label: kiroForm.label, method: 'token', credentialJson: kiroForm.credentialJson, refreshToken: kiroForm.refreshToken },
          })
        : apiFetch('/api/admin/accounts', { method: 'POST', json: form }),
    onSuccess: () => {
      setOpen(false);
      resetForms();
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
    mutationFn: ({
      id,
      label,
      api_key,
      persona,
    }: {
      id: string;
      label?: string;
      api_key?: string;
      persona?: string;
    }) =>
      apiFetch(`/api/admin/accounts/${id}`, { method: 'PATCH', json: { label, api_key, persona } }),
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

  // --- Render Kiro method-specific form ---
  function renderKiroDeviceFlow() {
    if (deviceStep === 'loading') {
      return <p style={{ color: 'var(--text-2)', textAlign: 'center', padding: 16 }}>Registering with AWS SSO…</p>;
    }
    if (deviceStep === 'code' || deviceStep === 'polling') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', padding: '8px 0' }}>
          <p style={{ color: 'var(--text-2)', fontSize: 13 }}>
            Open the link below and enter this code:
          </p>
          <div style={{ background: 'var(--ink-2)', border: '2px solid var(--gold)', borderRadius: 8, padding: '12px 24px', fontSize: 24, fontFamily: 'var(--font-mono)', letterSpacing: 4, fontWeight: 700 }}>
            {deviceData?.userCode}
          </div>
          <a
            href={deviceData?.verificationUriComplete || deviceData?.verificationUri}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--gold)', fontSize: 13 }}
          >
            {deviceData?.verificationUri} ↗
          </a>
          {deviceStep === 'code' && (
            <Button onClick={startPolling} style={{ marginTop: 8 }}>
              I've entered the code
            </Button>
          )}
          {deviceStep === 'polling' && (
            <p style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 8 }}>
              ⏳ Waiting for authorization… (polling every {deviceData?.interval || 5}s)
            </p>
          )}
        </div>
      );
    }
    if (deviceStep === 'success') {
      return <p style={{ color: 'var(--success)', textAlign: 'center', padding: 16, fontWeight: 600 }}>✓ Account connected successfully!</p>;
    }
    if (deviceStep === 'error') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
          <p style={{ color: 'var(--danger)', fontSize: 13 }}>{deviceError}</p>
          <Button onClick={startDeviceCode} size="sm">Retry</Button>
        </div>
      );
    }

    // idle — show config + start button
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label>
          Label{' '}
          <input
            value={kiroForm.label}
            onInput={(e) => setKiroForm({ ...kiroForm, label: (e.target as HTMLInputElement).value })}
            placeholder="kiro1"
            style={inputStyle}
          />
        </label>
        {kiroMethod === 'idc' && (
          <>
            <label>
              IDC Start URL <span style={{ color: 'var(--danger)' }}>*</span>
              <input
                value={kiroForm.startUrl}
                onInput={(e) => setKiroForm({ ...kiroForm, startUrl: (e.target as HTMLInputElement).value })}
                placeholder="https://your-org.awsapps.com/start"
                style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
              />
            </label>
            <label>
              Region
              <input
                value={kiroForm.region}
                onInput={(e) => setKiroForm({ ...kiroForm, region: (e.target as HTMLInputElement).value })}
                placeholder="us-east-1"
                style={inputStyle}
              />
            </label>
          </>
        )}
        <Button
          onClick={startDeviceCode}
          disabled={kiroMethod === 'idc' && !kiroForm.startUrl.trim()}
        >
          {kiroMethod === 'builder-id' ? 'Login with AWS Builder ID' : 'Login with IAM Identity Center'}
        </Button>
      </div>
    );
  }

  function renderKiroAutoImport() {
    if (autoImportStatus === 'loading') {
      return <p style={{ color: 'var(--text-2)', textAlign: 'center', padding: 16 }}>Scanning AWS SSO cache…</p>;
    }
    if (autoImportStatus === 'found') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: 'var(--ink-2)', border: '1px solid var(--success)', borderRadius: 6, padding: 12 }}>
            <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓ Token detected</span>
            <span style={{ color: 'var(--text-3)', fontSize: 11, marginLeft: 8 }}>from {autoImportSource}</span>
          </div>
          <label>
            Label{' '}
            <input
              value={kiroForm.label}
              onInput={(e) => setKiroForm({ ...kiroForm, label: (e.target as HTMLInputElement).value })}
              placeholder="kiro-auto"
              style={inputStyle}
            />
          </label>
          <Button onClick={() => saveAutoImport.mutate()} disabled={saveAutoImport.isPending}>
            {saveAutoImport.isPending ? 'Importing…' : 'Import this token'}
          </Button>
        </div>
      );
    }
    if (autoImportStatus === 'error') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ color: 'var(--danger)', fontSize: 13 }}>{autoImportError}</p>
          <Button onClick={doAutoImport} size="sm">Retry</Button>
        </div>
      );
    }
    // idle
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ color: 'var(--text-3)', fontSize: 13 }}>
          Auto-detect refresh token from Kiro IDE's AWS SSO cache (<code>~/.aws/sso/cache/</code>).
        </p>
        <Button onClick={doAutoImport}>Scan for Kiro token</Button>
      </div>
    );
  }

  function renderKiroTokenPaste() {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label>
          Label{' '}
          <input
            value={kiroForm.label}
            onInput={(e) => setKiroForm({ ...kiroForm, label: (e.target as HTMLInputElement).value })}
            placeholder="kiro1"
            style={inputStyle}
          />
        </label>
        <label>
          Credential JSON or refresh token
          <textarea
            value={kiroForm.credentialJson || kiroForm.refreshToken}
            onInput={(e) => {
              const val = (e.target as HTMLTextAreaElement).value;
              if (val.trim().startsWith('{')) {
                setKiroForm({ ...kiroForm, credentialJson: val, refreshToken: '' });
              } else {
                setKiroForm({ ...kiroForm, refreshToken: val, credentialJson: '' });
              }
            }}
            placeholder='Paste token JSON or raw refresh token (aorAAAAAG…)'
            style={{ ...inputStyle, minHeight: 100, fontFamily: 'var(--font-mono, monospace)' }}
          />
          <span style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 4, display: 'block' }}>
            From ~/.aws/sso/cache/kiro-auth-token.json or paste the refresh token directly.
          </span>
        </label>
      </div>
    );
  }

  return (
    <>
      <TopBar
        title={<>Up<em>stream</em></>}
        eyebrow="Upstream key pool"
        actions={<Button onClick={() => setOpen(true)}>+ Add account</Button>}
      />
      <p class="card-sub">
        MiniMax uses API keys. Kiro (AWS) supports OAuth, auto-import from Kiro IDE, or manual token paste.
        The router fans out across enabled accounts with exponential backoff.
      </p>
      <Card>
        {isError ? (
          <ErrorState error={error as Error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <TableSkeleton rows={3} cols={6} />
        ) : accounts.length === 0 ? (
          <div class="empty">
            <h3>No upstream accounts</h3>
            <p>Add a MiniMax API key or connect a Kiro (AWS) account to start proxying.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table class="tbl">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>Backoff</th>
                  <th>Last error</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <span style={{ fontWeight: 500 }}>{a.label}</span>
                      <span class="mono" style={{ fontSize: 10, color: 'var(--text-3)', display: 'block' }}>{a.id}</span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Badge variant={a.provider === 'kiro' ? 'active' : 'muted'}>
                        {a.provider === 'kiro' ? 'kiro' : 'minimax'}
                      </Badge>
                      {a.provider === 'kiro' && a.authMethod && (
                        <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 4 }}>{a.authMethod}</span>
                      )}
                      {a.provider === 'kiro' && (
                        <Badge variant={a.persona === 'cli' ? 'warn' : 'muted'} style={{ marginLeft: 6 }}>
                          {a.persona === 'cli' ? 'CLI' : 'IDE'}
                        </Badge>
                      )}
                    </td>
                    <td>
                      <Badge variant={statusVariant(a.status, a.enabled)} pulse={a.status === 'rate_limited'}>
                        {a.enabled ? a.status : 'disabled'}
                      </Badge>
                      {a.rateLimitedUntil && (
                        <span style={{ fontSize: 10, color: 'var(--text-3)', display: 'block' }} title={a.rateLimitedUntil}>
                          until {relativeTime(a.rateLimitedUntil)}
                        </span>
                      )}
                    </td>
                    <td class="mono">{a.backoffLevel || '—'}</td>
                    <td style={{ maxWidth: 220, fontSize: 11, color: 'var(--text-3)' }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.lastError ?? ''}>
                        {a.lastError ?? '—'}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Button size="sm" variant="ghost" onClick={() => { setEditing(a); setEditForm({ label: a.label, api_key: '', persona: a.persona === 'cli' ? 'cli' : 'ide' }); }}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={async () => {
                          if (a.enabled) {
                            const ok = await confirmDialog({ title: 'Disable account', message: `Disable "${a.label}"?`, confirmLabel: 'Disable', danger: true });
                            if (!ok) return;
                          }
                          toggleMut.mutate({ id: a.id, enabled: a.enabled });
                        }}>
                          {a.enabled ? 'Disable' : 'Enable'}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => handleDelete(a.id, a.label)}>Del</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Add Account Modal */}
      <Modal
        open={open}
        onClose={() => { setOpen(false); resetForms(); }}
        title="Add account"
        footer={
          // Footer button only for minimax and token-paste methods
          (provider === 'minimax' || (provider === 'kiro' && kiroMethod === 'token')) ? (
            <Button
              onClick={() => createMut.mutate()}
              disabled={
                createMut.isPending ||
                (provider === 'minimax'
                  ? !form.label || !form.api_key
                  : !kiroForm.credentialJson.trim() && !kiroForm.refreshToken.trim())
              }
            >
              {createMut.isPending ? 'Adding…' : 'Add'}
            </Button>
          ) : undefined
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            Provider
            <select
              value={provider}
              onChange={(e) => { setProvider((e.target as HTMLSelectElement).value as 'minimax' | 'kiro'); resetForms(); setProvider((e.target as HTMLSelectElement).value as any); }}
              style={inputStyle}
            >
              <option value="minimax">MiniMax (API key)</option>
              <option value="kiro">Kiro (AWS CodeWhisperer)</option>
            </select>
          </label>

          {provider === 'minimax' ? (
            <>
              <label>
                Label{' '}
                <input value={form.label} onInput={(e) => setForm({ ...form, label: (e.target as HTMLInputElement).value })} style={inputStyle} aria-required="true" />
              </label>
              <label>
                Credit type
                <select value={form.credit_type} onChange={(e) => setForm({ ...form, credit_type: (e.target as HTMLSelectElement).value })} style={inputStyle}>
                  <option value="payg">PAYG</option>
                  <option value="token-plan">Token Plan</option>
                </select>
              </label>
              <label>
                MiniMax API key{' '}
                <input value={form.api_key} onInput={(e) => setForm({ ...form, api_key: (e.target as HTMLInputElement).value })} placeholder="mm_xxxxxxxx" style={inputStyle} aria-required="true" />
              </label>
            </>
          ) : (
            <>
              {/* Kiro method selector */}
              <label>
                Auth method
                <select
                  value={kiroMethod}
                  onChange={(e) => { setKiroMethod((e.target as HTMLSelectElement).value as any); setDeviceStep('idle'); setAutoImportStatus('idle'); }}
                  style={inputStyle}
                >
                  <option value="builder-id">AWS Builder ID (OAuth)</option>
                  <option value="idc">AWS IAM Identity Center (OAuth)</option>
                  <option value="auto-import">Auto-import from Kiro IDE</option>
                  <option value="token">Paste token manually</option>
                </select>
              </label>

              {/* Render method-specific UI */}
              {(kiroMethod === 'builder-id' || kiroMethod === 'idc') && renderKiroDeviceFlow()}
              {kiroMethod === 'auto-import' && renderKiroAutoImport()}
              {kiroMethod === 'token' && renderKiroTokenPaste()}
            </>
          )}
        </div>
      </Modal>

      {/* Edit Modal */}
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
                persona:
                  editing.provider === 'kiro' && editForm.persona !== editing.persona
                    ? editForm.persona
                    : undefined,
              })
            }
            disabled={
              (!editForm.label &&
                !editForm.api_key &&
                !(editing?.provider === 'kiro' && editForm.persona !== editing?.persona)) ||
              editMut.isPending
            }
          >
            {editMut.isPending ? 'Saving…' : 'Save'}
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            Label
            <input value={editForm.label} onInput={(e) => setEditForm({ ...editForm, label: (e.target as HTMLInputElement).value })} style={inputStyle} />
          </label>
          <label>
            New API key (leave empty to keep current)
            <input value={editForm.api_key} onInput={(e) => setEditForm({ ...editForm, api_key: (e.target as HTMLInputElement).value })} placeholder="mm_xxxxxxxx" style={inputStyle} />
          </label>
          {editing?.provider === 'kiro' && (
            <label>
              Persona (upstream identity)
              <select
                value={editForm.persona}
                onChange={(e) => setEditForm({ ...editForm, persona: (e.target as HTMLSelectElement).value })}
                style={inputStyle}
              >
                <option value="ide">IDE (legacy · stable · codewhisperer.amazonaws.com)</option>
                <option value="cli">CLI (experimental · runtime.kiro.dev)</option>
              </select>
              <span style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 4, display: 'block' }}>
                IDE mimics the Kiro IDE wire format (default, battle-tested). CLI mimics the real
                kiro-cli (aws-sdk-rust / AmazonQ-For-CLI). Switch only this account; others stay on IDE.
              </span>
            </label>
          )}
        </div>
      </Modal>
    </>
  );
}
