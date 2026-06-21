import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'preact/hooks';
import { Badge } from '../components/Badge';
import { ErrorState } from '../components/ErrorState';
import { TableSkeleton } from '../components/Skeleton';
import { TopBar } from '../layout/TopBar';
import { apiFetch } from '../lib/api';
import { relativeTime } from '../lib/relativeTime';
import { RequestDetail } from './RequestDetail';

interface OverviewData {
  stats: {
    totalCost: number;
    totalRequests: number;
    totalTokens: number;
    enabledAccounts: number;
    totalAccounts: number;
    activeClientKeys: number;
  };
  byModel: Array<{ model: string; cost: number; requests: number }>;
  recent: Array<{
    id: number;
    createdAt: string;
    model: string;
    accountLabel: string | null;
    statusCode: number;
    cost: number;
    latencyMs: number;
    clientKeyId: number | null;
    accountId: string | null;
  }>;
}

const rangeLabel = (days: number) =>
  days === 0 ? 'all time' : days === 1 ? 'last 24 hours' : `last ${days} days`;

const TOP_MODELS_MAX = 4;

function formatCost(n: number): string {
  return n.toFixed(n < 1 ? 4 : 2);
}

function statusVariant(code: number): 'active' | 'warn' | 'error' {
  if (code < 300) return 'active';
  if (code < 500) return 'warn';
  return 'error';
}

export function Overview() {
  const [days, setDays] = useState(1);

  // URL sync: read days on mount + react to hashchange (back/forward).
  useEffect(() => {
    const onHash = () => {
      const p = new URLSearchParams(location.hash.split('?')[1] ?? '');
      if (p.get('days') !== null) setDays(Number(p.get('days')));
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // URL sync: write days on change.
  useEffect(() => {
    const newHash = `#/admin/overview?days=${days}`;
    if (location.hash !== newHash) history.replaceState(null, '', newHash);
  }, [days]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['overview', days],
    queryFn: () => apiFetch<OverviewData>(`/api/admin/overview?days=${days}`),
  });
  const [selected, setSelected] = useState<number | null>(null);

  if (isError)
    return (
      <>
        <TopBar title="Overview" />
        <ErrorState error={error as Error} onRetry={() => refetch()} />
      </>
    );

  const loading = isLoading || !data;
  const range = rangeLabel(days);
  const topModels = data ? data.byModel.slice(0, TOP_MODELS_MAX) : [];
  const maxRequests = topModels.reduce((m, x) => (x.requests > m ? x.requests : m), 0);
  const stats = data?.stats;
  const byModel = data?.byModel;
  const recent = data?.recent;
  const poolHealthy = stats ? stats.enabledAccounts > 0 : false;

  return (
    <>
      <TopBar
        title={
          <>
            Over<em>view</em>
          </>
        }
        eyebrow={`Operations / ${range}`}
        actions={
          <select
            aria-label="Select date range"
            value={days}
            onChange={(e) => setDays(Number((e.target as HTMLSelectElement).value))}
          >
            {[1, 7, 30, 90].map((n) => (
              <option key={n} value={n}>
                Last {n} day{n > 1 ? 's' : ''}
              </option>
            ))}
            <option value={0}>All time</option>
          </select>
        }
      />

      <div class="ov-strip">
        <Stat
          loading={loading}
          value={stats ? stats.totalRequests.toLocaleString() : null}
          label={`requests · ${range}`}
        />
        <Stat
          loading={loading}
          value={stats ? `$${formatCost(stats.totalCost)}` : null}
          label="spend"
        />
        <Stat
          loading={loading}
          value={stats ? `${stats.enabledAccounts}/${stats.totalAccounts}` : null}
          label="upstream enabled"
        />
        <Stat
          loading={loading}
          value={stats ? String(stats.activeClientKeys) : null}
          label="client keys"
        />
        <Stat
          loading={loading}
          value={byModel ? String(byModel.length) : null}
          label="models live"
        />
        <Stat
          loading={loading}
          value={stats ? stats.totalTokens.toLocaleString() : null}
          label="tokens"
        />
      </div>

      <div class="ov-modules">
        <div class="surface module--active ov-pool">
          <div class="card-head">
            <div class="card-head-text">
              <span class="card-eyebrow">Pool</span>
              <h2 class="card-title">Pool status</h2>
            </div>
            {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: status LED on a decorative span; label is informational, not interactive */}
            <span
              class={`dot${poolHealthy ? ' dot--ok dot--pulse' : loading ? '' : ' dot--error'}`}
              aria-label={
                poolHealthy ? 'Pool healthy' : loading ? 'Pool status unknown' : 'Pool empty'
              }
            />
          </div>
          {loading || !stats || !byModel ? (
            <div class="skeleton-cell" style={{ height: 96, marginTop: 8 }} />
          ) : (
            <dl class="specsheet" style={{ marginTop: 8 }}>
              <div class="specsheet-row">
                <dt class="specsheet-label">Upstream</dt>
                <dd class="specsheet-value">
                  {stats.enabledAccounts} / {stats.totalAccounts} enabled
                </dd>
              </div>
              <div class="specsheet-row">
                <dt class="specsheet-label">Client keys</dt>
                <dd class="specsheet-value">{stats.activeClientKeys} active</dd>
              </div>
              <div class="specsheet-row">
                <dt class="specsheet-label">Models live</dt>
                <dd class="specsheet-value">{byModel.length}</dd>
              </div>
              <div class="specsheet-row">
                <dt class="specsheet-label">Spend</dt>
                <dd class="specsheet-value">${formatCost(stats.totalCost)}</dd>
              </div>
            </dl>
          )}
        </div>

        {loading
          ? Array.from({ length: TOP_MODELS_MAX }).map((_, i) => (
              <div key={i} class="surface module--active ov-model">
                <div class="skeleton-cell" style={{ height: 14, width: '60%' }} />
                <div class="skeleton-cell" style={{ height: 22, width: '40%', marginTop: 12 }} />
                <div class="ov-model-bar-track">
                  <div class="skeleton-cell" style={{ height: 3, width: '100%' }} />
                </div>
              </div>
            ))
          : topModels.map((m) => {
              const share = maxRequests > 0 ? Math.max(3, (m.requests / maxRequests) * 100) : 0;
              return (
                <div key={m.model} class="surface module--active ov-model">
                  <span class="card-eyebrow" title={m.model}>
                    {m.model}
                  </span>
                  <div class="ov-model-cost mono">
                    $<em>{formatCost(m.cost)}</em>
                  </div>
                  <div class="ov-model-bar-track" aria-hidden="true">
                    <div class="ov-model-bar-fill" style={{ width: `${share}%` }} />
                  </div>
                  <div class="ov-model-meta mono">
                    {m.requests.toLocaleString()} req · {share.toFixed(0)}%
                  </div>
                </div>
              );
            })}
      </div>

      <div class="surface ov-log">
        <div class="card-head">
          <div class="card-head-text">
            <span class="card-eyebrow">By model</span>
            <h2 class="card-title">Cost &amp; traffic log</h2>
          </div>
          <span class="card-sub" style={{ marginBottom: 0 }}>
            {range}
          </span>
        </div>
        {loading ? (
          <TableSkeleton rows={3} cols={3} />
        ) : byModel && byModel.length === 0 ? (
          <p class="card-sub ov-empty">no traffic yet</p>
        ) : (
          <div class="ov-model-log">
            {byModel?.map((m) => (
              <div key={m.model} class="ov-model-log-row">
                <span class="mono ov-model-log-name" title={m.model}>
                  {m.model}
                </span>
                <span class="mono ov-model-log-cost">${formatCost(m.cost)}</span>
                <span class="mono ov-model-log-req">{m.requests.toLocaleString()} req</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div class="surface ov-log">
        <div class="card-head" style={{ justifyContent: 'space-between' }}>
          <div class="card-head-text">
            <span class="card-eyebrow">Recent</span>
            <h2 class="card-title">Hot requests</h2>
          </div>
          <a href="#/admin/usage" class="btn btn-ghost btn-sm">
            View all →
          </a>
        </div>
        {loading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : recent && recent.length === 0 ? (
          <p class="card-sub ov-empty">no requests yet</p>
        ) : (
          <div class="ov-recent-list">
            <div class="ov-recent-head">
              <span class="ov-recent-time">Time</span>
              <span class="ov-recent-model">Model</span>
              <span class="ov-recent-account">Account</span>
              <span class="ov-recent-status">Status</span>
              <span class="ov-recent-latency">Latency</span>
              <span class="ov-recent-cost">Cost</span>
            </div>
            {recent?.map((r) => (
              // biome-ignore lint/a11y/useSemanticElements: clickable log row is the canonical row-as-button pattern
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                aria-label={`Open request ${r.id}`}
                onClick={() => setSelected(r.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelected(r.id);
                  }
                }}
                class="ov-recent-row"
              >
                <span class="mono ov-recent-time" title={r.createdAt}>
                  {relativeTime(r.createdAt)}
                </span>
                <span class="mono ov-recent-model" title={r.model}>
                  {r.model}
                </span>
                <span class="mono ov-recent-account">{r.accountLabel ?? '—'}</span>
                <span class="ov-recent-status">
                  <Badge variant={statusVariant(r.statusCode)}>{r.statusCode}</Badge>
                </span>
                <span class="mono num ov-recent-latency">{r.latencyMs}ms</span>
                <span class="mono num ov-recent-cost">${formatCost(r.cost)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <RequestDetail id={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function Stat({
  loading,
  value,
  label,
}: {
  loading: boolean;
  value: string | null;
  label: string;
}) {
  return (
    <div class="ov-stat">
      {loading || value === null ? (
        <span class="skeleton-cell ov-stat-value" aria-hidden="true" />
      ) : (
        <span class="mono ov-stat-value">{value}</span>
      )}
      <span class="ov-stat-label">{label}</span>
    </div>
  );
}
