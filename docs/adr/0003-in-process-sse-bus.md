# 0003. Live console via in-process SSE bus + ring buffer

Date: 2026-06-12

## Status

Accepted.

## Context

For the Live Console page (added in v0.17.0), the dashboard renders per-request proxy events (`start` / `account` / `transport` / `done` / `error`) in real time. The user sees a live terminal of the request flow.

The transport from server to dashboard was an open question. Options:

1. **In-process EventEmitter + SSE**: the server publishes to an in-process `consoleBus`, the dashboard opens an `EventSource` over `GET /api/admin/console/stream` which subscribes to the bus. The bus has a 200-event ring buffer for backfill on new connections.
2. **WebSocket**: bidirectional, but the dashboard only needs server→client. WebSocket adds framing overhead + a separate upgrade handshake.
3. **Redis pub-sub**: works across multiple server instances, but the project is single-tenant self-host. Redis would be a heavyweight dependency for one feature.
4. **File-tail**: server writes events to a JSONL file, dashboard tails it. Awkward (polling vs inotify), laggy, doesn't compose with the rest of the dashboard.

## Decision

Option 1. `src/console/bus.ts` exports a singleton `consoleBus` (a typed `EventEmitter` over the `FlowEvent` discriminated union from `src/console/types.ts`) with a 200-event ring buffer (`recent(200)` method for backfill). The Hono SSE endpoint (`/api/admin/console/stream`) is in `src/api/admin/console/` and uses `streamSSE` to push events as `data: …\n\n` SSE frames.

The bus also has an optional stdout sink (`src/console/sink.ts:attachStdoutSink`) gated by `CONSOLE_FLOW=0` (off by default). When enabled, the server prints colored ANSI versions of the events to stdout for tail-without-dashboard scenarios.

The proxy handlers emit via `consoleBus.emit('start', { reqId, ... })`, `consoleBus.emit('account', ...)`, etc. (5 emit sites per proxy handler).

## Consequences

### Positive

- **Single source of truth.** One bus; the dashboard and the optional stdout sink are both subscribers. They can't disagree.
- **No external dependency.** Redis / Postgres / a queue is overkill for in-process events.
- **Ring buffer = free replay.** New dashboard connections get the last 200 events immediately, no separate "history" API needed.
- **Throwing-subscriber isolation.** A subscriber that throws doesn't break the bus or other subscribers. See `bus.ts` try/catch around each emit.

### Negative

- **Single-process only.** The ring buffer is in-memory. If the user runs multiple router instances (not currently supported), each has its own console.
- **No persistence.** Events are lost on restart. The `request_logs` table is the persisted equivalent. See `requestLogs` schema for the durable view.
- **The 200-event limit means fast-fire bursts may drop history.** The dashboard's "Pause" button is the workaround: pause → bus still buffers, dashboard doesn't render → resume.

### Neutral

- The bus is a typed `EventEmitter` over a discriminated union. Adding a new event type means adding a union member + a builder in `src/console/flow.ts`. The compile error from the union catches most missed wiring.

## Alternatives considered

### WebSocket

Rejected because: the dashboard is read-only. SSE is a one-way fit; WebSocket's bidirectionality is unused overhead. SSE also works over plain HTTP (no `Upgrade` dance) and is supported by every browser.

### Redis pub-sub

Rejected because: single-tenant self-host. The router runs in one Docker container. A Redis dependency is operational complexity for one feature. If multi-tenant ever happens, this ADR should be revisited.

### File-tail

Rejected because: SSE is strictly better for the in-memory, real-time case. Files are for persistence (`request_logs`); a separate log-tailing UI would be the right place for that, not the live console.

## References

- `src/console/bus.ts`: `consoleBus` singleton + ring buffer
- `src/console/types.ts`: `FlowEvent` discriminated union
- `src/console/flow.ts`: 5 `build*` helpers + `genReqId`
- `src/console/sink.ts`: `attachStdoutSink` (env-gated)
- `src/console/format.ts`: ANSI renderer + `stripAnsi` for tests
- `src/api/admin/console/`: SSE endpoint
- `client/src/pages/Console.tsx`: dashboard consumer
- `CHANGELOG.md` v0.17.0: Live Console entry
- `docs/architecture/.claude/docs/data-flow.md`: pipeline (see Phase 5)
