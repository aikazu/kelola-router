# Live Console — Design

**Date:** 2026-06-09
**Status:** Approved (design), pending implementation plan

## Goal

Add a **Console** page to the dashboard: a terminal-style box that streams the
per-request proxy flow live, and clean up the server's stdout flow output so the
same pretty, phase-stepped lines appear in both the terminal and the browser.

Output is **metadata only** — no message/response body preview. Full bodies stay
in the existing Request Detail page.

## Architecture: one emitter, two sinks

```
handleProxy / handleKiroProxy
        │  emit FlowEvent at each pipeline phase
        ▼
   src/console/bus.ts   ← in-process EventEmitter + ring buffer (last 200 events)
        ├──────────────► stdout sink: pretty colored phase lines (ANSI)
        └──────────────► SSE sink: GET /api/admin/console/stream
                                      ▼
                         client/src/pages/Console.tsx
                         EventSource → terminal box, grouped by reqId
```

Rationale: phases fire at 4 points across two proxy paths (MiniMax + Kiro).
Centralize emission in a bus so both sinks render identical content and the proxy
code only calls thin helpers. Ring buffer (in-memory, no DB) lets a freshly
opened Console page backfill the last N events instead of starting blank.

Single-user self-host model: one SSE subscriber expected, no fan-out scaling
concern.

## FlowEvent shape

One request = a short `reqId` (hex, e.g. `a3f2`) plus an ordered sequence of
phase events. `reqId` is generated at request start and stored on the Hono
context (`c.set('reqId', …)`), then also written to the request log row for
console↔detail correlation.

| phase       | fields |
|-------------|--------|
| `start`     | reqId, ts, method, path, model (resolved), alias (nullable) |
| `account`   | reqId, accountLabel, reason (`sticky` \| `round-robin` \| `fallback`) |
| `transport` | reqId, kind (`proxy` \| `relay` \| `direct`), label — **emitted only when not direct** |
| `done`      | reqId, status, ttftMs (nullable), inTok, outTok, cacheTok, costUsd, latencyMs |
| `error`     | reqId, status, message (short, ≤200 chars) |

TypeScript discriminated union on `phase`. No `any`.

```ts
type FlowEvent =
  | { phase: 'start'; reqId: string; ts: string; method: string; path: string; model: string; alias: string | null }
  | { phase: 'account'; reqId: string; ts: string; accountLabel: string; reason: 'sticky' | 'round-robin' | 'fallback' }
  | { phase: 'transport'; reqId: string; ts: string; kind: 'proxy' | 'relay' | 'direct'; label: string }
  | { phase: 'done'; reqId: string; ts: string; status: number; ttftMs: number | null; inTok: number; outTok: number; cacheTok: number; costUsd: number; latencyMs: number }
  | { phase: 'error'; reqId: string; ts: string; status: number; message: string };
```

## Server module — `src/console/`

- **`bus.ts`** — `ConsoleBus` singleton.
  - `emit(ev: FlowEvent): void` — push to ring buffer + notify subscribers.
  - `subscribe(fn: (ev) => void): () => void` — returns unsubscribe.
  - `recent(): FlowEvent[]` — current ring buffer contents (oldest→newest).
  - Ring buffer cap = 200, FIFO eviction.
- **`format.ts`** — `renderStdout(ev: FlowEvent): string`. Pure function, phase →
  colored terminal string (ANSI). Unit-testable by stripping ANSI codes.
- **`flow.ts`** — thin helpers that build an event and push to the bus:
  `startFlow(c, {...})`, `flowAccount(c, {...})`, `flowTransport(c, {...})`,
  `flowDone(c, {...})`, `flowError(c, {...})`. Each reads `reqId` from context.

The **stdout sink** subscribes once at server startup and writes
`renderStdout(ev)` to `process.stdout`. Gated by env toggle `CONSOLE_FLOW`
(default **on**; set `CONSOLE_FLOW=0` to suppress and keep pino JSON only). pino
remains for startup/error/system logs; the flow lines are a separate
human-readable stream.

## Wiring into the proxy

Both `handleProxy` and `handleKiroProxy` in `src/server.ts`:

1. **start** — at request entry, after model resolution: generate `reqId`, store
   on context, emit `start`.
2. **account** — after `selectAccount`: emit `account` with label + reason.
3. **transport** — after `resolveTransportForAccount`: emit `transport` only when
   `kind !== 'direct'`.
4. **done / error** — at the existing `insertRequestLog(Deferred)` sites: emit
   `done` (success path) or `error` (non-ok / catch). Reuse the same
   tokens/cost/latency already computed for the log row. For streaming, emit
   `done` inside the `pipeWithUsage` usage callback where final usage is known;
   `ttftMs` from the stream's first-token timing if available, else null.

`reqId` is added to the request log insert (additive nullable column).

## SSE endpoint

`GET /api/admin/console/stream` under `requireAdmin`. Hono streaming response,
`content-type: text/event-stream`:

1. On connect: replay `bus.recent()` as individual `data: {json}\n\n` frames.
2. Subscribe to bus; forward each new event as `data: {json}\n\n`.
3. Heartbeat comment (`: ping\n\n`) every 15s to keep the connection alive.
4. On close/abort: unsubscribe.

GET → no CSRF concern. Auth via existing `requireAdmin` (session cookie /
x-admin-key / open mode).

## Dashboard — `Console.tsx`

New nav item **Console** (icon `terminal`), route key `console`, added to
`KNOWN_ROUTES`, `NAV`, `AppShell` switch, command palette, and `g`-then-`e`
hotkey (`gMap.e = '/admin/console'`; help modal updated).

Terminal box:

- Monospace (JetBrains Mono var), dark inset panel, gold accent border — Obsidian
  Gold theme tokens only (no new colors).
- Events grouped by `reqId` into a block:

  ```
  #a3f2 → POST /v1/messages claude-sonnet-4
    ⤷ account: kiro1 (round-robin)
    ⤷ proxy: us-1
    ✓ in 1.2k out 340 $0.004 1.4s · 200
  ```

- Colors: status 2xx green (`--signal`), 4xx/5xx red (`--alert`), reqId gold
  (`--accent`), `⤷` dim (`--text-3`). Error blocks show a red `✗` line with the
  message.
- Auto-scroll to bottom; pause auto-scroll when user scrolls up (resume on
  scroll-to-bottom).
- Controls: **Clear** (client-side only), **Pause** (stop appending), live
  connection dot (green live / amber reconnecting).
- `EventSource` with browser auto-reconnect; show "reconnecting…" on error.
- Client-side cap (e.g. keep last 200 blocks) to bound DOM.

Formatting helpers: tokens `1.2k` style; cost `$0.004` (existing currency/number
helpers reused if present, else small local fmt).

## Storage / migration

- **`004-reqid.ts`** (additive): `ALTER TABLE request_logs ADD COLUMN req_id TEXT`.
  Nullable; existing rows stay null. Bump `user_version` to 4.
- `RequestLog` interface + `RequestLogInsert` + `insertRequestLog` extended with
  `req_id?: string | null`.

## Testing (strict TDD: red → green → commit)

Server unit:
- `src/console/bus.test.ts` — emit/subscribe/unsubscribe, ring-buffer cap (201st
  evicts 1st), `recent()` order.
- `src/console/format.test.ts` — each phase renders expected string (assert on
  ANSI-stripped output).
- `src/console/flow.test.ts` — helpers build the correct event shape and push to
  the bus (spy on `bus.emit`).

Server integration:
- SSE endpoint: connect, assert `recent()` backfill frames, then trigger a proxy
  request and assert a new `data:` frame arrives. Auth required (401 without).

Client:
- `Console` page renders a grouped block from a set of mock `FlowEvent`s
  (start+account+transport+done → one block; error variant → red line).

DB:
- Migration test: `req_id` column exists after migrate, insert+read round-trips a
  `req_id`.

## Out of scope (YAGNI)

- Content/body preview (metadata only by decision).
- Persisting flow events to DB (ring buffer only; history lives in request_logs +
  Request Detail).
- Multi-client SSE fan-out tuning (single-user model).
- Filtering/search in the console box (Usage page already filters logs).

## File summary

New:
- `src/console/bus.ts`, `src/console/format.ts`, `src/console/flow.ts`
- `src/console/bus.test.ts`, `src/console/format.test.ts`, `src/console/flow.test.ts`
- `src/db/migrations/004-reqid.ts`
- `client/src/pages/Console.tsx`
- client + integration tests

Modified:
- `src/server.ts` (emit phases, SSE route, stdout sink subscribe)
- `src/db/repos/requestLogs.ts` (`req_id` field)
- `src/db/migrations/index.ts` (register 004)
- `client/src/layout/Sidebar.tsx`, `AppShell.tsx` (nav, route, hotkey)
- `client/src/components/CommandPalette.tsx`, Icon (terminal icon)
- `CLAUDE.md` (document console module + page)
