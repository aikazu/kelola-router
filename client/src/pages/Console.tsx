import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Button } from '../components/Button';
import { TopBar } from '../layout/TopBar';

export type FlowEvent =
  | { phase: 'start'; reqId: string; ts: string; method: string; path: string; model: string; alias: string | null }
  | { phase: 'account'; reqId: string; ts: string; accountLabel: string; reason: string }
  | { phase: 'transport'; reqId: string; ts: string; kind: string; label: string }
  | { phase: 'done'; reqId: string; ts: string; status: number; ttftMs: number | null; inTok: number; outTok: number; cacheTok: number; costUsd: number; latencyMs: number }
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
    else if (e.phase === 'done') b.done = e;
    else if (e.phase === 'error') b.error = e;
  }
  return order.map((id) => map.get(id)!);
}

export function ConsoleBlocks({ events }: { events: FlowEvent[] }) {
  const blocks = useMemo(() => groupBlocks(events), [events]);
  return (
    <div class="console-box">
      {blocks.map((b) => {
        const failed = b.error || (b.done && b.done.status >= 400);
        return (
          <div class="console-block" key={b.reqId}>
            {b.start && (
              <div class="console-line">
                <span class="console-reqid">#{b.reqId}</span> → {b.start.method} {b.start.path}{' '}
                {b.start.alias ? `${b.start.alias}→${b.start.model}` : b.start.model}
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
            {b.done && (
              <div class={`console-line ${failed ? 'console-err' : 'console-ok'}`}>
                {failed ? '✗' : '✓'} in {fmtTokens(b.done.inTok)} out {fmtTokens(b.done.outTok)} cache{' '}
                {fmtTokens(b.done.cacheTok)} ${b.done.costUsd.toFixed(4)} {fmtLatency(b.done.latencyMs)} · {b.done.status}
              </div>
            )}
            {b.error && (
              <div class="console-line console-err">
                ✗ {b.error.status} {b.error.message}
              </div>
            )}
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
  const [connected, setConnected] = useState(false);
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
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [events]);

  return (
    <div>
      <TopBar
        title="Console"
        eyebrow="live request flow"
        actions={
          <div class="console-controls">
            <span class={`console-dot ${connected ? 'live' : 'down'}`} />
            <span class="console-status">{connected ? 'live' : 'reconnecting…'}</span>
            <Button variant="ghost" onClick={() => setPaused((p) => !p)}>
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button variant="ghost" onClick={() => setEvents([])}>
              Clear
            </Button>
          </div>
        }
      />
      <div
        class="console-scroll"
        ref={boxRef}
        onScroll={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        <ConsoleBlocks events={events} />
        {events.length === 0 && <div class="console-empty">Waiting for requests…</div>}
      </div>
    </div>
  );
}
