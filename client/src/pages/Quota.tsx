import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'preact/hooks';
import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { ErrorState } from '../components/ErrorState';
import { TableSkeleton } from '../components/Skeleton';
import { useToast } from '../components/ToastProvider';
import { TopBar } from '../layout/TopBar';
import { apiFetch } from '../lib/api';
import { forwardDuration, relativeTime } from '../lib/relativeTime';
import type { QuotaWindow } from '../lib/types';

interface AccountQuota {
  accountId: string;
  label: string;
  creditType: string;
  enabled: boolean;
  ok: boolean;
  windows: QuotaWindow[];
  error?: string;
}

const WINDOW_LABEL: Record<string, string> = { '5h': '5h', weekly: 'wk', monthly: 'mo' };
const WINDOW_ORDER = ['5h', 'weekly', 'monthly'];

// Percent the bar should show: prefer upstream remaining_percent; else derive from counts.
function pctOf(w: QuotaWindow): number {
  if (w.remainingPercent != null) return Math.max(0, Math.min(100, w.remainingPercent));
  if (w.totalCount > 0) return Math.round((w.remainingCount / w.totalCount) * 100);
  return 0;
}

function worstPercent(windows: QuotaWindow[]): number {
  if (windows.length === 0) return 100;
  return Math.min(...windows.map(pctOf));
}

function BarRow({ w }: { w: QuotaWindow }) {
  const pct = pctOf(w);
  // Remaining% drives the fill; over-quota/low is signalled by --crit.
  // Used% = 100 - remaining: when remaining < 20 => used > 80 => warn.
  const low = pct < 20;
  const over = pct <= 0;
  const fill = low ? 'var(--crit)' : 'var(--gold)';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '24px 1fr auto',
        gap: 10,
        alignItems: 'center',
        padding: '4px 0',
      }}
    >
      <span
        class="mono"
        style={{ fontSize: 10, color: 'var(--ink-faint)', letterSpacing: '0.1em' }}
      >
        {WINDOW_LABEL[w.windowType] ?? w.windowType}
      </span>
      <div
        role="img"
        aria-label={`${pct}% remaining`}
        style={{
          position: 'relative',
          height: 3,
          background: 'var(--obsidian-3)',
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: fill,
            transition: 'width 0.3s',
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
        {over && <span class="dot dot--error" aria-hidden="true" />}
        <span class="mono num" style={{ fontSize: 11, color: low ? 'var(--crit)' : 'var(--ink)' }}>
          {pct}%
        </span>
        {w.totalCount > 0 && (
          <span class="mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>
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
  const worst = worstPercent(ordered);
  return (
    <div
      style={{
        marginBottom: 12,
        animationDelay: `${delay}ms`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 4,
        }}
      >
        <span class={`dot ${worst < 20 ? 'dot--error' : 'dot--ok'}`} aria-hidden="true" />
        <span class="mono" style={{ fontSize: 12, color: 'var(--ink)' }}>
          {head.modelName}
        </span>
        {reset != null && (
          <span class="mono" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--gold-dim)' }}>
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

function AccountRow({
  q,
  expanded,
  onToggle,
}: {
  q: AccountQuota;
  expanded: boolean;
  onToggle: () => void;
}) {
  const grouped = useMemo(() => {
    const byModel = new Map<string, QuotaWindow[]>();
    for (const w of q.windows) {
      const list = byModel.get(w.modelName) ?? [];
      list.push(w);
      byModel.set(w.modelName, list);
    }
    return [...byModel.entries()];
  }, [q.windows]);

  const worst = worstPercent(q.windows);
  const fiveHWindow = q.windows.find((w) => w.windowType === '5h');
  const weeklyWindow = q.windows.find((w) => w.windowType === 'weekly');
  const fiveHPct = fiveHWindow ? pctOf(fiveHWindow) : null;
  const weeklyPct = weeklyWindow ? pctOf(weeklyWindow) : null;
  const reset = fiveHWindow?.remainsTime ?? weeklyWindow?.remainsTime ?? null;
  const lastFetched =
    q.windows.length > 0
      ? q.windows.reduce((a, b) => (a.fetchedAt > b.fetchedAt ? a : b)).fetchedAt
      : null;
  const warnHealth = worst < 20;
  const hasError = q.ok === false;

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: the clickable row pattern (tr role=button + tabIndex + aria-expanded + key handler) is the canonical a11y pattern for expandable table rows. */}
      <tr
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        style={{ cursor: 'pointer' }}
        title={
          hasError
            ? `Error: ${q.error}`
            : lastFetched
              ? `Last fetched ${relativeTime(lastFetched)}`
              : undefined
        }
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <td class="mono" style={{ width: 24, color: 'var(--ink-faint)' }}>
          {expanded ? '▾' : '▸'}
        </td>
        <td style={{ fontWeight: 500 }}>
          {q.label}
          {!q.enabled && (
            <span class="mono" style={{ color: 'var(--ink-faint)', fontSize: 10, marginLeft: 8 }}>
              disabled
            </span>
          )}
          {hasError && (
            <span class="mono" style={{ color: 'var(--crit)', fontSize: 10, marginLeft: 8 }}>
              error
            </span>
          )}
        </td>
        <td>
          <Badge variant={q.creditType === 'token-plan' ? 'warn' : hasError ? 'error' : 'active'}>
            {q.creditType}
          </Badge>
        </td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              role="img"
              aria-label={`${worst}% health`}
              style={{
                position: 'relative',
                width: 60,
                height: 3,
                background: 'var(--obsidian-3)',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${worst}%`,
                  height: '100%',
                  background: warnHealth ? 'var(--crit)' : 'var(--gold)',
                }}
              />
            </div>
            {hasError && <span class="dot dot--error" aria-hidden="true" />}
            <span
              class="mono num"
              style={{
                fontSize: 11,
                color: hasError ? 'var(--ink-faint)' : warnHealth ? 'var(--crit)' : 'var(--ink)',
              }}
            >
              {hasError ? '—' : `${worst}%`}
            </span>
          </div>
        </td>
        <td class="num mono" style={{ fontSize: 11 }}>
          {hasError ? '—' : fiveHPct != null ? `${fiveHPct}%` : '—'}
        </td>
        <td class="num mono" style={{ fontSize: 11 }}>
          {hasError ? '—' : weeklyPct != null ? `${weeklyPct}%` : '—'}
        </td>
        <td class="mono" style={{ fontSize: 10, color: 'var(--ink-dim)' }}>
          {hasError ? '—' : reset != null ? forwardDuration(reset) : '—'}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} style={{ padding: '12px 16px', background: 'var(--obsidian-3)' }}>
            {hasError ? (
              <p class="card-sub" style={{ color: 'var(--crit)' }}>
                Failed to load quota: {q.error ?? 'unknown error'}
              </p>
            ) : grouped.length === 0 ? (
              <p class="card-sub">No quota data yet — puller refreshes every 5 min.</p>
            ) : (
              grouped.map(([model, windows], i) => (
                <ModelBlock key={model} windows={windows} delay={i * 70} />
              ))
            )}
            {lastFetched && !hasError && (
              <p class="mono" style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 14 }}>
                Last fetched {relativeTime(lastFetched)}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function Quota() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const qc = useQueryClient();
  const toast = useToast();

  const {
    data: quotaResponse,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['quota'],
    queryFn: () => apiFetch<{ accounts: AccountQuota[] }>('/api/admin/quota'),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const quotas = quotaResponse?.accounts ?? [];

  const pullMut = useMutation({
    mutationFn: () => apiFetch('/api/admin/quota/pull', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quota'] });
      toast.success('Quota refreshed from upstream');
    },
    onError: (e: Error) => toast.error(e.message),
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
          <>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              onClick={() => pullMut.mutate()}
              disabled={pullMut.isPending}
              title="Fetch fresh quota from upstream providers"
              aria-label="Pull quota from upstream"
            >
              <span class={pullMut.isPending ? 'refresh-spin' : ''}>⟳</span> Pull upstream
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              onClick={() => refetch()}
              aria-label="Refresh quota"
              disabled={isFetching}
            >
              <span class={isFetching ? 'refresh-spin' : ''}>↻</span> Refresh
            </button>
          </>
        }
      />
      {isLoading ? (
        <Card eyebrow="QUOTA" title="Balances">
          <TableSkeleton rows={3} cols={3} />
        </Card>
      ) : quotas.length === 0 ? (
        <div class="surface" style={{ textAlign: 'center', padding: '40px 24px' }}>
          <span class="card-eyebrow" style={{ marginBottom: 8 }}>
            EMPTY
          </span>
          <p class="card-sub" style={{ marginBottom: 0 }}>
            No quota data — <a href="#/admin/accounts">add an upstream account</a> to see quota
            windows.
          </p>
        </div>
      ) : (
        <Card eyebrow="QUOTA" title="Balances">
          <table class="tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 24 }} />
                <th>Account</th>
                <th>Type</th>
                <th>Health</th>
                <th>5h</th>
                <th>Weekly</th>
                <th>Resets in</th>
              </tr>
            </thead>
            <tbody>
              {quotas.map((q) => (
                <AccountRow
                  key={q.accountId}
                  q={q}
                  expanded={expanded.has(q.accountId)}
                  onToggle={() => toggleExpand(q.accountId)}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
