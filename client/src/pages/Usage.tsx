import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { ErrorState } from '../components/ErrorState';
import { Pagination } from '../components/Pagination';
import { TableSkeleton } from '../components/Skeleton';
import { Stat } from '../components/Stat';
import { TopBar } from '../layout/TopBar';
import { apiFetch } from '../lib/api';
import { relativeTime } from '../lib/relative-time';
import { RequestDetail } from './RequestDetail';

interface ClientKey {
  id: number;
  label: string;
  enabled: boolean;
}
interface UsageLog {
  id: number;
  createdAt: string;
  model: string;
  statusCode: number;
  cost: number;
  latencyMs: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  clientKeyId: number | null;
  accountId: string | null;
  accountLabel: string | null;
  error: string | null;
}
interface UsageSummary {
  totalCost: number;
  totalRequests: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  cacheCost: number;
  deltaCostPct: number | null;
  deltaRequestsPct: number | null;
  deltaTokensPct: number | null;
}
interface UsagePage {
  rows: UsageLog[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function Delta({ pct, label }: { pct: number | null; label: string }) {
  if (pct === null) return <span class="delta-flat">— {label}</span>;
  const cls = pct > 0 ? 'delta-up' : pct < 0 ? 'delta-down' : 'delta-flat';
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '—';
  return (
    <span class={cls} style={{ fontSize: 11, marginLeft: 8 }}>
      {arrow} {Math.abs(pct).toFixed(1)}% {label}
    </span>
  );
}

export function Usage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [clientKeyId, setClientKeyId] = useState<number | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | '2xx' | '4xx' | '5xx'>('all');
  const [sortBy, setSortBy] = useState<'created_at' | 'cost_usd' | 'latency_ms' | 'total_tokens'>(
    'created_at'
  );
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [days, setDays] = useState(1);
  const [accountFilter, setAccountFilter] = useState<string>('');
  const [selected, setSelected] = useState<number | null>(null);

  // Debounce search input so each keystroke doesn't refetch the usage query.
  // 300ms feels instant to the user but collapses bursts of typing into one fetch.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // URL sync: read on mount + react to hashchange (back/forward), write on change via replaceState
  useEffect(() => {
    const onHash = () => {
      const p = new URLSearchParams(location.hash.split('?')[1] ?? '');
      if (p.get('page')) setPage(Math.max(1, Number(p.get('page'))));
      if (p.get('client_key')) setClientKeyId(Number(p.get('client_key')));
      if (p.get('days')) setDays(Number(p.get('days')));
      const q = p.get('q');
      if (q) setSearch(q);
      if (p.get('status')) setStatusFilter(p.get('status') as 'all' | '2xx' | '4xx' | '5xx');
      const accountId = p.get('account_id');
      if (accountId) setAccountFilter(accountId);
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const params = useMemo(() => {
    const p = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
      days: String(days),
      sort_by: sortBy,
      sort_dir: sortDir,
    });
    if (clientKeyId) p.set('client_key', String(clientKeyId));
    if (debouncedSearch) p.set('q', debouncedSearch);
    if (statusFilter !== 'all')
      p.set('status', statusFilter === '2xx' ? '200' : statusFilter === '4xx' ? '400' : '500');
    if (accountFilter) p.set('account_id', accountFilter);
    return p.toString();
  }, [
    page,
    pageSize,
    days,
    sortBy,
    sortDir,
    clientKeyId,
    debouncedSearch,
    statusFilter,
    accountFilter,
  ]);

  useEffect(() => {
    const newHash = `#/admin/usage?${params}`;
    if (location.hash !== newHash) {
      history.replaceState(null, '', newHash);
    }
  }, [params]);

  const { data: keys } = useQuery({
    queryKey: ['client-keys'],
    queryFn: () => apiFetch<ClientKey[]>('/api/admin/client-keys'),
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => apiFetch<Array<{ id: string; label: string }>>('/api/admin/accounts'),
  });
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['usage', params],
    queryFn: () =>
      apiFetch<{ summary: UsageSummary; page: UsagePage }>(`/api/admin/usage?${params}`),
    placeholderData: (prev) => prev,
  });

  const setSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortBy(col);
      setSortDir('desc');
    }
    setPage(1);
  };
  const sortArrow = (col: typeof sortBy) =>
    sortBy === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <>
      <TopBar
        title={
          <>
            Us<em>age</em>
          </>
        }
        eyebrow="Request log / analytics"
        subtitle="Per-model cost and request logs — filter, sort and drill in"
        actions={
          <select
            value={days}
            onChange={(e) => {
              setDays(Number((e.target as HTMLSelectElement).value));
              setPage(1);
            }}
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

      <Card eyebrow="USAGE" title="Filters">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="search"
            class="input"
            placeholder="Search by model, id, error..."
            aria-label="Search requests"
            autoComplete="off"
            value={search}
            onInput={(e) => {
              setSearch((e.target as HTMLInputElement).value);
              setPage(1);
            }}
            style={{ flex: 1, minWidth: 200 }}
          />
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(
                (e.target as HTMLSelectElement).value as 'all' | '2xx' | '4xx' | '5xx'
              );
              setPage(1);
            }}
          >
            <option value="all">All status</option>
            <option value="2xx">2xx success</option>
            <option value="4xx">4xx client error</option>
            <option value="5xx">5xx server error</option>
          </select>
          <select
            aria-label="Filter by account"
            value={accountFilter}
            onChange={(e) => {
              setAccountFilter((e.target as HTMLSelectElement).value);
              setPage(1);
            }}
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <div class="mono" style={{ fontSize: 11, color: 'var(--ink-dim)' }}>
            Client:
            <button
              type="button"
              onClick={() => {
                setClientKeyId(undefined);
                setPage(1);
              }}
              aria-label="Show all client keys"
              aria-current={clientKeyId === undefined ? 'true' : undefined}
              style={{
                background: 'none',
                border: 0,
                padding: 0,
                font: 'inherit',
                cursor: 'pointer',
                color: clientKeyId === undefined ? 'var(--gold)' : 'inherit',
                fontWeight: clientKeyId === undefined ? 700 : 400,
                marginLeft: 6,
              }}
            >
              all
            </button>
            {keys?.map((k) => (
              <button
                type="button"
                key={k.id}
                onClick={() => {
                  setClientKeyId(k.id);
                  setPage(1);
                }}
                aria-label={`Filter by client key: ${k.label}`}
                aria-current={clientKeyId === k.id ? 'true' : undefined}
                style={{
                  background: 'none',
                  border: 0,
                  padding: 0,
                  font: 'inherit',
                  cursor: 'pointer',
                  color: clientKeyId === k.id ? 'var(--gold)' : 'inherit',
                  fontWeight: clientKeyId === k.id ? 700 : 400,
                  marginLeft: 6,
                }}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {data && (
        <div class="surface module--active" style={{ marginBottom: 20 }}>
          <div class="card-head">
            <div class="card-head-text">
              <span class="card-eyebrow">SUMMARY</span>
              <h2 class="card-title">Totals</h2>
            </div>
          </div>
          <div class="stat-grid">
            <Stat
              label="Total cost"
              value={`$${data.summary.totalCost.toFixed(4)}`}
              sub={
                <>
                  <div class="mono" style={{ fontSize: 11, color: 'var(--ink-dim)' }}>
                    In ${data.summary.inputCost.toFixed(4)} · Out $
                    {data.summary.outputCost.toFixed(4)}
                    {data.summary.cacheCost > 0
                      ? ` · Cache $${data.summary.cacheCost.toFixed(4)}`
                      : ''}
                  </div>
                  <Delta pct={data.summary.deltaCostPct} label="vs prev period" />
                </>
              }
            />
            <Stat
              label="Requests"
              value={data.summary.totalRequests.toLocaleString()}
              sub={<Delta pct={data.summary.deltaRequestsPct} label="vs prev period" />}
            />
            <Stat
              label="Input tokens"
              value={data.summary.inputTokens.toLocaleString()}
              sub={
                <span class="mono" style={{ fontSize: 11, color: 'var(--ink-dim)' }}>
                  of {data.summary.totalTokens.toLocaleString()} total
                </span>
              }
            />
            <Stat
              label="Output tokens"
              value={data.summary.outputTokens.toLocaleString()}
              sub={
                <span class="mono" style={{ fontSize: 11, color: 'var(--ink-dim)' }}>
                  of {data.summary.totalTokens.toLocaleString()} total
                </span>
              }
            />
          </div>
        </div>
      )}

      <Card title="Requests" eyebrow="REQUESTS">
        {isError ? (
          <ErrorState error={error as Error} onRetry={() => refetch()} />
        ) : isLoading || !data ? (
          <TableSkeleton rows={5} cols={6} />
        ) : data.page.rows.length === 0 ? (
          <p class="card-sub">No requests match these filters.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table class="tbl">
                <thead>
                  <tr>
                    <th
                      aria-sort={
                        sortBy === 'created_at'
                          ? sortDir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button
                        type="button"
                        onClick={() => setSort('created_at')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSort('created_at');
                          }
                        }}
                        style={{
                          background: 'none',
                          border: 0,
                          padding: 0,
                          font: 'inherit',
                          color: 'inherit',
                          cursor: 'pointer',
                          letterSpacing: 'inherit',
                          textTransform: 'inherit',
                        }}
                      >
                        Time{sortArrow('created_at')}
                      </button>
                    </th>
                    <th>Model</th>
                    <th>Account</th>
                    <th
                      aria-sort={
                        sortBy === 'total_tokens'
                          ? sortDir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button
                        type="button"
                        onClick={() => setSort('total_tokens')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSort('total_tokens');
                          }
                        }}
                        style={{
                          background: 'none',
                          border: 0,
                          padding: 0,
                          font: 'inherit',
                          color: 'inherit',
                          cursor: 'pointer',
                          letterSpacing: 'inherit',
                          textTransform: 'inherit',
                        }}
                      >
                        Tokens{sortArrow('total_tokens')}
                      </button>
                    </th>
                    <th
                      aria-sort={
                        sortBy === 'cost_usd'
                          ? sortDir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button
                        type="button"
                        onClick={() => setSort('cost_usd')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSort('cost_usd');
                          }
                        }}
                        style={{
                          background: 'none',
                          border: 0,
                          padding: 0,
                          font: 'inherit',
                          color: 'inherit',
                          cursor: 'pointer',
                          letterSpacing: 'inherit',
                          textTransform: 'inherit',
                        }}
                      >
                        Cost{sortArrow('cost_usd')}
                      </button>
                    </th>
                    <th
                      aria-sort={
                        sortBy === 'latency_ms'
                          ? sortDir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button
                        type="button"
                        onClick={() => setSort('latency_ms')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSort('latency_ms');
                          }
                        }}
                        style={{
                          background: 'none',
                          border: 0,
                          padding: 0,
                          font: 'inherit',
                          color: 'inherit',
                          cursor: 'pointer',
                          letterSpacing: 'inherit',
                          textTransform: 'inherit',
                        }}
                      >
                        Latency{sortArrow('latency_ms')}
                      </button>
                    </th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.page.rows.map((l) => (
                    // biome-ignore lint/a11y/useSemanticElements: tr role=button clickable-row pattern
                    <tr
                      key={l.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open request ${l.id}`}
                      onClick={() => setSelected(l.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelected(l.id);
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <td class="mono" title={l.createdAt}>
                        {relativeTime(l.createdAt)}
                      </td>
                      <td class="mono">{l.model}</td>
                      <td>{l.accountLabel ?? '—'}</td>
                      <td class="num mono">{l.totalTokens.toLocaleString()}</td>
                      <td class="num mono">${l.cost.toFixed(4)}</td>
                      <td class="num mono">{l.latencyMs}ms</td>
                      <td>
                        <Badge
                          variant={
                            l.statusCode < 300 ? 'active' : l.statusCode < 500 ? 'warn' : 'error'
                          }
                        >
                          {l.statusCode}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={data.page.page}
              pageSize={data.page.pageSize}
              total={data.page.total}
              totalPages={data.page.totalPages}
              onPageChange={setPage}
              onPageSizeChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
            />
          </>
        )}
      </Card>
      <RequestDetail id={selected} onClose={() => setSelected(null)} />
    </>
  );
}
