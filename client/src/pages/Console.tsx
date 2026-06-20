import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Button } from '../components/Button';
import { TopBar } from '../layout/TopBar';
import { apiFetch } from '../lib/api';
import { relativeTime } from '../lib/relativeTime';

interface RequestLogDetail {
  id: number;
  requestedModel: string | null;
  endpoint: string;
  statusCode: number;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  cost: number;
  rtkBytesSaved: number;
  stream: number;
  accountId: string | null;
  clientKeyId: number | null;
  requestBody: string | null;
  responseBody: string | null;
  error: string | null;
}

function byteLen(s: string | null): number {
  return s ? new Blob([s]).size : 0;
}

function ConsoleBlockDetail({ reqId }: { reqId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['request-log-by-req', reqId],
    queryFn: () =>
      apiFetch<RequestLogDetail>(`/api/admin/request-logs/by-req-id/${reqId}`),
    staleTime: 30_000,
    retry: false,
  });
  if (isLoading) return <div class="console-detail">loading…</div>;
  if (isError || !data)
    return <div class="console-detail">no persisted log for this request</div>;
  return (
    <div class="console-detail">
      <div>account: {data.accountId ?? '—'} · client-key: {data.clientKeyId ?? '—'}</div>
      <div>
        model: {data.requestedModel ?? '—'} · {data.endpoint} · {data.stream ? 'stream' : 'buffered'}
      </div>
      <div>
        tokens: in {data.promptTokens} out {data.completionTokens} cache{' '}
        {data.cacheReadTokens}/{data.cacheCreationTokens} total {data.totalTokens}
      </div>
      <div>
        cost ${data.cost.toFixed(6)} · latency {data.latencyMs}ms · rtk saved{' '}
        {data.rtkBytesSaved}B
      </div>
      <div>
        body sizes: req {byteLen(data.requestBody)}B · resp {byteLen(data.responseBody)}B
      </div>
      {data.error && <div class="console-err">error: {data.error}</div>}
    </div>
  );
}

export type FlowEvent =
  | { phase: 'start'; reqId: string; ts: string; method: string; path: string; model: string; alias: string | null }
  | { phase: 'account'; reqId: string; ts: string; accountLabel: string; reason: string }
  | { phase: 'transport'; reqId: string; ts: string; kind: string; label: string }
  | { phase: 'transport-fail'; reqId: string; ts: string; fellBack: boolean; message: string }
  | { phase: 'done'; reqId: string; ts: string; status: number; ttftMs: number | null; inTok: number; outTok: number; cacheTok: number; costUsd: number; latencyMs: number; rtkSaved: number }
  | { phase: 'error'; reqId: string; ts: string; status: number; message: string };

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
function fmtLatency(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

interface Block {
  reqId: string;
  start?: Extract<FlowEvent, { phase: 'start' }>;
  account?: Extract<FlowEvent, { phase: 'account' }>;
  transport?: Extract<FlowEvent, { phase: 'transport' }>;
  transportFail?: Extract<FlowEvent, { phase: 'transport-fail' }>;
  done?: Extract<FlowEvent, { phase: 'done' }>;
  error?: Extract<FlowEvent, { phase: 'error' }>;
}

function groupBlocks(events: FlowEvent[]): Block[] {
  const map = new Map<string, Block>();
  const order: string[] = [];
  for (const e of events) {
    let b = map.get(e.reqId);
    if (!b) {
      b = { reqId: e.reqId };
      map.set(e.reqId, b);
      order.push(e.reqId);
    }
    if (e.phase === 'start') b.start = e;
    else if (e.phase === 'account') b.account = e;
    else if (e.phase === 'transport') b.transport = e;
    else if (e.phase === 'transport-fail') b.transportFail = e;
    else if (e.phase === 'done') b.done = e;
    else if (e.phase === 'error') b.error = e;
  }
  return order.map((id) => map.get(id)!);
}

/** Signature for collapsing visually-identical consecutive blocks. */
function blockSignature(b: Block): string {
  const status = b.error?.status ?? b.done?.status ?? '…';
  const tf = b.transportFail ? (b.transportFail.fellBack ? 'tf-direct' : 'tf-block') : '';
  return `${b.start?.method}|${b.start?.path}|${b.start?.model}|${b.account?.accountLabel}|${tf}|${status}`;
}

interface CollapsedBlock {
  block: Block;
  count: number;
}

/** Collapse consecutive identical blocks into one with a count. The latest
 *  block of a run is kept (freshest timestamp); count shows how many repeats. */
function collapseBlocks(blocks: Block[]): CollapsedBlock[] {
  const out: CollapsedBlock[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (last && blockSignature(last.block) === blockSignature(b)) {
      last.count++;
      last.block = b;
    } else {
      out.push({ block: b, count: 1 });
    }
  }
  return out;
}

export function ConsoleBlocks({ events, collapse = false }: { events: FlowEvent[]; collapse?: boolean }) {
  const collapsed = useMemo(() => {
    const blocks = groupBlocks(events);
    const out = collapse ? collapseBlocks(blocks) : blocks.map((block) => ({ block, count: 1 }));
    // Newest on top: blocks arrive in insertion order, so render reversed.
    return out.slice().reverse();
  }, [events, collapse]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggle = (reqId: string) => setExpanded((cur) => (cur === reqId ? null : reqId));
  return (
    <div class="console-box">
      {collapsed.map(({ block: b, count }) => {
        const failed = b.error || (b.done && b.done.status >= 400);
        const isOpen = expanded === b.reqId;
        return (
          <div class="console-block" key={b.reqId}>
            {b.start && (
              <div
                class="console-line console-head"
                role="button"
                tabIndex={0}
                onClick={() => toggle(b.reqId)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(b.reqId); } }}
                title="Click for request detail"
              >
                <span class="console-reqid">#{b.reqId}</span> → {b.start.method} {b.start.path}{' '}
                {b.start.alias ? `${b.start.alias}→${b.start.model}` : b.start.model}
                {count > 1 && <span class="console-count">×{count}</span>}
                <span class="console-time">{relativeTime(b.start.ts)}</span>
              </div>
            )}
            {b.account && (
              <div class="console-line console-sub">
                ⤷ account: {b.account.accountLabel} ({b.account.reason})
              </div>
            )}
            {b.transport && (
              <div class="console-line console-sub">
                ⤷ {b.transport.kind}: {b.transport.label}
              </div>
            )}
            {b.transportFail && (
              <div class="console-line console-err">
                ⤷ {b.transportFail.fellBack ? 'proxy failed → direct' : 'proxy blocked'}:{' '}
                {b.transportFail.message}
              </div>
            )}
            {b.done && (
              <div class={`console-line ${failed ? 'console-err' : 'console-ok'}`}>
                {failed ? '✗' : '✓'} in {fmtTokens(b.done.inTok)} out {fmtTokens(b.done.outTok)} cache{' '}
                {fmtTokens(b.done.cacheTok)} ${b.done.costUsd.toFixed(4)} {fmtLatency(b.done.latencyMs)}
                {b.done.rtkSaved > 0 ? ` saved ${fmtTokens(b.done.rtkSaved)}` : ''} · {b.done.status}
              </div>
            )}
            {b.error && (
              <div class="console-line console-err">
                ✗ {b.error.status} {b.error.message}
              </div>
            )}
            {isOpen && <ConsoleBlockDetail reqId={b.reqId} />}
          </div>
        );
      })}
    </div>
  );
}

const MAX_EVENTS = 600; // ~200 request blocks

export function Console() {
  const [events, setEvents] = useState<FlowEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [collapse, setCollapse] = useState(false);
  const [connected, setConnected] = useState(false);
  const [filterModel, setFilterModel] = useState('');
  const [filterAccount, setFilterAccount] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'success' | 'error'>('all');
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const boxRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  // RAF-batched event buffer. Decouples SSE message rate from React renders.
  const pendingRef = useRef<FlowEvent[]>([]);
  const rafRef = useRef<number | null>(null);
  const flush = () => {
    rafRef.current = null;
    if (pendingRef.current.length === 0) return;
    const batch = pendingRef.current;
    pendingRef.current = [];
    setEvents((prev) => {
      const next = prev.length + batch.length > MAX_EVENTS ? [...prev, ...batch] : [...prev, ...batch];
      return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
    });
  };

  useEffect(() => {
    const es = new EventSource('/api/admin/console/stream');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      if (!m.data || pausedRef.current) return;
      try {
        const ev = JSON.parse(m.data) as FlowEvent;
        // Buffer the event; flush on the next animation frame so bursts of
        // SSE messages collapse into one setState per frame (~16ms).
        pendingRef.current.push(ev);
        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(flush);
        }
      } catch {
        /* heartbeat / malformed */
      }
    };
    return () => {
      es.close();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    if (stickRef.current && boxRef.current) {
      // Newest on top: stick to the top of the scroll container.
      boxRef.current.scrollTop = 0;
    }
  }, [events]);

  const filteredEvents = useMemo(() => {
    if (!filterModel && !filterAccount && filterStatus === 'all') return events;

    const blocks = new Map<string, FlowEvent[]>();
    for (const e of events) {
      const list = blocks.get(e.reqId) ?? [];
      list.push(e);
      blocks.set(e.reqId, list);
    }

    const allowedReqIds = new Set<string>();
    for (const [reqId, evts] of blocks) {
      const start = evts.find((e) => e.phase === 'start') as Extract<FlowEvent, { phase: 'start' }> | undefined;
      const account = evts.find((e) => e.phase === 'account') as Extract<FlowEvent, { phase: 'account' }> | undefined;
      const done = evts.find((e) => e.phase === 'done') as Extract<FlowEvent, { phase: 'done' }> | undefined;
      const error = evts.find((e) => e.phase === 'error');

      if (filterModel && start && !start.model?.toLowerCase().includes(filterModel.toLowerCase())) continue;
      if (filterAccount && account && !account.accountLabel?.toLowerCase().includes(filterAccount.toLowerCase())) continue;
      if (filterStatus === 'success' && (error || (done && done.status >= 400))) continue;
      if (filterStatus === 'error' && !error && (!done || done.status < 400)) continue;

      allowedReqIds.add(reqId);
    }

    return events.filter((e) => allowedReqIds.has(e.reqId));
  }, [events, filterModel, filterAccount, filterStatus]);

  return (
    <div>
      <TopBar
        title="Console"
        eyebrow="live request flow"
        actions={
          <div class="console-controls">
            <span class={`console-dot ${connected ? 'live' : 'down'}`} />
            <span class="console-status">{connected ? 'live' : 'reconnecting…'}</span>
            <Button variant="ghost" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button variant="ghost" aria-pressed={collapse} onClick={() => setCollapse((c) => !c)}>
              {collapse ? 'Collapse: on' : 'Collapse: off'}
            </Button>
            <Button variant="ghost" aria-label="Clear all events" onClick={() => setEvents([])}>
              Clear
            </Button>
          </div>
        }
      />
      <div style={{ display: 'flex', gap: 8, padding: '8px 16px', borderBottom: '1px solid var(--border, rgba(255,255,255,0.06))' }}>
        <input
          type="text"
          placeholder="Filter model…"
          aria-label="Filter by model"
          value={filterModel}
          onInput={(e) => setFilterModel((e.target as HTMLInputElement).value)}
          class="input"
          style={{ maxWidth: 160, padding: '4px 8px', fontSize: 12 }}
        />
        <input
          type="text"
          placeholder="Filter account…"
          aria-label="Filter by account"
          value={filterAccount}
          onInput={(e) => setFilterAccount((e.target as HTMLInputElement).value)}
          class="input"
          style={{ maxWidth: 140, padding: '4px 8px', fontSize: 12 }}
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus((e.target as HTMLSelectElement).value as 'all' | 'success' | 'error')}
          style={{ padding: '4px 8px', fontSize: 12 }}
        >
          <option value="all">All status</option>
          <option value="success">Success (2xx/3xx)</option>
          <option value="error">Errors (4xx/5xx)</option>
        </select>
        {(filterModel || filterAccount || filterStatus !== 'all') && (
          <button
            class="btn btn-ghost btn-sm"
            aria-label="Clear all filters"
            onClick={() => { setFilterModel(''); setFilterAccount(''); setFilterStatus('all'); }}
            style={{ fontSize: 11 }}
          >
            Clear
          </button>
        )}
      </div>
      <div
        class="console-scroll"
        ref={boxRef}
        onScroll={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          // Newest is on top: "stick" means the user is near the top of the list.
          stickRef.current = el.scrollTop < 40;
        }}
      >
        <ConsoleBlocks events={filteredEvents} collapse={collapse} />
        {events.length === 0 && <div class="console-empty">Waiting for requests…</div>}
      </div>
    </div>
  );
}
