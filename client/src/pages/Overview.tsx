import { useQuery } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { ErrorState } from '../components/ErrorState';
import { StatSkeleton, TableSkeleton } from '../components/Skeleton';
import { Stat } from '../components/Stat';
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
    statusCode: number;
    cost: number;
    latencyMs: number;
    clientKeyId: number | null;
    accountId: string | null;
  }>;
}

export function Overview() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['overview'],
    queryFn: () => apiFetch<OverviewData>('/api/admin/overview'),
  });
  const [selected, setSelected] = useState<number | null>(null);

  if (isError)
    return (
      <>
        <TopBar title="Overview" />
        <ErrorState error={error as Error} onRetry={() => refetch()} />
      </>
    );

  return (
    <>
      <TopBar
        title={
          <>
            Over<em>view</em>
          </>
        }
        eyebrow="Operations / 7-day window"
      />

      {/* Hero band: dominant cost figure + supporting spec-sheet — asymmetric */}
      <div class="ov-hero">
        <div class="ov-hero-figure surface">
          <span class="card-eyebrow">Spend · last 7 days</span>
          {isLoading || !data ? (
            <div class="skeleton-cell" style={{ height: 56, width: '60%', marginTop: 10 }} />
          ) : (
            <>
              <div class="hero-figure">
                $<em>{data.stats.totalCost.toFixed(2)}</em>
              </div>
              <div class="hero-figure-sub">
                {data.stats.totalRequests.toLocaleString()} requests ·{' '}
                {data.stats.totalTokens.toLocaleString()} tokens
              </div>
            </>
          )}
        </div>
        <div class="ov-hero-meta surface">
          <span class="card-eyebrow">Pool status</span>
          {isLoading || !data ? (
            <div class="skeleton-cell" style={{ height: 80, marginTop: 12 }} />
          ) : (
            <div class="specsheet" style={{ marginTop: 12 }}>
              <div class="specsheet-row">
                <span class="specsheet-label">Upstream</span>
                <span class="specsheet-value">
                  {data.stats.enabledAccounts} / {data.stats.totalAccounts} enabled
                </span>
              </div>
              <div class="specsheet-row">
                <span class="specsheet-label">Client keys</span>
                <span class="specsheet-value">{data.stats.activeClientKeys} active</span>
              </div>
              <div class="specsheet-row">
                <span class="specsheet-label">Models live</span>
                <span class="specsheet-value">{data.byModel.length}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div class="ov-cols">
        <Card title="By model" eyebrow="Last 7 days">
          {isLoading || !data ? (
            <TableSkeleton rows={3} cols={3} />
          ) : data.byModel.length === 0 ? (
            <p class="card-sub">No requests yet.</p>
          ) : (
            <table class="tbl">
              <thead>
                <tr>
                  <th>Model</th>
                  <th class="num">Cost</th>
                  <th class="num">Requests</th>
                </tr>
              </thead>
              <tbody>
                {data.byModel.map((m) => (
                  <tr key={m.model}>
                    <td>{m.model}</td>
                    <td class="num mono">${m.cost.toFixed(4)}</td>
                    <td class="num mono">{m.requests.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card
          title="Recent requests"
          eyebrow="Live stream"
          actions={
            <a href="#/admin/usage" class="btn btn-ghost btn-sm">
              View all →
            </a>
          }
        >
          {isLoading || !data ? (
            <TableSkeleton rows={5} cols={5} />
          ) : data.recent.length === 0 ? (
            <p class="card-sub">No traffic yet.</p>
          ) : (
            <table class="tbl">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Model</th>
                  <th>Status</th>
                  <th class="num">Latency</th>
                  <th class="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r) => (
                  <tr
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
                    style={{ cursor: 'pointer' }}
                  >
                    <td title={r.createdAt} class="mono">
                      {relativeTime(r.createdAt)}
                    </td>
                    <td>{r.model}</td>
                    <td>
                      <Badge
                        variant={
                          r.statusCode < 300 ? 'active' : r.statusCode < 500 ? 'warn' : 'error'
                        }
                      >
                        {r.statusCode}
                      </Badge>
                    </td>
                    <td class="num mono">{r.latencyMs}ms</td>
                    <td class="num mono">${r.cost.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <RequestDetail id={selected} onClose={() => setSelected(null)} />
    </>
  );
}
