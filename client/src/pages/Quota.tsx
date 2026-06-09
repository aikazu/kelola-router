import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'preact/hooks';
import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { ErrorState } from '../components/ErrorState';
import { TableSkeleton } from '../components/Skeleton';
import { TopBar } from '../layout/TopBar';
import { apiFetch } from '../lib/api';
import { forwardDuration, relativeTime } from '../lib/relativeTime';

interface QuotaWindow {
  modelName: string;
  windowType: string;
  usedCount: number;
  totalCount: number;
  remainingCount: number;
  remainingPercent: number | null;
  remainsTime: number | null;
  windowEnd: string | null;
  fetchedAt: string;
}
interface AccountQuota {
  accountId: string;
  label: string;
  creditType: string;
  enabled: boolean;
  windows: QuotaWindow[];
}

const WINDOW_LABEL: Record<string, string> = { '5h': '5h', weekly: 'wk', monthly: 'mo' };
const WINDOW_ORDER = ['5h', 'weekly', 'monthly'];

// Percent the bar should show: prefer upstream remaining_percent; else derive from counts.
function pctOf(w: QuotaWindow): number {
  if (w.remainingPercent != null) return Math.max(0, Math.min(100, w.remainingPercent));
  if (w.totalCount > 0) return Math.round((w.remainingCount / w.totalCount) * 100);
  return 0;
}

function BarRow({ w }: { w: QuotaWindow }) {
  const pct = pctOf(w);
  const warn = pct < 20;
  return (
    <div class="quota-bar-row">
      <span class="quota-win-label">{WINDOW_LABEL[w.windowType] ?? w.windowType}</span>
      <div class="quota-bar-track">
        <div class={`quota-bar-fill${warn ? ' warn' : ''}`} style={{ width: `${pct}%` }} />
      </div>
      <div class="quota-meta">
        <span class={`quota-pct${warn ? ' warn' : ''}`}>{pct}%</span>
        {w.totalCount > 0 && (
          <span class="quota-count">
            {w.usedCount.toLocaleString()} / {w.totalCount.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}

function ModelBlock({ windows, delay }: { windows: QuotaWindow[]; delay: number }) {
  const ordered = [...windows].sort(
    (a, b) => WINDOW_ORDER.indexOf(a.windowType) - WINDOW_ORDER.indexOf(b.windowType)
  );
  const head = ordered[0];
  const fiveH = ordered.find((w) => w.windowType === '5h');
  const reset = fiveH?.remainsTime ?? null;
  return (
    <div class="quota-model" style={{ animationDelay: `${delay}ms` }}>
      <div class="quota-model-head">
        <span class="status-dot active" />
        <span class="quota-model-name">{head.modelName}</span>
        {reset != null && (
          <span class="reset-chip" style={{ marginLeft: 'auto' }}>
            resets in {forwardDuration(reset)}
          </span>
        )}
      </div>
      {ordered.map((w) => (
        <BarRow key={w.windowType} w={w} />
      ))}
    </div>
  );
}

export function Quota() {
  const {
    data: quotas = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['quota'],
    queryFn: () => apiFetch<AccountQuota[]>('/api/admin/quota'),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  if (isError)
    return (
      <>
        <TopBar title="Quota" />
        <ErrorState error={error as Error} onRetry={() => refetch()} />
      </>
    );

  return (
    <>
      <TopBar
        title={
          <>
            Quo<em>ta</em>
          </>
        }
        eyebrow="Balance / limits"
        actions={
          <button class="btn btn-ghost btn-sm" onClick={() => refetch()} aria-label="Refresh quota">
            ↻ Refresh
          </button>
        }
      />
      {isLoading ? (
        <Card>
          <TableSkeleton rows={3} cols={3} />
        </Card>
      ) : quotas.length === 0 ? (
        <div class="empty">
          <h3>No quota data</h3>
          <p>Add an upstream account to see quota windows.</p>
        </div>
      ) : (
        quotas.map((q) => {
          // Group this account's windows by model. useMemo on the
          // pre-bucketed array keeps each quota card cheap on refetch.
          const grouped = useMemo(() => {
            const byModel = new Map<string, QuotaWindow[]>();
            for (const w of q.windows) {
              const list = byModel.get(w.modelName) ?? [];
              list.push(w);
              byModel.set(w.modelName, list);
            }
            return [...byModel.entries()];
          }, [q.windows]);
          const lastFetched = useMemo(
            () =>
              q.windows.length > 0
                ? q.windows.reduce((a, b) => (a.fetchedAt > b.fetchedAt ? a : b)).fetchedAt
                : null,
            [q.windows]
          );
          const models = grouped;
          return (
            <Card
              key={q.accountId}
              title={q.label}
              actions={
                <Badge variant={q.creditType === 'token-plan' ? 'warn' : 'active'}>
                  {q.creditType}
                </Badge>
              }
            >
              {!q.enabled && (
                <p class="card-sub" style={{ color: 'var(--warning)' }}>
                  Account disabled
                </p>
              )}
              {models.length === 0 ? (
                <p class="card-sub">No quota data yet — puller refreshes every 5 min.</p>
              ) : (
                models.map(([model, windows], i) => (
                  <ModelBlock key={model} windows={windows} delay={i * 70} />
                ))
              )}
              <p style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 14 }}>
                Last fetched {relativeTime(lastFetched)}
              </p>
            </Card>
          );
        })
      )}
    </>
  );
}
