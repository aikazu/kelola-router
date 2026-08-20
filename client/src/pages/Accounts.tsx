import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import {
  AddAccountModal,
  type KiroForm,
  type KiroMethod,
  type MinimaxForm,
  type PioneerForm,
} from '../components/accounts/AddAccountModal';
import { EditAccountModal, type EditForm } from '../components/accounts/EditAccountModal';
import { KiroUsageModal } from '../components/accounts/KiroUsageModal';
import { ProviderAccountSection } from '../components/accounts/ProviderAccountSection';
import { confirmDialog } from '../components/Confirm';
import { ErrorState } from '../components/ErrorState';
import { TableSkeleton } from '../components/Skeleton';
import { useToast } from '../components/ToastProvider';
import { useKiroAutoImport } from '../hooks/useKiroAutoImport';
import { useKiroDeviceFlow } from '../hooks/useKiroDeviceFlow';
import { TopBar } from '../layout/TopBar';
import { apiFetch } from '../lib/api';
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
  const kiroAccounts = accounts.filter((a) => a.provider === 'kiro');
  const pioneerAccounts = accounts.filter((a) => a.provider === 'pioneer');
  const notionAccounts = accounts.filter((a) => a.provider === 'notion');
  const zaiAccounts = accounts.filter((a) => a.provider === 'zai');
  const tabiAccounts = accounts.filter((a) => a.provider === 'tabi');
  const qwencloudAccounts = accounts.filter((a) => a.provider === 'qwencloud');
  const minimaxAccounts = accounts.filter((a) => {
    const p = a.provider ?? 'minimax';
    return (
      p !== 'kiro' &&
      p !== 'pioneer' &&
      p !== 'notion' &&
      p !== 'zai' &&
      p !== 'tabi' &&
      p !== 'qwencloud'
    );
  });

  // Add-account modal state.
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<
    'minimax' | 'kiro' | 'pioneer' | 'notion' | 'zai' | 'tabi' | 'qwencloud'
  >('minimax');
  const [form, setForm] = useState<MinimaxForm>({ label: '', credit_type: 'payg', api_key: '' });
  const [kiroMethod, setKiroMethod] = useState<KiroMethod>('builder-id');
  const [pioneerForm, setPioneerForm] = useState<PioneerForm>({ label: '', api_key: '' });
  const [zaiForm, setZaiForm] = useState<{ label: string; api_key: string; base_url: string }>({
    label: '',
    api_key: '',
    base_url: '',
  });
  const [tabiForm, setTabiForm] = useState<{ label: string; api_key: string; base_url: string }>({
    label: '',
    api_key: '',
    base_url: '',
  });
  const [qwencloudForm, setQwencloudForm] = useState<{
    label: string;
    api_key: string;
    base_url: string;
  }>({
    label: '',
    api_key: '',
    base_url: '',
  });
  const [notionForm, setNotionForm] = useState<{ email: string; label: string }>({
    email: '',
    label: '',
  });
  const [kiroForm, setKiroForm] = useState<KiroForm>({
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
    onSuccess: () => {
      setOpen(false);
      resetForms();
    },
  });

  // Device code flow hook
  const deviceFlow = useKiroDeviceFlow({
    kiroMethod,
    region: kiroForm.region,
    startUrl: kiroForm.startUrl,
    label: kiroForm.label,
    onSuccess: () => {
      setOpen(false);
      resetForms();
    },
  });

  // Kiro usage modal
  const [usageAccount, setUsageAccount] = useState<string | null>(null);
  const {
    data: usageData,
    isLoading: usageLoading,
    isError: usageError,
    error: usageErr,
  } = useQuery({
    queryKey: ['account-usage', usageAccount],
    queryFn: () => apiFetch<Record<string, unknown>>(`/api/admin/accounts/${usageAccount}/usage`),
    enabled: !!usageAccount,
  });

  // Edit modal state.
  const [editing, setEditing] = useState<Account | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ label: '', api_key: '', persona: 'ide' });

  // Transport assignment state for the edit modal.
  const { data: transports = [] } = useQuery({
    queryKey: ['transports'],
    queryFn: () => apiFetch<Transport[]>('/api/admin/transports'),
  });
  // Model locks for the currently-editing account.
  const { data: locksData, refetch: refetchLocks } = useQuery({
    queryKey: ['account-locks', editing?.id],
    queryFn: () => apiFetch<{ locks: ModelLock[] }>(`/api/admin/accounts/${editing?.id}/locks`),
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
      setTpState({
        mode: 'pool',
        proxyId: '',
        relayId: '',
        pool: a.proxyPool,
        rotate: a.proxyRotateEvery ?? 1,
      });
    } else if (a.proxyId) {
      setTpState({ mode: 'proxy', proxyId: a.proxyId, relayId: '', pool: [], rotate: 1 });
    } else {
      setTpState({ mode: 'none', proxyId: '', relayId: '', pool: [], rotate: 1 });
    }
  }

  function resetForms() {
    setProvider('minimax');
    setForm({ label: '', credit_type: 'payg', api_key: '' });
    setPioneerForm({ label: '', api_key: '' });
    setZaiForm({ label: '', api_key: '', base_url: '' });
    setTabiForm({ label: '', api_key: '', base_url: '' });
    setQwencloudForm({ label: '', api_key: '', base_url: '' });
    setKiroMethod('builder-id');
    setKiroForm({ label: '', credentialJson: '', refreshToken: '', region: '', startUrl: '' });
    autoImport.reset();
    deviceFlow.reset();
  }

  // Manual token/JSON + minimax save
  const createMut = useMutation({
    mutationFn: () =>
      provider === 'kiro'
        ? apiFetch<{ modelsSeeded?: number }>('/api/admin/accounts/kiro', {
            method: 'POST',
            json: {
              label: kiroForm.label,
              method: 'token',
              credentialJson: kiroForm.credentialJson,
              refreshToken: kiroForm.refreshToken,
            },
          })
        : provider === 'pioneer'
          ? apiFetch<{ modelsSeeded?: number }>('/api/admin/accounts', {
              method: 'POST',
              json: {
                label: pioneerForm.label,
                credit_type: 'payg',
                api_key: pioneerForm.api_key,
                provider: 'pioneer',
              },
            })
          : provider === 'zai'
            ? apiFetch<{ modelsSeeded?: number }>('/api/admin/accounts', {
                method: 'POST',
                json: {
                  label: zaiForm.label,
                  credit_type: 'payg',
                  api_key: zaiForm.api_key,
                  provider: 'zai',
                  ...(zaiForm.base_url ? { base_url: zaiForm.base_url } : {}),
                },
              })
            : provider === 'tabi'
              ? apiFetch<{ modelsSeeded?: number }>('/api/admin/accounts', {
                  method: 'POST',
                  json: {
                    label: tabiForm.label,
                    credit_type: 'payg',
                    api_key: tabiForm.api_key,
                    provider: 'tabi',
                    ...(tabiForm.base_url ? { base_url: tabiForm.base_url } : {}),
                  },
                })
              : provider === 'qwencloud'
                ? apiFetch<{ modelsSeeded?: number }>('/api/admin/accounts', {
                    method: 'POST',
                    json: {
                      label: qwencloudForm.label,
                      api_key: qwencloudForm.api_key,
                      provider: 'qwencloud',
                      ...(qwencloudForm.base_url ? { base_url: qwencloudForm.base_url } : {}),
                    },
                  })
                : apiFetch<{ modelsSeeded?: number }>('/api/admin/accounts', {
                    method: 'POST',
                    json: form,
                  }),
    onSuccess: (res) => {
      setOpen(false);
      resetForms();
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['models'] });
      const seeded = res?.modelsSeeded;
      toast.success(
        typeof seeded === 'number'
          ? `Account added — ${seeded} model${seeded === 1 ? '' : 's'} imported`
          : 'Account added'
      );
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
      apiFetch(`/api/admin/accounts/${accountId}/locks/${encodeURIComponent(model)}`, {
        method: 'DELETE',
      }),
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

  return (
    <>
      <TopBar
        title={
          <>
            Up<em>stream</em>
          </>
        }
        eyebrow="Upstream key pool"
        actions={
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            onClick={() => {
              setProvider('minimax');
              setOpen(true);
            }}
          >
            + Add account
          </button>
        }
      />
      <div class="surface module--active">
        <div class="card-head" style={{ justifyContent: 'space-between' }}>
          <div class="card-head-text">
            <span class="card-eyebrow">Upstream</span>
            <h2 class="card-title">Key pool</h2>
            <p class="card-sub" style={{ marginBottom: 0, marginTop: 4 }}>
              MiniMax uses API keys. Kiro (AWS) supports OAuth, auto-import from Kiro IDE, or manual
              token paste. Pioneer is an OpenAI-compatible upstream using X-API-Key authentication.
              The router fans out across enabled accounts with exponential backoff.
            </p>
          </div>
        </div>
        {isError ? (
          <ErrorState error={error as Error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <TableSkeleton rows={3} cols={6} />
        ) : (
          <>
            <ProviderAccountSection
              title="MiniMax"
              provider="minimax"
              accounts={minimaxAccounts}
              transports={transports}
              onAdd={() => {
                setProvider('minimax');
                setOpen(true);
              }}
              onUsage={setUsageAccount}
              onEdit={(a, editFormInitialState) => {
                setEditing(a);
                setEditForm(editFormInitialState);
              }}
              onLoadTransportState={loadTransportState}
              onToggle={(id, enabled) => {
                toggleMut.mutate({ id, enabled });
              }}
              onDelete={handleDelete}
            />
            <ProviderAccountSection
              title="Kiro"
              provider="kiro"
              accounts={kiroAccounts}
              transports={transports}
              onAdd={() => {
                setProvider('kiro');
                setOpen(true);
              }}
              onUsage={setUsageAccount}
              onEdit={(a, editFormInitialState) => {
                setEditing(a);
                setEditForm(editFormInitialState);
              }}
              onLoadTransportState={loadTransportState}
              onToggle={(id, enabled) => {
                toggleMut.mutate({ id, enabled });
              }}
              onDelete={handleDelete}
            />
            <ProviderAccountSection
              title="Pioneer"
              provider="pioneer"
              accounts={pioneerAccounts}
              transports={transports}
              onAdd={() => {
                setProvider('pioneer');
                setOpen(true);
              }}
              onUsage={setUsageAccount}
              onEdit={(a, editFormInitialState) => {
                setEditing(a);
                setEditForm(editFormInitialState);
              }}
              onLoadTransportState={loadTransportState}
              onToggle={(id, enabled) => {
                toggleMut.mutate({ id, enabled });
              }}
              onDelete={handleDelete}
            />
            <ProviderAccountSection
              title="Notion"
              provider="notion"
              accounts={notionAccounts}
              transports={transports}
              onAdd={() => {
                setProvider('notion');
                setOpen(true);
              }}
              onUsage={setUsageAccount}
              onEdit={(a, editFormInitialState) => {
                setEditing(a);
                setEditForm(editFormInitialState);
              }}
              onLoadTransportState={loadTransportState}
              onToggle={(id, enabled) => {
                toggleMut.mutate({ id, enabled });
              }}
              onDelete={handleDelete}
            />
            <ProviderAccountSection
              title="Z.AI"
              provider="zai"
              accounts={zaiAccounts}
              transports={transports}
              onAdd={() => {
                setProvider('zai');
                setOpen(true);
              }}
              onUsage={setUsageAccount}
              onEdit={(a, editFormInitialState) => {
                setEditing(a);
                setEditForm(editFormInitialState);
              }}
              onLoadTransportState={loadTransportState}
              onToggle={(id, enabled) => {
                toggleMut.mutate({ id, enabled });
              }}
              onDelete={handleDelete}
            />
            <ProviderAccountSection
              title="TabiToken"
              provider="tabi"
              accounts={tabiAccounts}
              transports={transports}
              onAdd={() => {
                setProvider('tabi');
                setOpen(true);
              }}
              onUsage={setUsageAccount}
              onEdit={(a, editFormInitialState) => {
                setEditing(a);
                setEditForm(editFormInitialState);
              }}
              onLoadTransportState={loadTransportState}
              onToggle={(id, enabled) => {
                toggleMut.mutate({ id, enabled });
              }}
              onDelete={handleDelete}
            />
            <ProviderAccountSection
              title="QwenCloud"
              provider="qwencloud"
              accounts={qwencloudAccounts}
              transports={transports}
              onAdd={() => {
                setProvider('qwencloud');
                setOpen(true);
              }}
              onUsage={setUsageAccount}
              onEdit={(a, editFormInitialState) => {
                setEditing(a);
                setEditForm(editFormInitialState);
              }}
              onLoadTransportState={loadTransportState}
              onToggle={(id, enabled) => {
                toggleMut.mutate({ id, enabled });
              }}
              onDelete={handleDelete}
            />
          </>
        )}
      </div>

      <AddAccountModal
        open={open}
        onClose={() => {
          setOpen(false);
          resetForms();
        }}
        provider={provider}
        form={form}
        onFormChange={setForm}
        kiroMethod={kiroMethod}
        onKiroMethodChange={setKiroMethod}
        notionForm={notionForm}
        onNotionFormChange={setNotionForm}
        notionSuccess={() => {
          setOpen(false);
          resetForms();
          refetch();
        }}
        kiroForm={kiroForm}
        onKiroFormChange={setKiroForm}
        pioneerForm={pioneerForm}
        onPioneerFormChange={setPioneerForm}
        zaiForm={zaiForm}
        onZaiFormChange={setZaiForm}
        tabiForm={tabiForm}
        onTabiFormChange={setTabiForm}
        qwencloudForm={qwencloudForm}
        onQwencloudFormChange={setQwencloudForm}
        autoImport={autoImport}
        deviceFlow={deviceFlow}
        onCreate={() => createMut.mutate()}
        isCreating={createMut.isPending}
      />

      <EditAccountModal
        open={!!editing}
        onClose={() => setEditing(null)}
        editing={editing}
        editForm={editForm}
        onEditFormChange={setEditForm}
        proxies={proxies}
        relays={relays}
        tpState={tpState}
        onTpStateChange={setTpState}
        locks={locks}
        onSave={(payload) => editMut.mutate(payload)}
        onUnlock={(model) => {
          if (!editing) return;
          unlockMut.mutate({ accountId: editing.id, model });
        }}
        isSaving={editMut.isPending}
        isUnlocking={unlockMut.isPending}
      />

      <KiroUsageModal
        open={!!usageAccount}
        onClose={() => setUsageAccount(null)}
        data={usageData}
        isLoading={usageLoading}
        isError={usageError}
        error={usageErr}
      />
    </>
  );
}
