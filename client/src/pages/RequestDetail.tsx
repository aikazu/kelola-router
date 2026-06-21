import { useQuery } from '@tanstack/react-query';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { ErrorState } from '../components/ErrorState';
import { Modal } from '../components/Modal';
import { apiFetch } from '../lib/api';

interface RequestLog {
  id: number;
  createdAt: string;
  model: string;
  statusCode: number;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  clientKeyId: number | null;
  accountId: string | null;
  requestBody: string | null;
  responseBody: string | null;
  requestHeaders: Record<string, string> | null;
  responseHeaders: Record<string, string> | null;
  error: string | null;
}

type Tab = 'summary' | 'request' | 'response' | 'error';

function statusInk(code: number): string {
  if (code < 300) return 'var(--ink)';
  if (code < 500) return 'var(--gold)';
  return 'var(--crit)';
}

function fmtClock(iso: string): string {
  if (!iso) return '--:--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function JsonView({ data }: { data: string | null | undefined }) {
  if (data == null)
    return (
      <p class="card-sub" style={{ color: 'var(--ink-dim)', marginBottom: 0 }}>
        No body captured for this phase.
      </p>
    );
  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(data), null, 2);
  } catch {
    formatted = data;
  }
  return (
    <pre
      class="mono"
      style={{
        maxHeight: '40vh',
        overflow: 'auto',
        background: 'var(--obsidian-3)',
        border: '1px solid var(--grid)',
        padding: 12,
        borderRadius: 'var(--radius-sm)',
        fontSize: 12,
        lineHeight: 1.5,
        color: 'var(--ink)',
      }}
    >
      {formatted}
    </pre>
  );
}

function HeadersView({ headers }: { headers: Record<string, string> | null }) {
  if (!headers || Object.keys(headers).length === 0)
    return (
      <p class="card-sub" style={{ color: 'var(--ink-dim)', marginBottom: 0 }}>
        No headers recorded.
      </p>
    );
  return (
    <div class="specsheet" style={{ marginBottom: 16 }}>
      {Object.entries(headers).map(([k, v]) => (
        <div class="specsheet-row" key={k}>
          <span class="specsheet-label">{k}</span>
          <span class="specsheet-value mono" style={{ wordBreak: 'break-all' }}>
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Vertical phase timeline — synthetic rail built from a settled request log.
 *  Each row = one LED dot on a 1px gold-dim rail, with mono timestamp,
 *  uppercase eyebrow phase label, and mono detail values. */
function PhaseTimeline({ data }: { data: RequestLog }) {
  const isErr = data.error != null || data.statusCode >= 400;
  const endTs = (() => {
    const start = Date.parse(data.createdAt);
    if (Number.isNaN(start)) return data.createdAt;
    return new Date(start + data.latencyMs).toISOString();
  })();

  type Phase = {
    key: string;
    dot: string;
    ts: string;
    label: string;
    detail: string;
  };
  const phases: Phase[] = [
    {
      key: 'start',
      dot: 'dot dot--active',
      ts: fmtClock(data.createdAt),
      label: 'REQUEST START',
      detail: `POST /v1/chat · model=${data.model}`,
    },
    {
      key: 'transport',
      dot: 'dot dot--idle',
      ts: '—',
      label: 'TRANSPORT',
      detail: data.accountId != null ? `account=${data.accountId}` : 'no account bound',
    },
    {
      key: isErr ? 'error' : 'done',
      dot: isErr ? 'dot dot--error' : 'dot dot--ok',
      ts: fmtClock(endTs),
      label: isErr ? 'ERROR' : 'DONE',
      detail: `status=${data.statusCode} · latency=${data.latencyMs}ms`,
    },
  ];

  return (
    <div
      style={{
        position: 'relative',
        paddingLeft: 18,
        marginBottom: 20,
      }}
    >
      {/* Vertical rail */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 2,
          top: 4,
          bottom: 4,
          width: 1,
          background: 'var(--gold-dim)',
          opacity: 0.6,
        }}
      />
      {phases.map((p) => (
        <div
          key={p.key}
          style={{
            position: 'relative',
            display: 'grid',
            gridTemplateColumns: 'auto 64px 1fr',
            alignItems: 'baseline',
            gap: 12,
            padding: '6px 0',
          }}
        >
          <span
            class={p.dot}
            style={{
              position: 'absolute',
              left: -18,
              top: 11,
            }}
          />
          <span class="mono" style={{ color: 'var(--ink-dim)', fontSize: 11 }}>
            {p.ts}
          </span>
          <span class="card-eyebrow" style={{ marginBottom: 0 }}>
            {p.label}
          </span>
          <span class="mono" style={{ color: 'var(--ink)', fontSize: 11 }}>
            {p.detail}
          </span>
        </div>
      ))}
    </div>
  );
}

function SpecRow({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="specsheet-row">
      <span class="specsheet-label">{label}</span>
      <span class="specsheet-value mono num">{children}</span>
    </div>
  );
}

export function RequestDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('summary');
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['request-log', id],
    queryFn: () => apiFetch<RequestLog>(`/api/admin/request-logs/${id}`),
    enabled: id !== null,
  });

  const tabs = (
    ['summary', 'request', 'response', ...(data?.error ? ['error'] : [])] as Tab[]
  ).filter((t, i, arr) => arr.indexOf(t) === i);

  return (
    <Modal
      open={id !== null}
      onClose={onClose}
      title={data ? `Request #${data.id}` : 'Loading…'}
      width={760}
    >
      <div
        role="tablist"
        aria-label="Request detail tabs"
        style={{
          display: 'flex',
          gap: 2,
          borderBottom: '1px solid var(--grid)',
          marginBottom: 16,
        }}
      >
        {tabs.map((t) => (
          <button
            type="button"
            key={t}
            id={`tab-${t}`}
            role="tab"
            aria-selected={tab === t}
            aria-controls={`tabpanel-${t}`}
            onClick={() => setTab(t)}
            class="mono"
            style={{
              background: 'none',
              border: 0,
              padding: '8px 14px',
              color: tab === t ? 'var(--gold)' : 'var(--ink-dim)',
              borderBottom: tab === t ? '2px solid var(--gold)' : '2px solid transparent',
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              outlineOffset: 2,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {isLoading && (
        <div class="card-sub" style={{ marginBottom: 16 }}>
          <span class="skeleton-cell" aria-hidden="true" style={{ display: 'inline-block' }} />
        </div>
      )}
      {isError && (
        <ErrorState error={new Error('Failed to load request')} onRetry={() => refetch()} />
      )}

      {data && tab === 'summary' && (
        <div id="tabpanel-summary" role="tabpanel" aria-labelledby="tab-summary">
          <PhaseTimeline data={data} />
          <div class="specsheet">
            <SpecRow label="MODEL">{data.model}</SpecRow>
            <div class="specsheet-row">
              <span class="specsheet-label">STATUS</span>
              <span class="specsheet-value mono num">
                <span style={{ color: statusInk(data.statusCode), fontWeight: 500 }}>
                  {data.statusCode}
                </span>
              </span>
            </div>
            <SpecRow label="LATENCY">{data.latencyMs}ms</SpecRow>
            <SpecRow label="TOKENS">
              {data.promptTokens} + {data.completionTokens} = {data.totalTokens}
            </SpecRow>
            <SpecRow label="COST">${data.cost.toFixed(6)}</SpecRow>
            <SpecRow label="TIME">
              <time dateTime={data.createdAt}>{data.createdAt}</time>
            </SpecRow>
            <SpecRow label="CLIENT KEY">{data.clientKeyId ?? '—'}</SpecRow>
            <SpecRow label="ACCOUNT">{data.accountId ?? '—'}</SpecRow>
          </div>
        </div>
      )}

      {data && tab === 'request' && (
        <div id="tabpanel-request" role="tabpanel" aria-labelledby="tab-request">
          <div class="card-eyebrow" style={{ marginBottom: 8 }}>
            REQUEST BODY
          </div>
          <JsonView data={data.requestBody} />
          <div class="card-eyebrow" style={{ margin: '16px 0 8px' }}>
            REQUEST HEADERS
          </div>
          <HeadersView headers={data.requestHeaders} />
        </div>
      )}

      {data && tab === 'response' && (
        <div id="tabpanel-response" role="tabpanel" aria-labelledby="tab-response">
          <div class="card-eyebrow" style={{ marginBottom: 8 }}>
            RESPONSE BODY
          </div>
          <JsonView data={data.responseBody} />
          <div class="card-eyebrow" style={{ margin: '16px 0 8px' }}>
            RESPONSE HEADERS
          </div>
          <HeadersView headers={data.responseHeaders} />
        </div>
      )}

      {data && tab === 'error' && data.error && (
        <div id="tabpanel-error" role="tabpanel" aria-labelledby="tab-error">
          <div class="card-eyebrow" style={{ color: 'var(--crit)', marginBottom: 8 }}>
            ERROR
          </div>
          <pre
            class="mono card-sub"
            style={{
              color: 'var(--crit)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              paddingLeft: 10,
              borderLeft: '2px solid var(--crit)',
              marginBottom: 0,
            }}
          >
            {data.error}
          </pre>
        </div>
      )}
    </Modal>
  );
}
