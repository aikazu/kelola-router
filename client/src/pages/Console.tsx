import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Button } from '../components/Button';
import { TopBar } from '../layout/TopBar';
import { apiFetch } from '../lib/api';
import { relativeTime } from '../lib/relativeTime';

/* ============================================================================
   Signature page — rack-mount request flow console.
   Builds on the foundation tokens. Data flows unchanged from SSE; only the
   presentation layer (header strip, waveform, stat strip, LED rails) is new.
   ============================================================================ */

const WAVE_BUCKETS = 60; // 60 × 1s = 60s rolling window
const WAVE_BUCKET_MS = 1000;
const SLOW_LATENCY_MS = 1500; // threshold for "slow" latency highlighting

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
function fmtLatency(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
function fmtClock(iso: string): string {
  if (!iso) return '--:--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

interface WaveformProps {
  events: FlowEvent[];
  now: number;
}

/** 60s rolling waveform: 60 vertical bars, one per 1s bucket, height ∝
 *  number of `start` events in that bucket. Bars fade older (gold-bright →
 *  gold-dim) so the eye reads the leading edge. */
function Waveform({ events, now }: WaveformProps) {
  const counts = useMemo(() => {
    const arr = new Array<number>(WAVE_BUCKETS).fill(0);
    for (const e of events) {
      if (e.phase !== 'start' || !e.ts) continue;
      const t = Date.parse(e.ts);
      if (Number.isNaN(t)) continue;
      const ageMs = now - t;
      if (ageMs < 0 || ageMs >= WAVE_BUCKETS * WAVE_BUCKET_MS) continue;
      const idx = WAVE_BUCKETS - 1 - Math.floor(ageMs / WAVE_BUCKET_MS);
      if (idx >= 0 && idx < WAVE_BUCKETS) arr[idx]++;
    }
    return arr;
  }, [events, now]);

  const peak = Math.max(1, ...counts);
  const totalInWindow = counts.reduce((a, b) => a + b, 0);

  return (
    <div class="console-wave">
      <div class="console-wave-track" role="img" aria-label="request rate over last 60 seconds">
        {counts.map((c, i) => {
          // Map bucket index → recency 0 (oldest) .. 1 (newest). Fade the
          // tail so the eye reads motion at the leading edge.
          const recency = i / (WAVE_BUCKETS - 1);
          const h = c === 0 ? 2 : Math.max(4, Math.round((c / peak) * 100));
          const has = c > 0;
          const style: Record<string, string> = {
            height: `${h}%`,
            opacity: has ? (0.35 + 0.65 * recency).toFixed(2) : '0.18',
          };
          return (
            <span key={`b-${i}`} class={`console-wave-bar ${has ? 'has' : 'idle'}`} style={style} />
          );
        })}
      </div>
      {totalInWindow === 0 && <div class="console-wave-hint">awaiting traffic</div>}
    </div>
  );
}

interface StatStripProps {
  events: FlowEvent[];
  now: number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

/** Inline stat strip — numbers from real events in the 60s window. If a metric
 *  can't be computed (no data), it's omitted instead of showing a lying 0. */
function StatStrip({ events, now }: StatStripProps) {
  const stats = useMemo(() => {
    const windowMs = WAVE_BUCKETS * WAVE_BUCKET_MS;
    let startsInWindow = 0;
    let inFlight = 0;
    let errCount = 0;
    const latencies: number[] = [];
    for (const e of events) {
      if (e.phase === 'start' && e.ts) {
        const t = Date.parse(e.ts);
        if (!Number.isNaN(t) && now - t >= 0 && now - t < windowMs) startsInWindow++;
      } else if (e.phase === 'done') {
        const t = e.ts ? Date.parse(e.ts) : now;
        if (!Number.isNaN(t) && now - t < windowMs) {
          latencies.push(e.latencyMs);
          if (e.status >= 400) errCount++;
        }
      } else if (e.phase === 'error') {
        const t = e.ts ? Date.parse(e.ts) : now;
        if (!Number.isNaN(t) && now - t < windowMs) errCount++;
      }
    }
    // in-flight = started in window without a matching done/error yet.
    const settled = new Set<string>();
    for (const e of events) {
      if (e.phase === 'done' || e.phase === 'error') settled.add(e.reqId);
    }
    for (const e of events) {
      if (e.phase !== 'start' || !e.ts) continue;
      const t = Date.parse(e.ts);
      if (Number.isNaN(t)) continue;
      if (now - t < 0 || now - t >= windowMs) continue;
      if (!settled.has(e.reqId)) inFlight++;
    }

    const reqPerSec = startsInWindow / (windowMs / 1000);
    const p50 = median(latencies);
    const decided = latencies.length + errCount;
    const errPct = decided === 0 ? 0 : (errCount / decided) * 100;

    const parts: Array<{ label: string; value: string; tone?: 'crit' | 'gold' }> = [];
    if (startsInWindow > 0) {
      parts.push({
        label: 'req/s',
        value: reqPerSec >= 10 ? reqPerSec.toFixed(1) : reqPerSec.toFixed(2),
        tone: 'gold',
      });
    }
    if (inFlight > 0) {
      parts.push({ label: 'active', value: String(inFlight), tone: 'gold' });
    }
    if (latencies.length > 0) {
      parts.push({
        label: 'p50',
        value: fmtLatency(p50),
        tone: p50 >= SLOW_LATENCY_MS ? 'crit' : 'gold',
      });
    }
    if (decided > 0) {
      parts.push({
        label: 'err',
        value: `${errPct.toFixed(1)}%`,
        tone: errPct > 0 ? 'crit' : 'gold',
      });
    }
    return parts;
  }, [events, now]);

  if (stats.length === 0) return null;

  return (
    /* biome-ignore lint/a11y/useSemanticElements: flat stat strip has no native semantic element; role=group gives the labeled collection an accessible name */
    <div class="console-stats" role="group" aria-label="request flow statistics">
      {stats.map((s, i) => (
        <span class="console-stat" key={s.label}>
          {i > 0 && <span class="console-stat-sep">·</span>}
          <span class={`console-stat-val console-stat-val--${s.tone ?? 'gold'}`}>{s.value}</span>
          <span class="console-stat-label">{s.label}</span>
        </span>
      ))}
    </div>
  );
}

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
    queryFn: () => apiFetch<RequestLogDetail>(`/api/admin/request-logs/by-req-id/${reqId}`),
    staleTime: 30_000,
    retry: false,
  });
  if (isLoading) return <div class="console-detail">loading…</div>;
  if (isError || !data) return <div class="console-detail">no persisted log for this request</div>;
  return (
    <div class="console-detail">
      <div>
        account: {data.accountId ?? '—'} · client-key: {data.clientKeyId ?? '—'}
      </div>
      <div>
        model: {data.requestedModel ?? '—'} · {data.endpoint} ·{' '}
        {data.stream ? 'stream' : 'buffered'}
      </div>
      <div>
        tokens: in {data.promptTokens} out {data.completionTokens} cache {data.cacheReadTokens}/
        {data.cacheCreationTokens} total {data.totalTokens}
      </div>
      <div>
        cost ${data.cost.toFixed(6)} · latency {data.latencyMs}ms · rtk saved {data.rtkBytesSaved}B
      </div>
      <div>
        body sizes: req {byteLen(data.requestBody)}B · resp {byteLen(data.responseBody)}B
      </div>
      {data.error && <div class="console-err">error: {data.error}</div>}
    </div>
  );
}

export type FlowEvent =
  | {
      phase: 'start';
      reqId: string;
      ts: string;
      method: string;
      path: string;
      model: string;
      alias: string | null;
    }
  | { phase: 'account'; reqId: string; ts: string; accountLabel: string; reason: string }
  | { phase: 'transport'; reqId: string; ts: string; kind: string; label: string }
  | { phase: 'transport-fail'; reqId: string; ts: string; fellBack: boolean; message: string }
  | {
      phase: 'done';
      reqId: string;
      ts: string;
      status: number;
      ttftMs: number | null;
      inTok: number;
      outTok: number;
      cacheTok: number;
      costUsd: number;
      latencyMs: number;
      rtkSaved: number;
    }
  | { phase: 'error'; reqId: string; ts: string; status: number; message: string };

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
  return order.map((id) => {
    const b = map.get(id);
    // groupBlocks only inserts into `map` before pushing the id onto `order`,
    // so by construction every id in `order` resolves to a defined block.
    if (!b) throw new Error(`internal: missing block for reqId ${id}`);
    return b;
  });
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

export function ConsoleBlocks({
  events,
  collapse = false,
}: {
  events: FlowEvent[];
  collapse?: boolean;
}) {
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
        const settled = !!(b.done || b.error);
        const inFlight = !!(b.start && !settled);
        const errored = !!failed;
        const ledKind: 'errored' | 'active' | 'idle' = errored
          ? 'errored'
          : inFlight
            ? 'active'
            : 'idle';
        const provider = (b.account?.accountLabel ?? b.transport?.label ?? '—').toUpperCase();
        const doneStatus = b.done?.status ?? b.error?.status ?? null;
        const latencyMs = b.done?.latencyMs ?? null;
        const slow = latencyMs !== null && latencyMs >= SLOW_LATENCY_MS;
        const statusClass =
          doneStatus === null
            ? ''
            : doneStatus >= 500
              ? 'status-crit'
              : doneStatus >= 400
                ? 'status-warn'
                : 'status-ok';
        const isOpen = expanded === b.reqId;
        return (
          <div class="console-block" key={b.reqId}>
            {b.start && (
              // biome-ignore lint/a11y/useSemanticElements: console log line IS the click affordance
              <div
                class={`console-line console-head console-row console-row--${ledKind}`}
                role="button"
                tabIndex={0}
                onClick={() => toggle(b.reqId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle(b.reqId);
                  }
                }}
                title="Click for request detail"
              >
                <span class={`console-row-led console-row-led--${ledKind}`} aria-hidden="true" />
                <span class="console-row-ts">{fmtClock(b.start.ts)}</span>
                <span class="console-row-provider">{provider}</span>
                <span class="console-row-method">
                  <span class="console-row-reqid">#{b.reqId}</span> {b.start.method} {b.start.path}{' '}
                  {b.start.alias ? `${b.start.alias}→${b.start.model}` : b.start.model}
                  {count > 1 && <span class="console-count">×{count}</span>}
                </span>
                <span class="console-row-time">{relativeTime(b.start.ts)}</span>
                <span class={`console-row-latency ${slow ? 'is-slow' : ''}`}>
                  {latencyMs !== null ? fmtLatency(latencyMs) : '—'}
                </span>
                <span class={`console-row-status ${statusClass}`}>
                  {doneStatus !== null ? doneStatus : '…'}
                </span>
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
                {failed ? '✗' : '✓'} in {fmtTokens(b.done.inTok)} out {fmtTokens(b.done.outTok)}{' '}
                cache {fmtTokens(b.done.cacheTok)} ${b.done.costUsd.toFixed(4)}{' '}
                {fmtLatency(b.done.latencyMs)}
                {b.done.rtkSaved > 0 ? ` saved ${fmtTokens(b.done.rtkSaved)}` : ''} ·{' '}
                {b.done.status}
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
  // Single 1Hz tick — drives the rolling waveform and stat-strip windows.
  const [now, setNow] = useState<number>(() => Date.now());
  // RAF-batched event buffer. Decouples SSE message rate from React renders.
  const pendingRef = useRef<FlowEvent[]>([]);
  const rafRef = useRef<number | null>(null);
  const flush = () => {
    rafRef.current = null;
    if (pendingRef.current.length === 0) return;
    const batch = pendingRef.current;
    pendingRef.current = [];
    setEvents((prev) => {
      const next =
        prev.length + batch.length > MAX_EVENTS ? [...prev, ...batch] : [...prev, ...batch];
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

  // Drive waveform + stat strip windows. 1Hz is enough resolution for a 60s
  // view; the keyframe animations already gate on prefers-reduced-motion.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

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
      const start = evts.find((e) => e.phase === 'start') as
        | Extract<FlowEvent, { phase: 'start' }>
        | undefined;
      const account = evts.find((e) => e.phase === 'account') as
        | Extract<FlowEvent, { phase: 'account' }>
        | undefined;
      const done = evts.find((e) => e.phase === 'done') as
        | Extract<FlowEvent, { phase: 'done' }>
        | undefined;
      const error = evts.find((e) => e.phase === 'error');

      if (filterModel && start && !start.model?.toLowerCase().includes(filterModel.toLowerCase()))
        continue;
      if (
        filterAccount &&
        account &&
        !account.accountLabel?.toLowerCase().includes(filterAccount.toLowerCase())
      )
        continue;
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
            <span
              class={`dot ${connected ? 'dot--active dot--pulse' : 'dot--idle'}`}
              aria-hidden="true"
            />
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
      <div class="console-meter">
        <Waveform events={events} now={now} />
        <StatStrip events={events} now={now} />
      </div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '8px 16px',
          borderBottom: '1px solid var(--border, rgba(255,255,255,0.06))',
        }}
      >
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
          onChange={(e) =>
            setFilterStatus((e.target as HTMLSelectElement).value as 'all' | 'success' | 'error')
          }
          style={{ padding: '4px 8px', fontSize: 12 }}
        >
          <option value="all">All status</option>
          <option value="success">Success (2xx/3xx)</option>
          <option value="error">Errors (4xx/5xx)</option>
        </select>
        {(filterModel || filterAccount || filterStatus !== 'all') && (
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            aria-label="Clear all filters"
            onClick={() => {
              setFilterModel('');
              setFilterAccount('');
              setFilterStatus('all');
            }}
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
        {events.length === 0 && (
          <div class="console-empty">No traffic yet — requests will appear here in real time.</div>
        )}
      </div>
    </div>
  );
}
