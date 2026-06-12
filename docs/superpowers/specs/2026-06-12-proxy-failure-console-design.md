# Proxy failure policy + console upgrade — design

Date: 2026-06-12

## Goal

Two related improvements:

1. **Proxy failure policy.** Today `proxyAwareFetch` always silently falls back
   to direct when a proxy fails. Give the user a choice on the Proxies page:
   fall back to direct, or block the request.
2. **Console upgrade.** Make the live request console report more useful
   without becoming noisy. Surface proxy failures (currently a blind spot —
   they only hit stdout `console.warn`), show compression savings, add
   timestamps + dedupe, and allow per-request detail expansion.

## Part A — proxy failure mode (global)

### Setting

- `settings.transport` gains `proxyFailureMode: 'direct' | 'block'`.
- Default `'direct'` (current behavior — zero breakage).
- Stored alongside existing `relay`/`proxy` keys in the `transport` setting JSON.
- Helper `getProxyFailureMode(db): 'direct' | 'block'` reads it (defaults to
  `'direct'` when unset/legacy).

### `proxyAwareFetch` change

New optional 4th argument:

```ts
interface ProxyFetchOpts {
  failureMode?: 'direct' | 'block';      // default 'direct'
  onProxyFailure?: (message: string, fellBack: boolean) => void;
}

export class ProxyBlockedError extends Error {}

proxyAwareFetch(targetUrl, options, transportConfig, opts?): Promise<Response>
```

On proxy dispatcher failure (the existing `catch`):

- `failureMode === 'direct'` (default): call `onProxyFailure(msg, true)`, warn,
  `globalThis.fetch(targetUrl, options)` — unchanged from today.
- `failureMode === 'block'`: call `onProxyFailure(msg, false)`, then
  `throw new ProxyBlockedError(msg)`.

Env-proxy path (`HTTPS_PROXY` etc.) honors the same opts.

### `upstreamFetch` change

Forwards an optional `opts` argument straight through to `proxyAwareFetch`.

### Server wiring

In `handleProxy` / `handleCombo` / `handleKiroProxy`, per request:

- Read `getProxyFailureMode(db)` once.
- Build an `onProxyFailure` closure that emits a `transport-fail` FlowEvent
  (Part B item 1) on the console bus.
- Pass `{ failureMode, onProxyFailure }` to every upstream **POST** site
  (3 `upstreamFetch` calls). A `ProxyBlockedError` thrown from upstreamFetch is
  caught by the existing `try/catch` and surfaced as a 502 to the client (plus
  the existing `buildError` console emit).
- The `GET /v1/models` probe and the transport `/test` route keep the default
  `'direct'` — they are diagnostics, not client traffic.

### UI — Proxies page

Header gains a segmented control:

> On proxy failure:  [ Fallback to direct ]  [ Block request ]

- Reads/writes via `GET`/`PATCH` `/api/admin/settings` (key `transport`).
- A short caption explains the trade-off (direct = request still served but
  leaks real IP; block = request fails with 502, IP protected).

## Part B — console upgrade

All four items are scoped to stay compact. The fail line only appears on
failure; the saved figure only appears when `>0`; dedupe actively removes
repeats.

### 1. Surface proxy fail/fallback

New FlowEvent variant:

```ts
{ phase: 'transport-fail'; reqId; ts; fellBack: boolean; message: string }
```

- Builder `buildTransportFail(reqId, ts, fellBack, message)` in
  `src/console/flow.ts`.
- Emitted from the `onProxyFailure` closure in the server.
- `format.ts` stdout render:
  - `fellBack` → `  ⤷ proxy failed → direct: <msg>` (dim/warn)
  - `!fellBack` → `  ⤷ proxy blocked: <msg>` (alert/red)
- Client `Console.tsx`: same, added to `Block` + `groupBlocks` + render.

### 2. Compression savings on done

- `buildDone` + the `done` FlowEvent gain `rtkSaved: number`.
- `rtkSaved` is already in scope (`rtkSaved` / `rtk_bytes_saved`) at every
  `buildDone` emit site — pass it in.
- Render appended to the done line **only when `rtkSaved > 0`**:
  `… saved 1.2k` (reusing `fmtTokens`-style helper for bytes).
- Kiro path passes `0` (no RTK there today) → never shows.

### 3. Timestamps + dedupe (client only)

- Per block: relative time derived from `start.ts` (e.g. `2s ago`), using the
  existing `relativeTime` helper.
- Dedupe: collapse **consecutive** blocks with identical
  `(method, path, model, status)` into a single rendered row with a `×N`
  count badge. Implemented in the render layer over `groupBlocks` output, so
  the raw event ring is untouched.

### 4. Per-request detail expand

- New endpoint `GET /api/admin/requests/by-req-id/:reqId` returning the
  `request_logs` row whose `req_id` matches (most recent if duplicated).
  Reuses the existing request-log serializer used by RequestDetail.
- `Console.tsx`: clicking a block toggles an inline expansion showing
  account reason, prompt/completion/cache tokens, cost, latency, rtk saved,
  and request/response body sizes. Fetched lazily on first expand
  (react-query, keyed by reqId). Reuses `JsonView` where useful.

## Phasing (strict TDD, ~300 LOC max per commit)

1. `proxyFailureMode` setting helper + `proxyAwareFetch`/`upstreamFetch` block
   logic + `ProxyBlockedError`. Unit tests in `src/transport/proxyFetch.test.ts`.
2. `buildTransportFail` event + server wiring of `onProxyFailure` + failureMode
   at the 3 POST sites. Tests in `src/console/flow.test.ts`,
   `src/console/format.test.ts`, and an integration test for block → 502.
3. Proxies page failure-mode toggle UI.
4. Console rtkSaved on done (server `buildDone`, `format.ts`, client).
5. Console client: timestamps + consecutive dedupe.
6. `by-req-id` endpoint + console inline detail expand.

Each phase is an independent commit. Conventional commit messages.

## Non-goals

- Per-account / per-proxy failure policy (global only this round).
- Retry-on-next-account when a proxy blocks (hard-fail 502 is the chosen
  block behavior).
- Persisting console events to disk (ring buffer stays in-memory).
