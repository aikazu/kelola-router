# Live Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream the per-request proxy flow live to a dashboard "Console" page and emit the same pretty phase-stepped lines to server stdout.

**Architecture:** A single in-process bus (`src/console/`) receives `FlowEvent`s emitted at four pipeline phases (start, account, transport, done/error) from both proxy paths. Two sinks consume the bus: a stdout sink (colored ANSI lines) and an SSE endpoint (`GET /api/admin/console/stream`) that a Preact `Console.tsx` page reads via `EventSource`. A 200-event ring buffer backfills freshly-connected clients.

**Tech Stack:** Node 20, Hono, better-sqlite3, Preact + @tanstack/react-query, Vitest, TypeScript strict (no `any`).

---

## File Structure

New (server):
- `src/console/types.ts` — `FlowEvent` discriminated union.
- `src/console/bus.ts` — `ConsoleBus` singleton (emit / subscribe / recent + ring buffer).
- `src/console/format.ts` — `renderStdout(ev)` pure ANSI renderer.
- `src/console/flow.ts` — `genReqId()` + helpers `startFlow/flowAccount/flowTransport/flowDone/flowError`.
- `src/console/sink.ts` — `attachStdoutSink()` (subscribe → write stdout, env-gated).
- `src/db/migrations/004-reqid.ts` — additive `req_id` column.

New (server tests):
- `src/console/bus.test.ts`, `src/console/format.test.ts`, `src/console/flow.test.ts`
- `tests/console/sse.test.ts` — SSE endpoint integration.

New (client):
- `client/src/pages/Console.tsx`

Modified:
- `src/server.ts` — emit phases in `handleProxy` + `handleKiroProxy`; register SSE route; call `attachStdoutSink()` at startup; pass `req_id` to log insert.
- `src/db/repos/requestLogs.ts` — add `req_id` field.
- `src/db/migrations/index.ts` — register migration 004.
- `client/src/components/Icon.tsx` — add `terminal` icon.
- `client/src/layout/Sidebar.tsx` — nav item.
- `client/src/layout/AppShell.tsx` — route, switch, hotkey, help modal.
- `client/src/components/CommandPalette.tsx` — palette item.
- `client/src/styles/components.css` — console styles.
- `CLAUDE.md` — document console module + page.

---

## Task 1: FlowEvent types

**Files:**
- Create: `src/console/types.ts`
- Test: (none — pure type file, exercised by later tests)

- [ ] **Step 1: Write the type file**

```ts
// src/console/types.ts
export type FlowReason = 'sticky' | 'round-robin' | 'fallback';
export type TransportKind = 'proxy' | 'relay' | 'direct';

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
  | { phase: 'account'; reqId: string; ts: string; accountLabel: string; reason: FlowReason }
  | { phase: 'transport'; reqId: string; ts: string; kind: TransportKind; label: string }
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
    }
  | { phase: 'error'; reqId: string; ts: string; status: number; message: string };
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no usages yet).

- [ ] **Step 3: Commit**

```bash
git add src/console/types.ts
git commit -m "feat(console): FlowEvent types"
```

---

## Task 2: ConsoleBus + ring buffer

**Files:**
- Create: `src/console/bus.ts`
- Test: `src/console/bus.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/console/bus.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleBus } from './bus.js';
import type { FlowEvent } from './types.js';

function ev(reqId: string): FlowEvent {
  return { phase: 'start', reqId, ts: '2026-06-09T00:00:00.000Z', method: 'POST', path: '/v1/messages', model: 'm', alias: null };
}

describe('ConsoleBus', () => {
  let bus: ConsoleBus;
  beforeEach(() => {
    bus = new ConsoleBus(3); // small cap for test
  });

  it('delivers emitted events to subscribers', () => {
    const seen: FlowEvent[] = [];
    bus.subscribe((e) => seen.push(e));
    bus.emit(ev('a'));
    expect(seen).toHaveLength(1);
    expect(seen[0].reqId).toBe('a');
  });

  it('unsubscribe stops delivery', () => {
    const fn = vi.fn();
    const off = bus.subscribe(fn);
    off();
    bus.emit(ev('a'));
    expect(fn).not.toHaveBeenCalled();
  });

  it('recent() returns buffered events oldest->newest, capped', () => {
    bus.emit(ev('a'));
    bus.emit(ev('b'));
    bus.emit(ev('c'));
    bus.emit(ev('d')); // evicts 'a'
    expect(bus.recent().map((e) => e.reqId)).toEqual(['b', 'c', 'd']);
  });

  it('a throwing subscriber does not break others', () => {
    const good = vi.fn();
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe(good);
    bus.emit(ev('a'));
    expect(good).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/console/bus.test.ts`
Expected: FAIL — cannot find module `./bus.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/console/bus.ts
import type { FlowEvent } from './types.js';

type Subscriber = (ev: FlowEvent) => void;

export class ConsoleBus {
  private buffer: FlowEvent[] = [];
  private subs = new Set<Subscriber>();
  constructor(private readonly cap = 200) {}

  emit(ev: FlowEvent): void {
    this.buffer.push(ev);
    if (this.buffer.length > this.cap) this.buffer.shift();
    for (const fn of this.subs) {
      try {
        fn(ev);
      } catch {
        // a broken subscriber must not break emission for the rest
      }
    }
  }

  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }

  recent(): FlowEvent[] {
    return [...this.buffer];
  }
}

export const consoleBus = new ConsoleBus();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/console/bus.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/console/bus.ts src/console/bus.test.ts
git commit -m "feat(console): event bus with ring buffer"
```

---

## Task 3: stdout renderer

**Files:**
- Create: `src/console/format.ts`
- Test: `src/console/format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/console/format.test.ts
import { describe, expect, it } from 'vitest';
import { fmtTokens, renderStdout, stripAnsi } from './format.js';
import type { FlowEvent } from './types.js';

const TS = '2026-06-09T12:04:31.000Z';

describe('fmtTokens', () => {
  it('formats thousands with k suffix', () => {
    expect(fmtTokens(1200)).toBe('1.2k');
    expect(fmtTokens(340)).toBe('340');
    expect(fmtTokens(0)).toBe('0');
  });
});

describe('renderStdout', () => {
  it('renders a start line with reqId, method, path, model', () => {
    const ev: FlowEvent = { phase: 'start', reqId: 'a3f2', ts: TS, method: 'POST', path: '/v1/messages', model: 'claude-sonnet-4', alias: null };
    expect(stripAnsi(renderStdout(ev))).toBe('#a3f2 → POST /v1/messages claude-sonnet-4');
  });

  it('renders alias when present', () => {
    const ev: FlowEvent = { phase: 'start', reqId: 'a3f2', ts: TS, method: 'POST', path: '/v1/messages', model: 'claude-sonnet-4', alias: 'sonnet' };
    expect(stripAnsi(renderStdout(ev))).toBe('#a3f2 → POST /v1/messages sonnet→claude-sonnet-4');
  });

  it('renders account line', () => {
    const ev: FlowEvent = { phase: 'account', reqId: 'a3f2', ts: TS, accountLabel: 'kiro1', reason: 'round-robin' };
    expect(stripAnsi(renderStdout(ev))).toBe('  ⤷ account: kiro1 (round-robin)');
  });

  it('renders transport line', () => {
    const ev: FlowEvent = { phase: 'transport', reqId: 'a3f2', ts: TS, kind: 'proxy', label: 'us-1' };
    expect(stripAnsi(renderStdout(ev))).toBe('  ⤷ proxy: us-1');
  });

  it('renders done line', () => {
    const ev: FlowEvent = { phase: 'done', reqId: 'a3f2', ts: TS, status: 200, ttftMs: 480, inTok: 1200, outTok: 340, cacheTok: 800, costUsd: 0.004, latencyMs: 1400 };
    expect(stripAnsi(renderStdout(ev))).toBe('  ✓ in 1.2k out 340 cache 800 $0.0040 1.4s · 200');
  });

  it('renders error line', () => {
    const ev: FlowEvent = { phase: 'error', reqId: 'a3f2', ts: TS, status: 429, message: 'rate limited' };
    expect(stripAnsi(renderStdout(ev))).toBe('  ✗ 429 rate limited');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/console/format.test.ts`
Expected: FAIL — cannot find module `./format.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/console/format.ts
import type { FlowEvent } from './types.js';

const C = {
  reset: '\x1b[0m',
  gold: '\x1b[38;5;179m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
};

const ANSI_RE = /\x1b\[[0-9;]*m/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtLatency(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function renderStdout(ev: FlowEvent): string {
  switch (ev.phase) {
    case 'start': {
      const model = ev.alias ? `${ev.alias}→${ev.model}` : ev.model;
      return `${C.gold}#${ev.reqId}${C.reset} → ${ev.method} ${ev.path} ${model}`;
    }
    case 'account':
      return `  ${C.dim}⤷${C.reset} account: ${ev.accountLabel} (${ev.reason})`;
    case 'transport':
      return `  ${C.dim}⤷${C.reset} ${ev.kind}: ${ev.label}`;
    case 'done': {
      const col = ev.status >= 400 ? C.red : C.green;
      const mark = ev.status >= 400 ? '✗' : '✓';
      return `  ${col}${mark}${C.reset} in ${fmtTokens(ev.inTok)} out ${fmtTokens(ev.outTok)} cache ${fmtTokens(ev.cacheTok)} $${ev.costUsd.toFixed(4)} ${fmtLatency(ev.latencyMs)} · ${ev.status}`;
    }
    case 'error':
      return `  ${C.red}✗${C.reset} ${ev.status} ${ev.message}`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/console/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/console/format.ts src/console/format.test.ts
git commit -m "feat(console): stdout ANSI renderer"
```

---

## Task 4: flow helpers + reqId

**Files:**
- Create: `src/console/flow.ts`
- Test: `src/console/flow.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/console/flow.test.ts
import { describe, expect, it } from 'vitest';
import { ConsoleBus } from './bus.js';
import { buildAccount, buildDone, buildError, buildStart, buildTransport, genReqId } from './flow.js';

describe('genReqId', () => {
  it('returns a short hex id', () => {
    const id = genReqId();
    expect(id).toMatch(/^[0-9a-f]{4,8}$/);
  });
  it('returns distinct ids', () => {
    expect(genReqId()).not.toBe(genReqId());
  });
});

describe('build* helpers', () => {
  const ts = '2026-06-09T00:00:00.000Z';
  it('buildStart', () => {
    expect(buildStart('a', ts, 'POST', '/v1/messages', 'm', 'al')).toEqual({
      phase: 'start', reqId: 'a', ts, method: 'POST', path: '/v1/messages', model: 'm', alias: 'al',
    });
  });
  it('buildDone', () => {
    expect(buildDone('a', ts, 200, 100, 1, 2, 3, 0.5, 999)).toEqual({
      phase: 'done', reqId: 'a', ts, status: 200, ttftMs: 100, inTok: 1, outTok: 2, cacheTok: 3, costUsd: 0.5, latencyMs: 999,
    });
  });
  it('emits onto a bus', () => {
    const bus = new ConsoleBus();
    bus.emit(buildAccount('a', ts, 'kiro1', 'sticky'));
    bus.emit(buildTransport('a', ts, 'proxy', 'us-1'));
    bus.emit(buildError('a', ts, 500, 'boom'));
    expect(bus.recent().map((e) => e.phase)).toEqual(['account', 'transport', 'error']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/console/flow.test.ts`
Expected: FAIL — cannot find module `./flow.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/console/flow.ts
import { randomBytes } from 'node:crypto';
import type { FlowEvent, FlowReason, TransportKind } from './types.js';

export function genReqId(): string {
  return randomBytes(2).toString('hex');
}

export function buildStart(
  reqId: string, ts: string, method: string, path: string, model: string, alias: string | null
): FlowEvent {
  return { phase: 'start', reqId, ts, method, path, model, alias };
}

export function buildAccount(reqId: string, ts: string, accountLabel: string, reason: FlowReason): FlowEvent {
  return { phase: 'account', reqId, ts, accountLabel, reason };
}

export function buildTransport(reqId: string, ts: string, kind: TransportKind, label: string): FlowEvent {
  return { phase: 'transport', reqId, ts, kind, label };
}

export function buildDone(
  reqId: string, ts: string, status: number, ttftMs: number | null,
  inTok: number, outTok: number, cacheTok: number, costUsd: number, latencyMs: number
): FlowEvent {
  return { phase: 'done', reqId, ts, status, ttftMs, inTok, outTok, cacheTok, costUsd, latencyMs };
}

export function buildError(reqId: string, ts: string, status: number, message: string): FlowEvent {
  return { phase: 'error', reqId, ts, status, message: message.slice(0, 200) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/console/flow.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/console/flow.ts src/console/flow.test.ts
git commit -m "feat(console): flow event builders + reqId"
```

---

## Task 5: stdout sink

**Files:**
- Create: `src/console/sink.ts`
- Test: `src/console/sink.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/console/sink.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleBus } from './bus.js';
import { attachStdoutSink } from './sink.js';
import type { FlowEvent } from './types.js';

const ev: FlowEvent = { phase: 'start', reqId: 'a', ts: '2026-06-09T00:00:00.000Z', method: 'POST', path: '/v1/messages', model: 'm', alias: null };

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CONSOLE_FLOW;
});

describe('attachStdoutSink', () => {
  it('writes a rendered line per event when enabled', () => {
    const bus = new ConsoleBus();
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    attachStdoutSink(bus);
    bus.emit(ev);
    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0][0])).toContain('#a');
  });

  it('suppresses output when CONSOLE_FLOW=0', () => {
    process.env.CONSOLE_FLOW = '0';
    const bus = new ConsoleBus();
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    attachStdoutSink(bus);
    bus.emit(ev);
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/console/sink.test.ts`
Expected: FAIL — cannot find module `./sink.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/console/sink.ts
import { consoleBus, type ConsoleBus } from './bus.js';
import { renderStdout } from './format.js';

/** Subscribe a stdout writer to the bus. Gated by CONSOLE_FLOW (default on). */
export function attachStdoutSink(bus: ConsoleBus = consoleBus): () => void {
  if (process.env.CONSOLE_FLOW === '0') return () => {};
  return bus.subscribe((ev) => {
    process.stdout.write(`${renderStdout(ev)}\n`);
  });
}
```

Note: `bus.ts` already exports `consoleBus`; also export the type. Add to `src/console/bus.ts` if missing:
`export type { ConsoleBus };` is automatic since the class is exported — `import { ConsoleBus }` works. Use `import { consoleBus, ConsoleBus } from './bus.js';` and type the param as `ConsoleBus`.

Correct import line:

```ts
import { ConsoleBus, consoleBus } from './bus.js';
import { renderStdout } from './format.js';

export function attachStdoutSink(bus: ConsoleBus = consoleBus): () => void {
  if (process.env.CONSOLE_FLOW === '0') return () => {};
  return bus.subscribe((ev) => {
    process.stdout.write(`${renderStdout(ev)}\n`);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/console/sink.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/console/sink.ts src/console/sink.test.ts
git commit -m "feat(console): stdout sink (env-gated)"
```

---

## Task 6: migration 004 — req_id column

**Files:**
- Create: `src/db/migrations/004-reqid.ts`
- Modify: `src/db/migrations/index.ts:1-10`
- Test: `tests/db/migration-004.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/db/migration-004.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('migration 004 req_id', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'kr-')), 't.db');
  });
  afterEach(() => {
    delete process.env.ROUTER_DB_PATH;
  });

  it('adds a nullable req_id column to request_logs', async () => {
    const { openDb } = await import('../../src/db/index.js');
    const db = openDb();
    const cols = db.prepare('PRAGMA table_info(request_logs)').all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain('req_id');
    expect(Number(db.pragma('user_version', { simple: true }))).toBeGreaterThanOrEqual(4);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/migration-004.test.ts`
Expected: FAIL — `req_id` not in column list.

- [ ] **Step 3: Write the migration**

```ts
// src/db/migrations/004-reqid.ts
/**
 * Migration 004 — console correlation id.
 * Additive: a nullable req_id on request_logs lets a console flow line link to
 * its Request Detail row. Existing rows stay null.
 */
export const migration_004 = {
  id: 4,
  name: 'request-log-reqid',
  sql: `
    ALTER TABLE request_logs ADD COLUMN req_id TEXT;
  `,
};
```

- [ ] **Step 4: Register it**

In `src/db/migrations/index.ts`, add the import and array entry:

```ts
import { migration_004 } from './004-reqid.js';
```

```ts
const ALL_MIGRATIONS: Array<{ id: number; name: string; sql: string }> = [
  migration_001,
  migration_002,
  migration_003,
  migration_004,
];
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/db/migration-004.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/004-reqid.ts src/db/migrations/index.ts tests/db/migration-004.test.ts
git commit -m "feat(db): migration 004 req_id column"
```

---

## Task 7: requestLogs repo — req_id field

**Files:**
- Modify: `src/db/repos/requestLogs.ts`
- Test: `tests/db/requestlog-reqid.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/db/requestlog-reqid.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('request log req_id round-trip', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'kr-')), 't.db');
  });
  afterEach(() => {
    delete process.env.ROUTER_DB_PATH;
  });

  it('stores and reads back req_id', async () => {
    const { openDb } = await import('../../src/db/index.js');
    const { insertRequestLog, getRequestLogById } = await import('../../src/db/repos/requestLogs.js');
    const db = openDb();
    const id = insertRequestLog(db, {
      client_key_id: null, account_id: null, model: 'm', endpoint: '/v1/messages', format: 'openai',
      prompt_tokens: 1, completion_tokens: 2, cache_creation_tokens: 0, cache_read_tokens: 0,
      total_tokens: 3, cost_usd: 0.1, latency_ms: 10, status_code: 200, stream: 0, rtk_bytes_saved: 0,
      req_id: 'a3f2',
    });
    expect(getRequestLogById(db, id)?.req_id).toBe('a3f2');
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/requestlog-reqid.test.ts`
Expected: FAIL — `req_id` not on the insert type / not persisted.

- [ ] **Step 3: Edit the repo**

In `src/db/repos/requestLogs.ts`:

Add to the `RequestLog` interface (after `error: string | null;`):

```ts
  req_id: string | null;
```

Add `'req_id'` to the `Omit<...>` list and add `req_id?: string | null;` to the intersection in `RequestLogInsert`:

```ts
export type RequestLogInsert = Omit<
  RequestLog,
  | 'id'
  | 'created_at'
  | 'ttft_ms'
  | 'base_resp_code'
  | 'relay_path'
  | 'proxy_path'
  | 'caveman_level'
  | 'error_message'
  | 'request_body'
  | 'response_body'
  | 'request_headers'
  | 'response_headers'
  | 'error'
  | 'requested_model'
  | 'req_id'
> & {
  ttft_ms?: number | null;
  base_resp_code?: number | null;
  relay_path?: string | null;
  proxy_path?: string | null;
  caveman_level?: string | null;
  error_message?: string | null;
  request_body?: string | null;
  response_body?: string | null;
  request_headers?: string | null;
  response_headers?: string | null;
  error?: string | null;
  requested_model?: string | null;
  req_id?: string | null;
};
```

In `insertRequestLog`, add `req_id` to the column list and a matching `?` placeholder, then bind `log.req_id ?? null` as the final value:

```ts
    .prepare(`
    INSERT INTO request_logs (client_key_id, account_id, model, requested_model, endpoint, format, prompt_tokens, completion_tokens,
      cache_creation_tokens, cache_read_tokens, total_tokens, cost_usd, latency_ms, ttft_ms, status_code,
      base_resp_code, stream, relay_path, proxy_path, rtk_bytes_saved, caveman_level, error_message,
      request_body, response_body, request_headers, response_headers, error, req_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
```

And append the bind value after `log.error ?? null`:

```ts
      log.error ?? null,
      log.req_id ?? null
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db/requestlog-reqid.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/repos/requestLogs.ts tests/db/requestlog-reqid.test.ts
git commit -m "feat(db): persist req_id on request logs"
```

---

## Task 8: SSE endpoint

**Files:**
- Modify: `src/server.ts` (imports + new route, registered alongside `/v1/*`)
- Test: `tests/console/sse.test.ts`

Hono's `streamSSE` from `hono/streaming` is used. The route lives directly on the
main app under `requireAdmin` (NOT inside `adminApi()`), because it needs the raw
streaming context and is a GET (no CSRF concern).

- [ ] **Step 1: Write the failing test**

```ts
// tests/console/sse.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('GET /api/admin/console/stream', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'kr-')), 't.db');
  });
  afterEach(async () => {
    const { resetDb } = await import('../../src/server.js');
    resetDb();
    delete process.env.ROUTER_DB_PATH;
  });

  it('streams a backfilled recent event then closes', async () => {
    const { app, resetDb } = await import('../../src/server.js');
    resetDb();
    const { consoleBus } = await import('../../src/console/bus.js');
    consoleBus.emit({
      phase: 'start', reqId: 'seed', ts: '2026-06-09T00:00:00.000Z',
      method: 'POST', path: '/v1/messages', model: 'm', alias: null,
    });

    const res = await app.request('/api/admin/console/stream', {
      headers: { origin: 'http://localhost', host: 'localhost' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('seed');
    await reader.cancel();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/console/sse.test.ts`
Expected: FAIL — route 404 / no such endpoint.

- [ ] **Step 3: Implement the route in `src/server.ts`**

Add imports near the other `hono` imports:

```ts
import { streamSSE } from 'hono/streaming';
import { consoleBus } from './console/bus.js';
import { attachStdoutSink } from './console/sink.js';
import { buildAccount, buildDone, buildError, buildStart, buildTransport, genReqId } from './console/flow.js';
```

Register the route where other top-level routes are defined (alongside the
`/v1/*` registration; locate the existing `app.use('/v1/*', requireApiKey)` /
`app.post('/v1/...')` block and add after it):

```ts
app.get('/api/admin/console/stream', requireAdmin, (c) =>
  streamSSE(c, async (stream) => {
    for (const ev of consoleBus.recent()) {
      await stream.writeSSE({ data: JSON.stringify(ev) });
    }
    let alive = true;
    const off = consoleBus.subscribe((ev) => {
      if (alive) void stream.writeSSE({ data: JSON.stringify(ev) });
    });
    stream.onAbort(() => {
      alive = false;
      off();
    });
    // Heartbeat until aborted.
    while (alive) {
      await stream.sleep(15000);
      if (alive) await stream.writeSSE({ data: '', event: 'ping' });
    }
  })
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/console/sse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts tests/console/sse.test.ts
git commit -m "feat(console): SSE stream endpoint"
```

---

## Task 9: emit phases from handleProxy (MiniMax)

**Files:**
- Modify: `src/server.ts` — inside `handleProxy`.
- Test: covered by the SSE test + manual run; add a focused emit test.

The phase emit points:
- **start:** after `requestedModel` is known (`src/server.ts:231`). Generate
  `reqId`, store via `c.set('reqId', reqId)`, emit `buildStart`.
- **account:** after `selectAccount` resolves `acc` (around `src/server.ts:206`).
  Reason: derive from selection — use `'round-robin'` as the default label here
  (selection returns the chosen account; if a finer reason is unavailable, pass
  `'round-robin'`). Emit `buildAccount(reqId, ts, acc.label, reason)`.
- **transport:** after `resolveTransportForAccount` (`src/server.ts:248`). Emit
  only when `transport` is non-null/non-direct: map to `kind`/`label` from the
  `TransportConfig`. If `transport == null` emit nothing.
- **done/error:** at the two `insertRequestLogDeferred` sites and the error
  return (`:266`) and catch (`:404`).

Note ordering: `selectAccount` runs before model resolution in the current code,
so emit **start** first using a `reqId` generated at the very top of the request
body handling, then **account** after selection. Simplest: generate `reqId`
immediately after `parseBody`, store on context, and emit `start` once
`requestedModel`/model is known. Account/transport events carry the same `reqId`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/console/emit-proxy.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('handleProxy emits flow events', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'kr-')), 't.db');
  });
  afterEach(async () => {
    const { resetDb } = await import('../../src/server.js');
    resetDb();
    vi.restoreAllMocks();
    delete process.env.ROUTER_DB_PATH;
  });

  it('emits start and done for a proxied request', async () => {
    const { app, resetDb } = await import('../../src/server.js');
    resetDb();
    const { openDb } = await import('../../src/db/index.js');
    const { createAccount } = await import('../../src/db/repos/accounts.js');
    const { createClientKey, genClientKey } = await import('../../src/db/repos/client_keys.js');
    const db = openDb();
    const key = genClientKey();
    createClientKey(db, { label: 'test', key });
    createAccount(db, { label: 'acct1', api_key: 'mm_x', credit_type: 'payg' });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    );

    const { consoleBus } = await import('../../src/console/bus.js');
    const seen: string[] = [];
    const off = consoleBus.subscribe((e) => seen.push(e.phase));

    await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
      body: JSON.stringify({ model: 'MiniMax-M2', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const { flushDeferredLogs } = await import('../../src/db/repos/requestLogs.js');
    await flushDeferredLogs();
    off();
    expect(seen).toContain('start');
    expect(seen).toContain('done');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/console/emit-proxy.test.ts`
Expected: FAIL — no `start`/`done` events emitted yet.

- [ ] **Step 3: Add emits in `handleProxy`**

After model resolution (just after `const requestedModel = resolved.requestedModel;`, `src/server.ts:231`):

```ts
    const reqId = genReqId();
    c.set('reqId', reqId);
    consoleBus.emit(
      buildStart(reqId, new Date().toISOString(), c.req.method, upstreamPath, resolved.upstreamModel, requestedModel ?? null)
    );
    consoleBus.emit(buildAccount(reqId, new Date().toISOString(), acc.label, 'round-robin'));
```

After `const transport = resolveTransportForAccount(db, acc);` (`:248`):

```ts
    if (transport) {
      const tk = transport.kind === 'relay' ? 'relay' : 'proxy';
      consoleBus.emit(buildTransport(reqId, new Date().toISOString(), tk, transport.label ?? tk));
    }
```

(If `TransportConfig` has no `kind`/`label`, map from its fields — inspect
`src/transport/resolve.ts` for the actual shape and adapt: a relay config →
`'relay'`; a proxy config → `'proxy'`; use a host/label string for the label.)

At the **success** non-stream log insert (`:377-399`), right after the
`insertRequestLogDeferred(...)` call, add:

```ts
    consoleBus.emit(
      buildDone(reqId, new Date().toISOString(), resp.status, null,
        usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0,
        usage.prompt_tokens_details?.cached_tokens ?? 0, cost, Date.now() - c.get('startTime'))
    );
```

Also add `req_id: reqId` to BOTH `insertRequestLogDeferred` calls (stream + non-stream) in `handleProxy`.

At the **streaming** usage callback (`:318-340`), capture `reqId` in the closure
(it is in scope) and after the deferred insert add:

```ts
        consoleBus.emit(
          buildDone(reqId, new Date().toISOString(), resp.status, null,
            prompt, completion, cacheRead, cost, Date.now() - startMs)
        );
```

At the **upstream error** path (`:283`, the `return c.body(errBody, ...)`),
before returning add:

```ts
    consoleBus.emit(buildError(reqId, new Date().toISOString(), resp.status, errBody.slice(0, 200)));
```

At the **catch** (`:404`):

```ts
    const rid = c.get('reqId') ?? '----';
    consoleBus.emit(buildError(rid, new Date().toISOString(), 502, e.message));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/console/emit-proxy.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + full server tests**

Run: `npm run typecheck && npx vitest run`
Expected: PASS. If `c.get('reqId')` errors on the Hono `Variables` type, add
`reqId: string` to the context variables type where `startTime` is declared
(search `startTime` in `src/server.ts`) — extend that `Variables` map with
`reqId?: string`.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts tests/console/emit-proxy.test.ts
git commit -m "feat(console): emit flow phases from MiniMax proxy"
```

---

## Task 10: emit phases from handleKiroProxy

**Files:**
- Modify: `src/server.ts` — inside `handleKiroProxy`.
- Test: `tests/console/emit-kiro.test.ts` (mirror of Task 9 against a Kiro model; if Kiro is hard to drive in a unit test, assert via a direct call to the emit points or skip with a documented `it.skip` and rely on Task 9 coverage + manual verify).

Apply the SAME emit pattern as Task 9 at the equivalent points in
`handleKiroProxy` (start after model resolution, account after selection,
transport after `resolveTransportForAccount`, done in the usage callback /
buffered path, error in the catch at `src/server.ts:564`). Add `req_id: reqId` to
the Kiro `insertRequestLogDeferred` call(s).

- [ ] **Step 1: Write the test**

```ts
// tests/console/emit-kiro.test.ts
import { describe, expect, it } from 'vitest';
import { consoleBus } from '../../src/console/bus.js';
import { buildStart } from '../../src/console/flow.js';

// handleKiroProxy emits the same phases as handleProxy. Driving a full Kiro
// request needs the AWS event-stream mock; the shared emit helpers are unit
// tested in flow.test.ts. This guards that the Kiro path imports + uses the bus.
describe('kiro emit wiring', () => {
  it('bus accepts a start event (smoke)', () => {
    const seen: string[] = [];
    const off = consoleBus.subscribe((e) => seen.push(e.reqId));
    consoleBus.emit(buildStart('k1', '2026-06-09T00:00:00.000Z', 'POST', '/v1/messages', 'kiro-claude', null));
    off();
    expect(seen).toContain('k1');
  });
});
```

- [ ] **Step 2: Run test to verify current state**

Run: `npx vitest run tests/console/emit-kiro.test.ts`
Expected: PASS (smoke) — then proceed to wire real emits.

- [ ] **Step 3: Add emits in `handleKiroProxy`**

Mirror Task 9's emit calls at the Kiro path's start / account / transport /
done / error sites. Generate `reqId` after Kiro model resolution, `c.set('reqId', reqId)`, and emit `buildStart` with `upstreamPath` and the resolved Kiro model. Emit `buildDone` where Kiro usage is finalized, `buildError` in the catch at `:564` (use `c.get('reqId') ?? '----'`).

- [ ] **Step 4: Typecheck + tests**

Run: `npm run typecheck && npx vitest run tests/console/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts tests/console/emit-kiro.test.ts
git commit -m "feat(console): emit flow phases from Kiro proxy"
```

---

## Task 11: attach stdout sink at startup

**Files:**
- Modify: `src/server.ts` — startup section (near `serve(...)` / `log.info('router listening')`, `src/server.ts:754`).

- [ ] **Step 1: Add the call**

In the startup path (where the server begins listening, just before/after
`serve(...)`), add:

```ts
attachStdoutSink();
```

(`attachStdoutSink` already imported in Task 8.) Guard so it is only attached
once — if startup runs in a function called per-test, place it in the same
one-time block as `serve()` so test `app.request()` calls don't double-attach.
If `app` is exported for tests without calling the listen block, the sink stays
detached during tests (desired — no stdout spam in test output).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual smoke (optional)**

Run: `npm run dev:server`, fire a request through the proxy, confirm phase lines
print to the terminal. Set `CONSOLE_FLOW=0` and confirm they disappear.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat(console): attach stdout sink on startup"
```

---

## Task 12: terminal icon

**Files:**
- Modify: `client/src/components/Icon.tsx`

- [ ] **Step 1: Add the icon**

Add `'console'` to the `IconName` union:

```ts
export type IconName =
  | 'overview'
  | 'usage'
  | 'client-keys'
  | 'accounts'
  | 'models'
  | 'aliases'
  | 'quota'
  | 'settings'
  | 'transports'
  | 'console'
  | 'search';
```

Add to the `paths` record:

```tsx
  console: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3" />
      <path d="M13 15h4" />
    </>
  ),
```

- [ ] **Step 2: Typecheck client**

Run: `cd client && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Icon.tsx
git commit -m "feat(console): terminal icon"
```

---

## Task 13: Console page

**Files:**
- Create: `client/src/pages/Console.tsx`
- Modify: `client/src/styles/components.css` (append console styles)
- Test: `client/test/Console.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/test/Console.test.tsx
import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { ConsoleBlocks, type FlowEvent } from '../src/pages/Console';

const start: FlowEvent = { phase: 'start', reqId: 'a3f2', ts: '2026-06-09T12:04:31.000Z', method: 'POST', path: '/v1/messages', model: 'claude-sonnet-4', alias: null };
const account: FlowEvent = { phase: 'account', reqId: 'a3f2', ts: '', accountLabel: 'kiro1', reason: 'round-robin' };
const done: FlowEvent = { phase: 'done', reqId: 'a3f2', ts: '', status: 200, ttftMs: 480, inTok: 1200, outTok: 340, cacheTok: 800, costUsd: 0.004, latencyMs: 1400 };
const err: FlowEvent = { phase: 'error', reqId: 'b1', ts: '', status: 429, message: 'rate limited' };

describe('ConsoleBlocks', () => {
  it('groups events by reqId and renders summary', () => {
    render(<ConsoleBlocks events={[start, account, done]} />);
    expect(screen.getByText(/#a3f2/)).toBeTruthy();
    expect(screen.getByText(/kiro1/)).toBeTruthy();
    expect(screen.getByText(/200/)).toBeTruthy();
    expect(screen.getByText(/in 1\.2k/)).toBeTruthy();
  });

  it('renders an error block', () => {
    render(<ConsoleBlocks events={[err]} />);
    expect(screen.getByText(/rate limited/)).toBeTruthy();
    expect(screen.getByText(/429/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run test/Console.test.tsx`
Expected: FAIL — cannot resolve `../src/pages/Console`.

- [ ] **Step 3: Write the page**

```tsx
// client/src/pages/Console.tsx
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

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

  useEffect(() => {
    const es = new EventSource('/api/admin/console/stream');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      if (!m.data || pausedRef.current) return;
      try {
        const ev = JSON.parse(m.data) as FlowEvent;
        setEvents((prev) => {
          const next = [...prev, ev];
          return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
        });
      } catch {
        /* heartbeat / malformed */
      }
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    if (stickRef.current && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [events]);

  return (
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">Console</h1>
        <div class="console-controls">
          <span class={`console-dot ${connected ? 'live' : 'down'}`} />
          <span class="console-status">{connected ? 'live' : 'reconnecting…'}</span>
          <button class="btn" onClick={() => setPaused((p) => !p)}>{paused ? 'Resume' : 'Pause'}</button>
          <button class="btn" onClick={() => setEvents([])}>Clear</button>
        </div>
      </div>
      <div
        class="console-scroll"
        ref={boxRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        <ConsoleBlocks events={events} />
        {events.length === 0 && <div class="console-empty">Waiting for requests…</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Append styles**

In `client/src/styles/components.css` append (use existing theme tokens):

```css
.console-controls { display: flex; align-items: center; gap: 10px; }
.console-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-3); }
.console-dot.live { background: var(--signal); }
.console-dot.down { background: var(--alert); }
.console-status { font-size: 12px; color: var(--text-3); }
.console-scroll {
  margin-top: 16px; height: calc(100vh - 180px); overflow-y: auto;
  background: #0d0d0d; border: 1px solid var(--accent); border-radius: 8px; padding: 14px;
}
.console-box { font-family: var(--font-mono, 'JetBrains Mono', monospace); font-size: 12.5px; line-height: 1.55; }
.console-block { margin-bottom: 10px; }
.console-line { white-space: pre-wrap; word-break: break-word; }
.console-sub { color: var(--text-3); padding-left: 6px; }
.console-reqid { color: var(--accent); }
.console-ok { color: var(--signal); }
.console-err { color: var(--alert); }
.console-empty { color: var(--text-3); font-style: italic; }
```

(If `--font-mono` is not defined, replace with the literal `'JetBrains Mono', monospace`. Verify token names against `client/src/styles/base.css` — `--accent`, `--signal`, `--alert`, `--text-3` are referenced elsewhere in the app and exist.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx vitest run test/Console.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/Console.tsx client/src/styles/components.css client/test/Console.test.tsx
git commit -m "feat(console): dashboard Console page"
```

---

## Task 14: wire Console into navigation

**Files:**
- Modify: `client/src/layout/AppShell.tsx`, `client/src/layout/Sidebar.tsx`, `client/src/components/CommandPalette.tsx`

- [ ] **Step 1: AppShell — lazy import, route, switch, hotkey, help**

In `client/src/layout/AppShell.tsx`:

Add lazy import (alphabetical with others):

```ts
const Console = lazy(() => import('../pages/Console').then((m) => ({ default: m.Console })));
```

Add `'console'` to `KNOWN_ROUTES`:

```ts
const KNOWN_ROUTES = [
  'overview', 'usage', 'client-keys', 'accounts', 'models',
  'aliases', 'quota', 'transports', 'console', 'settings',
];
```

Add a switch case (before `default`):

```tsx
    case 'console':
      return <Console />;
```

Add hotkey to `gMap`:

```ts
      e: '/admin/console',
```

Add a help-modal row (after the settings shortcut row):

```tsx
              <div>
                <kbd>g</kbd> then <kbd>e</kbd> — console
              </div>
```

- [ ] **Step 2: Sidebar — nav item**

In `client/src/layout/Sidebar.tsx`, add to `NAV` (after `transports`, before `settings`):

```ts
  { key: 'console', label: 'Console', href: '/admin/console', icon: 'console' },
```

- [ ] **Step 3: CommandPalette — palette item**

In `client/src/components/CommandPalette.tsx`, add to `ITEMS` (after Proxies):

```ts
  { label: 'Console', href: '/admin/console', keys: 'g e' },
```

- [ ] **Step 4: Typecheck + build client**

Run: `cd client && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/layout/AppShell.tsx client/src/layout/Sidebar.tsx client/src/components/CommandPalette.tsx
git commit -m "feat(console): wire Console into nav, palette, hotkey"
```

---

## Task 15: docs + full verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the module**

In `CLAUDE.md` under "Server modules", add a bullet:

```md
- `src/console/` — live flow bus (`bus.ts` ring buffer), stdout sink (`sink.ts`, env `CONSOLE_FLOW`), ANSI renderer (`format.ts`), event builders (`flow.ts`). Emits FlowEvents at proxy phases (start/account/transport/done/error); SSE at `GET /api/admin/console/stream`; dashboard Console page renders grouped blocks.
```

Add to the migrations note (Storage section): `004-reqid.ts` additive `req_id` on `request_logs`; `user_version` current = 4.

Add to the Dashboard pages list: `Console` (live terminal of the request flow via SSE).

- [ ] **Step 2: Full verification**

Run: `npm run typecheck && npm run lint && npx vitest run && cd client && npx vitest run && npm run build`
Expected: ALL PASS.

- [ ] **Step 3: Manual end-to-end**

Run `npm run dev`, open `#/admin/console`, fire a proxy request, confirm a
grouped block appears live with tokens/cost/status; confirm terminal prints the
matching colored lines; confirm an error request shows a red line; confirm
Pause/Clear/auto-scroll work.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document live console module + page"
```

---

## Self-Review notes

- **Spec coverage:** bus (T2), stdout sink + CONSOLE_FLOW toggle (T5, T11), ANSI renderer (T3), FlowEvent union (T1), reqId on context + log (T4, T6, T7, T9), SSE endpoint with backfill+heartbeat (T8), all four phases emitted in both proxy paths (T9, T10), Console page grouped-by-reqId with colors/auto-scroll/pause/clear/reconnect (T13), nav/route/hotkey/palette (T14), migration 004 (T6), docs (T15), tests at every task.
- **Placeholder scan:** none — every code step has full code. Two spots (transport `kind`/`label` mapping in T9, font-mono token in T13) instruct verifying actual shapes against named source files rather than guessing; these are verification instructions, not deferred work.
- **Type consistency:** `FlowEvent` union identical in `src/console/types.ts` (T1) and mirrored client-side in `Console.tsx` (T13, client reason/kind widened to `string` since it only renders). Builders (`buildStart/buildAccount/buildTransport/buildDone/buildError`) named consistently across T4, T9, T10. `consoleBus` singleton name consistent T2/T5/T8/T9.
