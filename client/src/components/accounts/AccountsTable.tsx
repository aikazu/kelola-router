import { relativeTime } from '../../lib/relativeTime';
import type { Account, Transport } from '../../lib/types';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { confirmDialog } from '../Confirm';

function statusVariant(s: string, e: boolean) {
  if (!e) return 'muted';
  if (s === 'active') return 'active';
  if (s === 'error') return 'error';
  if (s === 'rate_limited') return 'warn';
  return 'muted';
}

interface AccountsTableProps {
  accounts: Account[];
  transports: Transport[];
  onUsage: (accountId: string) => void;
  onEdit: (account: Account, editForm: { label: string; api_key: string; persona: string }) => void;
  onLoadTransportState: (account: Account) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string, label: string) => void;
}

export function AccountsTable({
  accounts,
  transports,
  onUsage,
  onEdit,
  onLoadTransportState,
  onToggle,
  onDelete,
}: AccountsTableProps) {
  if (accounts.length === 0) {
    return <p class="card-sub">No accounts for this provider yet.</p>;
  }

  return (
    <section style={{ overflowX: 'auto' }} aria-label="Accounts table">
      <table class="tbl">
        <thead>
          <tr>
            <th>Label</th>
            <th>Provider</th>
            <th>Status</th>
            <th>Backoff</th>
            <th>Transport</th>
            <th>Last error</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id}>
              <td>
                <span style={{ fontWeight: 500 }}>{a.label}</span>
                <span
                  class="mono"
                  style={{ fontSize: 10, color: 'var(--text-3)', display: 'block' }}
                >
                  {a.id}
                </span>
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <Badge variant={a.provider === 'kiro' ? 'active' : 'muted'}>
                  {a.provider === 'kiro'
                    ? `kiro · ${a.authMethod || 'token'}`
                    : (a.provider ?? 'minimax')}
                </Badge>
                {a.provider === 'kiro' && (
                  <Badge variant={a.persona === 'cli' ? 'warn' : 'muted'} style={{ marginLeft: 6 }}>
                    {a.persona === 'cli' ? 'CLI' : 'IDE'}
                  </Badge>
                )}
              </td>
              <td>
                <Badge
                  variant={statusVariant(a.status, a.enabled)}
                  pulse={a.status === 'rate_limited'}
                >
                  {a.enabled ? a.status : 'disabled'}
                </Badge>
                {a.rateLimitedUntil && (
                  <span
                    style={{ fontSize: 10, color: 'var(--text-3)', display: 'block' }}
                    title={a.rateLimitedUntil}
                  >
                    until {relativeTime(a.rateLimitedUntil)}
                  </span>
                )}
                {(a.lockedModels ?? 0) > 0 && (
                  <Badge variant="warn" style={{ marginLeft: 4 }}>
                    🔒 {a.lockedModels}
                  </Badge>
                )}
              </td>
              <td class="mono">{a.backoffLevel || '—'}</td>
              <td>
                {(() => {
                  if (a.relayId) {
                    const relay = transports.find((t) => t.id === a.relayId);
                    return <Badge variant="active">☁ {relay?.label ?? 'relay'}</Badge>;
                  }
                  if (a.proxyPool && a.proxyPool.length > 0) {
                    return <Badge variant="warn">🔀 Pool({a.proxyPool.length})</Badge>;
                  }
                  if (a.proxyId) {
                    const proxy = transports.find((t) => t.id === a.proxyId);
                    return <Badge variant="warn">🔀 {proxy?.label ?? 'proxy'}</Badge>;
                  }
                  return <Badge variant="muted">Direct</Badge>;
                })()}
              </td>
              <td style={{ maxWidth: 220, fontSize: 11, color: 'var(--text-3)' }}>
                <span
                  style={{
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={a.lastError ?? ''}
                >
                  {a.lastError ?? '—'}
                </span>
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {a.provider === 'kiro' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onUsage(a.id)}
                      aria-label="View Kiro usage"
                    >
                      Usage
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const editForm = {
                        label: a.label,
                        api_key: '',
                        persona: a.persona === 'cli' ? 'cli' : 'ide',
                      };
                      onEdit(a, editForm);
                      onLoadTransportState(a);
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
                          message: `Disable "${a.label}"?`,
                          confirmLabel: 'Disable',
                          danger: true,
                        });
                        if (!ok) return;
                      }
                      onToggle(a.id, a.enabled);
                    }}
                  >
                    {a.enabled ? 'Disable' : 'Enable'}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => onDelete(a.id, a.label)}>
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
