import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { confirmDialog } from '../components/Confirm';
import { ErrorState } from '../components/ErrorState';
import { Modal } from '../components/Modal';
import { TableSkeleton } from '../components/Skeleton';
import { useToast } from '../components/ToastProvider';
import { TopBar } from '../layout/TopBar';
import { ApiError, apiFetch } from '../lib/api';
import { relativeTime } from '../lib/relativeTime';

interface ClientKey {
  id: number;
  label: string;
  enabled: boolean;
  createdAt: string;
  keyPreview: string;
}

export function ClientKeys() {
  const qc = useQueryClient();
  const toast = useToast();
  const {
    data: keys = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['client-keys'],
    queryFn: () => apiFetch<ClientKey[]>('/api/admin/client-keys'),
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [created, setCreated] = useState<{ key: string; label: string } | null>(null);
  const [editingLabel, setEditingLabel] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  // --- Reveal-key flow (Task 16) ---------------------------------------
  // Open mode (`!me.passwordSet`): click "Show" fetches the raw key and
  // swaps the masked preview inline — no modal (per spec).
  // Password mode: click "Show" opens a modal with a password input. On
  // submit we POST /api/admin/reauth/verify (sets the kelola_reauth cookie
  // automatically via credentials:'include'), then immediately GET /:id/key.
  // On 401 we keep the modal open with an inline error so the user can retry.
  const me = qc.getQueryData<{ authed: boolean; passwordSet: boolean }>(['me']);
  const passwordMode = !!me?.passwordSet;
  // Open-mode inline reveal: which rows are currently un-masked + the fetched key per row.
  const [inlineRevealed, setInlineRevealed] = useState<Record<number, string>>({});
  // Password-mode modal state. `revealFor` is non-null while the modal is open.
  const [revealFor, setRevealFor] = useState<{ id: number; label: string } | null>(null);
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const [revealError, setRevealError] = useState('');
  const [revealLoading, setRevealLoading] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const passwordRef = useRef<HTMLInputElement>(null);

  // Focus the password input as soon as the modal body mounts. Skipped when
  // the modal is showing the revealed key (no input to focus).
  useEffect(() => {
    if (revealFor && !revealKey) passwordRef.current?.focus();
  }, [revealFor, revealKey]);

  // Drop all reveal state on modal close. The password field is cleared here,
  // on submit-success, and on submit-failure — per the MUST NOT in the spec
  // (never persist the password in component state longer than the submit cycle).
  function closeReveal() {
    setRevealFor(null);
    setRevealKey(null);
    setRevealError('');
    setPasswordInput('');
    setRevealLoading(false);
  }

  async function handleShow(k: ClientKey) {
    if (!passwordMode) {
      // Open mode: fetch + inline reveal, no modal.
      try {
        const { key } = await apiFetch<{ key: string }>(`/api/admin/client-keys/${k.id}/key`);
        setInlineRevealed((prev) => ({ ...prev, [k.id]: key }));
      } catch (e) {
        toast.error((e as Error).message);
      }
      return;
    }
    // Password mode: open the reauth modal.
    setRevealFor({ id: k.id, label: k.label });
    setRevealKey(null);
    setRevealError('');
    setPasswordInput('');
  }

  function hideInline(id: number) {
    setInlineRevealed((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function handleSubmitPassword() {
    if (!revealFor || !passwordInput) return;
    // Snapshot + clear password immediately — never retained beyond submit.
    const pwd = passwordInput;
    setPasswordInput('');
    setRevealLoading(true);
    setRevealError('');
    try {
      await apiFetch('/api/admin/reauth/verify', {
        method: 'POST',
        json: { password: pwd },
      });
      const { key } = await apiFetch<{ key: string }>(`/api/admin/client-keys/${revealFor.id}/key`);
      setRevealKey(key);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setRevealError('Wrong password — try again.');
      } else {
        setRevealError((e as Error).message || 'Failed to reveal key.');
      }
    } finally {
      setRevealLoading(false);
    }
  }

  const createMut = useMutation({
    mutationFn: (l: string) =>
      apiFetch<{ key: string; label: string }>('/api/admin/client-keys', {
        method: 'POST',
        json: { label: l },
      }),
    onSuccess: (res) => {
      setCreated(res);
      setLabel('');
      qc.invalidateQueries({ queryKey: ['client-keys'] });
      toast.success('Key created');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const labelMut = useMutation({
    mutationFn: ({ id, label }: { id: number; label: string }) =>
      apiFetch(`/api/admin/client-keys/${id}`, { method: 'PATCH', json: { label } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-keys'] });
      setEditingLabel(null);
      toast.success('Label updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiFetch(`/api/admin/client-keys/${id}/${enabled ? 'disable' : 'enable'}`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-keys'] });
      toast.success('Updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/admin/client-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-keys'] });
      toast.success('Deleted');
    },
  });

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Clipboard blocked');
    }
  }

  async function copyKey(id: number) {
    try {
      const { key } = await apiFetch<{ key: string }>(`/api/admin/client-keys/${id}/key`);
      await copy(key);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleDelete(id: number, label: string) {
    const ok = await confirmDialog({
      title: 'Delete client key',
      message: `Delete "${label}"? Clients using this key will lose access.`,
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
            Client <em>keys</em>
          </>
        }
        eyebrow="Bearer credentials"
        actions={<Button onClick={() => setCreateOpen(true)}>+ Create key</Button>}
      />
      <p class="card-sub">
        Bearer credentials for clients. Each key gets its own usage tracking on /admin/usage.
      </p>
      <Card>
        {isError ? (
          <ErrorState error={error as Error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <TableSkeleton rows={3} cols={6} />
        ) : keys.length === 0 ? (
          <div class="empty">
            <h3>No client keys yet</h3>
            <p>Create one to give an app access to the proxy.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table class="tbl">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Bearer key</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td
                      onDblClick={() => {
                        setEditingLabel(k.id);
                        setEditValue(k.label);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setEditingLabel(k.id);
                          setEditValue(k.label);
                        }
                      }}
                    >
                      {editingLabel === k.id ? (
                        <input
                          value={editValue}
                          onInput={(e) => setEditValue((e.target as HTMLInputElement).value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && editValue.trim())
                              labelMut.mutate({ id: k.id, label: editValue.trim() });
                            if (e.key === 'Escape') setEditingLabel(null);
                          }}
                          onBlur={() => setEditingLabel(null)}
                          class="input"
                          style={{ padding: '2px 6px', fontSize: 13, width: '100%' }}
                          aria-label="Edit label"
                        />
                      ) : (
                        // biome-ignore lint/a11y/useSemanticElements: span as inline label-as-button
                        <span
                          style={{ cursor: 'text' }}
                          title="Double-click to edit"
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setEditingLabel(k.id);
                              setEditValue(k.label);
                            }
                          }}
                        >
                          {k.label}
                        </span>
                      )}
                    </td>
                    <td class="mono">
                      {inlineRevealed[k.id] ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <code
                            style={{ wordBreak: 'break-all' }}
                            data-testid={`reveal-inline-${k.id}`}
                          >
                            {inlineRevealed[k.id]}
                          </code>
                          <Button size="sm" variant="ghost" onClick={() => hideInline(k.id)}>
                            Hide
                          </Button>
                        </div>
                      ) : (
                        <code>{k.keyPreview}</code>
                      )}
                    </td>
                    <td>
                      <Badge variant={k.enabled ? 'active' : 'muted'}>
                        {k.enabled ? 'active' : 'disabled'}
                      </Badge>
                    </td>
                    <td title={k.createdAt}>{relativeTime(k.createdAt)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, whiteSpace: 'nowrap' }}>
                        {inlineRevealed[k.id] ? (
                          <Button size="sm" variant="ghost" onClick={() => hideInline(k.id)}>
                            Hide
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => handleShow(k)}>
                            Show
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => copyKey(k.id)}>
                          Copy
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleMut.mutate({ id: k.id, enabled: k.enabled })}
                        >
                          {k.enabled ? 'Disable' : 'Enable'}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleDelete(k.id, k.label)}
                        >
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
      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setCreated(null);
        }}
        title={created ? 'Key created' : 'Create client key'}
        footer={
          created ? (
            <Button onClick={() => copy(created.key)}>Copy key</Button>
          ) : (
            <Button
              onClick={() => createMut.mutate(label)}
              disabled={!label || createMut.isPending}
            >
              {createMut.isPending ? 'Generating…' : 'Generate'}
            </Button>
          )
        }
      >
        {created ? (
          <>
            <p style={{ marginBottom: 12 }}>
              This is the only time the full key will be shown. Copy it now.
            </p>
            <pre
              style={{
                background: 'var(--ink-2)',
                padding: 12,
                borderRadius: 4,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                wordBreak: 'break-all',
              }}
            >
              {created.key}
            </pre>
          </>
        ) : (
          <label style={{ display: 'block' }}>
            Label{' '}
            <input
              value={label}
              onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
              placeholder="e.g. my-app…"
              class="input"
              aria-required="true"
              aria-invalid={label.length === 0}
            />
            {label.length === 0 && (
              <span
                style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 4, display: 'block' }}
              >
                Required — give this key a descriptive name.
              </span>
            )}
          </label>
        )}
      </Modal>

      {/* Reveal-key modal — password mode only. Open mode reveals inline. */}
      <Modal
        open={!!revealFor}
        onClose={closeReveal}
        title={revealKey ? `Key: ${revealFor?.label ?? ''}` : 'Reveal key'}
        footer={
          revealKey ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (revealKey) void copy(revealKey);
                }}
              >
                Copy key
              </Button>
              <Button size="sm" onClick={closeReveal}>
                Close
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={handleSubmitPassword}
              disabled={revealLoading || !passwordInput}
            >
              {revealLoading ? 'Verifying…' : 'Reveal'}
            </Button>
          )
        }
      >
        {revealKey ? (
          <>
            <p style={{ marginBottom: 12, color: 'var(--text-3)', fontSize: 12 }}>
              Copy it now — the key will be hidden when you close this dialog.
            </p>
            <pre
              data-testid="reveal-key-pre"
              style={{
                background: 'var(--ink-2)',
                padding: 12,
                borderRadius: 4,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                wordBreak: 'break-all',
              }}
            >
              {revealKey}
            </pre>
          </>
        ) : (
          <>
            <p style={{ marginBottom: 12, color: 'var(--text-3)', fontSize: 12 }}>
              Enter the dashboard password to reveal <strong>{revealFor?.label}</strong>.
            </p>
            <input
              ref={passwordRef}
              type="password"
              autoComplete="off"
              value={passwordInput}
              onInput={(e) => setPasswordInput((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && passwordInput && !revealLoading) {
                  void handleSubmitPassword();
                }
              }}
              class="input"
              aria-label="Dashboard password"
              style={{ width: '100%' }}
            />
            {revealError && (
              <div role="alert" style={{ color: 'var(--alert)', fontSize: 12, marginTop: 8 }}>
                {revealError}
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
