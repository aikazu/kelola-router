import { useQuery } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { Badge } from '../components/Badge';
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

function JsonView({ data }: { data: string | null | undefined }) {
  if (data == null) return <p style={{ color: 'var(--text-3)' }}>No data</p>;
  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(data), null, 2);
  } catch {
    formatted = data;
  }
  return (
    <pre
      style={{
        maxHeight: '50vh',
        overflow: 'auto',
        background: 'var(--ink-2)',
        padding: 12,
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      {formatted}
    </pre>
  );
}

function HeadersView({ headers }: { headers: Record<string, string> | null }) {
  if (!headers || Object.keys(headers).length === 0)
    return <p style={{ color: 'var(--text-3)' }}>No headers</p>;
  return (
    <table class="tbl">
      <thead>
        <tr>
          <th>Header</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(headers).map(([k, v]) => (
          <tr key={k}>
            <td class="mono">{k}</td>
            <td class="mono">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RequestDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('summary');
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['request-log', id],
    queryFn: () => apiFetch<RequestLog>(`/api/admin/request-logs/${id}`),
    enabled: id !== null,
  });

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
          gap: 4,
          borderBottom: '1px solid var(--ink-3)',
          marginBottom: 16,
        }}
      >
        {(['summary', 'request', 'response', ...(data?.error ? ['error'] : [])] as Tab[]).map(
          (t) => (
            <button
              key={t}
              id={`tab-${t}`}
              role="tab"
              aria-selected={tab === t}
              aria-controls={`tabpanel-${t}`}
              onClick={() => setTab(t)}
              style={{
                background: 'none',
                border: 0,
                padding: '8px 14px',
                color: tab === t ? 'var(--emerald-4)' : 'var(--text-2)',
                borderBottom: tab === t ? '2px solid var(--emerald-3)' : '2px solid transparent',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: 1,
                textTransform: 'uppercase',
                cursor: 'pointer',
                fontFamily: 'inherit',
                outlineOffset: 2,
              }}
            >
              {t}
            </button>
          )
        )}
      </div>
      {isLoading && <p>Loading…</p>}
      {isError && (
        <ErrorState error={new Error('Failed to load request')} onRetry={() => refetch()} />
      )}
      {data && tab === 'summary' && (
        <div id="tabpanel-summary" role="tabpanel" aria-labelledby="tab-summary">
          <table class="tbl">
            <tbody>
              <tr>
                <th style={{ width: 140 }}>Model</th>
                <td>{data.model}</td>
              </tr>
              <tr>
                <th>Status</th>
                <td>
                  <Badge
                    variant={
                      data.statusCode < 300 ? 'active' : data.statusCode < 500 ? 'warn' : 'error'
                    }
                  >
                    {data.statusCode}
                  </Badge>
                </td>
              </tr>
              <tr>
                <th>Latency</th>
                <td>{data.latencyMs}ms</td>
              </tr>
              <tr>
                <th>Tokens</th>
                <td>
                  {data.promptTokens} prompt + {data.completionTokens} completion ={' '}
                  {data.totalTokens}
                </td>
              </tr>
              <tr>
                <th>Cost</th>
                <td>${data.cost.toFixed(6)}</td>
              </tr>
              <tr>
                <th>Time</th>
                <td>{data.createdAt}</td>
              </tr>
              <tr>
                <th>Client key ID</th>
                <td>{data.clientKeyId ?? '—'}</td>
              </tr>
              <tr>
                <th>Account ID</th>
                <td>{data.accountId ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {data && tab === 'request' && (
        <div id="tabpanel-request" role="tabpanel" aria-labelledby="tab-request">
          <h4
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 11,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              color: 'var(--text-3)',
              marginBottom: 8,
            }}
          >
            Body
          </h4>
          <JsonView data={data.requestBody} />
          <h4
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 11,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              color: 'var(--text-3)',
              margin: '16px 0 8px',
            }}
          >
            Headers
          </h4>
          <HeadersView headers={data.requestHeaders} />
        </div>
      )}
      {data && tab === 'response' && (
        <div id="tabpanel-response" role="tabpanel" aria-labelledby="tab-response">
          <h4
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 11,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              color: 'var(--text-3)',
              marginBottom: 8,
            }}
          >
            Body
          </h4>
          <JsonView data={data.responseBody} />
          <h4
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 11,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              color: 'var(--text-3)',
              margin: '16px 0 8px',
            }}
          >
            Headers
          </h4>
          <HeadersView headers={data.responseHeaders} />
        </div>
      )}
      {data && tab === 'error' && data.error && (
        <div id="tabpanel-error" role="tabpanel" aria-labelledby="tab-error">
          <p style={{ color: 'var(--danger)' }}>{data.error}</p>
        </div>
      )}
    </Modal>
  );
}
