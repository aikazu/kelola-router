import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'preact/hooks';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { confirmDialog } from '../components/Confirm';
import { ErrorState } from '../components/ErrorState';
import { Modal } from '../components/Modal';
import { SelectionControls } from '../components/SelectionControls';
import { TableSkeleton } from '../components/Skeleton';
import { useToast } from '../components/ToastProvider';
import { AccountsTable } from '../components/AccountsTable';
import { TransportAssignment } from '../components/TransportAssignment';
import { KiroAutoImportForm } from '../components/KiroAutoImportForm';
import { KiroDeviceFlowForm } from '../components/KiroDeviceFlowForm';
import { TopBar } from '../layout/TopBar';
import { apiFetch } from '../lib/api';
import { relativeTime } from '../lib/relativeTime';
import { useKiroAutoImport } from '../hooks/useKiroAutoImport';
import { useKiroDeviceFlow } from '../hooks/useKiroDeviceFlow';
import type { Account, ModelLock, Transport, TransportState } from '../lib/types';

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
  const minimaxAccounts = accounts.filter((a) => (a.provider ?? 'minimax') !== 'kiro');
  const kiroAccounts = accounts.filter((a) => a.provider === 'kiro');
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

  // Auto-import hook
  const autoImport = useKiroAutoImport({
    label: kiroForm.label,
    onLabelChange: (label) => setKiroForm({ ...kiroForm, label }),
    onSuccess: () => { setOpen(false); resetForms(); },
  });

  // Device code flow hook
  const deviceFlow = useKiroDeviceFlow({
    kiroMethod,
    region: kiroForm.region,
    startUrl: kiroForm.startUrl,
    label: kiroForm.label,
    onSuccess: () => { setOpen(false); resetForms(); },
  });

  // Kiro usage modal
  const [usageAccount, setUsageAccount] = useState<string | null>(null);
  const { data: usageData, isLoading: usageLoading, isError: usageError, error: usageErr } = useQuery({
    queryKey: ['account-usage', usageAccount],
    queryFn: () => apiFetch<Record<string, unknown>>(`/api/admin/accounts/${usageAccount}/usage`),
    enabled: !!usageAccount,
  });

  const [editing, setEditing] = useState<Account | null>(null);
  const [editForm, setEditForm] = useState({ label: '', api_key: '', persona: 'ide' });

  // Transport assignment state for the edit modal.
  const { data: transports = [] } = useQuery({
    queryKey: ['transports'],
    queryFn: () => apiFetch<Transport[]>('/api/admin/transports'),
  });
  // Model locks for the currently-editing account.
  const { data: locksData, refetch: refetchLocks } = useQuery({
    queryKey: ['account-locks', editing?.id],
    queryFn: () => apiFetch<{ locks: ModelLock[] }>(`/api/admin/accounts/${editing!.id}/locks`),
    enabled: !!editing,
  });
  const locks = locksData?.locks ?? [];
  const proxies = transports.filter((t) => t.type === 'proxy');
  const relays = transports.filter((t) => t.type === 'relay');
  const [tpState, setTpState] = useState<TransportState>({
    mode: 'none',
    proxyId: '',
    relayId: '',
    pool: [],
    rotate: 1,
  });

  function loadTransportState(a: Account) {
    if (a.relayId) {
      setTpState({ mode: 'relay', proxyId: '', relayId: a.relayId, pool: [], rotate: 1 });
    } else if (a.proxyPool && a.proxyPool.length > 0) {
      setTpState({ mode: 'pool', proxyId: '', relayId: '', pool: a.proxyPool, rotate: a.proxyRotateEvery ?? 1 });
    } else if (a.proxyId) {
      setTpState({ mode: 'proxy', proxyId: a.proxyId, relayId: '', pool: [], rotate: 1 });
    } else {
      setTpState({ mode: 'none', proxyId: '', relayId: '', pool: [], rotate: 1 });
    }
  }

  function resetForms() {
    setProvider('minimax');
    setForm({ label: '', credit_type: 'payg', api_key: '' });
    setKiroMethod('builder-id');
    setKiroForm({ label: '', credentialJson: '', refreshToken: '', region: '', startUrl: '' });
    autoImport.reset();
    deviceFlow.reset();
  }



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
    mutationFn: (vars: {
      id: string;
      label?: string;
      api_key?: string;
      persona?: string;
      relayId?: string | null;
      proxyId?: string | null;
      proxyPool?: string[] | null;
      proxyRotateEvery?: number;
    }) => {
      const { id, ...rest } = vars;
      return apiFetch(`/api/admin/accounts/${id}`, { method: 'PATCH', json: rest });
    },
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
  const unlockMut = useMutation({
    mutationFn: ({ accountId, model }: { accountId: string; model: string }) =>
      apiFetch(`/api/admin/accounts/${accountId}/locks/${encodeURIComponent(model)}`, { method: 'DELETE' }),
    onSuccess: () => {
      refetchLocks();
      qc.invalidateQueries({ queryKey: ['accounts'] });
      toast.success('Model unlocked');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function handleDelete(id: string, label: string) {
    const ok = await confirmDialog({
      title: 'Delete account',
      message: `Delete "${label}"? Cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) deleteMut.mutate(id);
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
            class="input"
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
            class="input" style={{ minHeight: 100, fontFamily: 'var(--font-mono, monospace)' }}
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
        ) : (
          <>
            <Card
              title="MiniMax"
              actions={
                <Button size="sm" onClick={() => { setProvider('minimax'); setOpen(true); }}>
                  + Add
                </Button>
              }
            >
              <div style={{ marginBottom: 12 }}>
                <SelectionControls provider="minimax" />
              </div>
              <AccountsTable
                accounts={minimaxAccounts}
                transports={transports}
                onUsage={setUsageAccount}
                onEdit={(a, editForm) => { setEditing(a); setEditForm(editForm); }}
                onLoadTransportState={loadTransportState}
                onToggle={(id, enabled) => { toggleMut.mutate({ id, enabled }); }}
                onDelete={handleDelete}
              />
            </Card>
            <Card
              title="Kiro"
              actions={
                <Button size="sm" onClick={() => { setProvider('kiro'); setOpen(true); }}>
                  + Add
                </Button>
              }
            >
              <div style={{ marginBottom: 12 }}>
                <SelectionControls provider="kiro" />
              </div>
              <AccountsTable
                accounts={kiroAccounts}
                transports={transports}
                onUsage={setUsageAccount}
                onEdit={(a, editForm) => { setEditing(a); setEditForm(editForm); }}
                onLoadTransportState={loadTransportState}
                onToggle={(id, enabled) => { toggleMut.mutate({ id, enabled }); }}
                onDelete={handleDelete}
              />
            </Card>
          </>
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
          {provider === 'minimax' ? (
            <>
              <label>
                Label{' '}
                <input value={form.label} onInput={(e) => setForm({ ...form, label: (e.target as HTMLInputElement).value })} class="input" aria-required="true" />
              </label>
              <label>
                Credit type
                <select value={form.credit_type} onChange={(e) => setForm({ ...form, credit_type: (e.target as HTMLSelectElement).value })} class="input">
                  <option value="payg">PAYG</option>
                  <option value="token-plan">Token Plan</option>
                </select>
              </label>
              <label>
                MiniMax API key{' '}
                <input value={form.api_key} onInput={(e) => setForm({ ...form, api_key: (e.target as HTMLInputElement).value })} placeholder="mm_xxxxxxxx" class="input" aria-required="true" />
              </label>
            </>
          ) : (
            <>
              {/* Kiro method selector */}
              <label>
                Auth method
                <select
                  value={kiroMethod}
                  onChange={(e) => { setKiroMethod((e.target as HTMLSelectElement).value as 'builder-id' | 'idc' | 'token' | 'auto-import'); autoImport.reset(); deviceFlow.reset(); }}
                  class="input"
                >
                  <option value="builder-id">AWS Builder ID (OAuth)</option>
                  <option value="idc">AWS IAM Identity Center (OAuth)</option>
                  <option value="auto-import">Auto-import from Kiro IDE</option>
                  <option value="token">Paste token manually</option>
                </select>
              </label>


              {/* Render method-specific UI */}
              {(kiroMethod === 'builder-id' || kiroMethod === 'idc') && (
                <KiroDeviceFlowForm
                  deviceStep={deviceFlow.deviceStep}
                  deviceData={deviceFlow.deviceData}
                  deviceError={deviceFlow.deviceError}
                  kiroMethod={kiroMethod}
                  kiroLabel={kiroForm.label}
                  kiroStartUrl={kiroForm.startUrl}
                  kiroRegion={kiroForm.region}
                  onLabelChange={(label) => setKiroForm({ ...kiroForm, label })}
                  onStartUrlChange={(startUrl) => setKiroForm({ ...kiroForm, startUrl })}
                  onRegionChange={(region) => setKiroForm({ ...kiroForm, region })}
                  onStartDeviceCode={deviceFlow.startDeviceCode}
                  onStartPolling={deviceFlow.startPolling}
                />
              )}
              {kiroMethod === 'auto-import' && (
                <KiroAutoImportForm
                  status={autoImport.status}
                  token={autoImport.token}
                  source={autoImport.source}
                  error={autoImport.error}
                  label={kiroForm.label}
                  onLabelChange={(label) => setKiroForm({ ...kiroForm, label })}
                  isPending={autoImport.isPending}
                  onAutoImport={autoImport.doAutoImport}
                  onSave={() => autoImport.saveAutoImport.mutate()}
                />
              )}
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
            onClick={() => {
              if (!editing) return;
              const payload: Parameters<typeof editMut.mutate>[0] = { id: editing.id };
              if (editForm.label) payload.label = editForm.label;
              if (editForm.api_key) payload.api_key = editForm.api_key;
              if (editing.provider === 'kiro' && editForm.persona !== editing.persona) {
                payload.persona = editForm.persona;
              }
              // Transport assignment — send the active mode's fields, clearing others.
              if (tpState.mode === 'none') {
                payload.relayId = '';
                payload.proxyId = '';
                payload.proxyPool = [];
              } else if (tpState.mode === 'relay') {
                payload.relayId = tpState.relayId;
                payload.proxyId = '';
                payload.proxyPool = [];
              } else if (tpState.mode === 'proxy') {
                payload.relayId = '';
                payload.proxyId = tpState.proxyId;
                payload.proxyPool = [];
              } else if (tpState.mode === 'pool') {
                payload.relayId = '';
                payload.proxyId = '';
                payload.proxyPool = tpState.pool;
                payload.proxyRotateEvery = tpState.rotate;
              }
              editMut.mutate(payload);
            }}
            disabled={
              editMut.isPending ||
              (tpState.mode === 'relay' && !tpState.relayId) ||
              (tpState.mode === 'proxy' && !tpState.proxyId) ||
              (tpState.mode === 'pool' && tpState.pool.length === 0)
            }
          >
            {editMut.isPending ? 'Saving…' : 'Save'}
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            Label
            <input value={editForm.label} onInput={(e) => setEditForm({ ...editForm, label: (e.target as HTMLInputElement).value })} class="input" />
          </label>
          <label>
            New API key (leave empty to keep current)
            <input value={editForm.api_key} onInput={(e) => setEditForm({ ...editForm, api_key: (e.target as HTMLInputElement).value })} placeholder="mm_xxxxxxxx" class="input" />
          </label>
          {editing?.provider === 'kiro' && (
            <label>
              Persona (upstream identity)
              <select
                value={editForm.persona}
                onChange={(e) => setEditForm({ ...editForm, persona: (e.target as HTMLSelectElement).value })}
                class="input"
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

          {/* --- Transport (proxy / relay) assignment --- */}
          <TransportAssignment tpState={tpState} setTpState={setTpState} proxies={proxies} relays={relays} />

          {/* --- Model Locks --- */}
          {locks.length > 0 && (
            <div style={{ borderTop: '1px solid var(--ink-3)', paddingTop: 12, marginTop: 4 }}>
              <span style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 500 }}>🔒 Locked models</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {locks.map((l) => (
                  <div key={l.model} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--ink-2)', borderRadius: 6, padding: '6px 10px' }}>
                    <div>
                      <span class="mono" style={{ fontSize: 12 }}>{l.model}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 8 }}>
                        until {relativeTime(l.locked_until)}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => unlockMut.mutate({ accountId: editing!.id, model: l.model })}
                      disabled={unlockMut.isPending}
                    >
                      Unlock
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Kiro Usage Modal */}
      <Modal
        open={!!usageAccount}
        onClose={() => setUsageAccount(null)}
        title="Kiro Account Usage"
        width={480}
      >
        {usageLoading ? (
          <p style={{ color: 'var(--text-3)', textAlign: 'center', padding: 16 }}>Fetching usage from AWS…</p>
        ) : usageError ? (
          <p style={{ color: 'var(--alert)', padding: 16 }}>{(usageErr as Error)?.message ?? 'Failed to fetch usage'}</p>
        ) : usageData ? (
          <pre style={{ fontSize: 11, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 400, overflow: 'auto', padding: 12, background: 'var(--surface-2, rgba(255,255,255,0.02))', borderRadius: 6 }}>
            {JSON.stringify(usageData, null, 2)}
          </pre>
        ) : null}
      </Modal>
    </>
  );
}
