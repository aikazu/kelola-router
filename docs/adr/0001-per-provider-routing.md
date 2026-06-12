# 0001. Per-provider routing (Kiro as a provider, not a transport)

Date: 2026-06-12

## Status

Accepted.

## Context

When Kiro (AWS CodeWhisperer / Amazon Q) was added in v0.16.0, the router was a single MiniMax proxy. Two options for Kiro's place in the architecture were considered:

1. **Kiro as a new provider** — branch in `handleProxy` based on `models.provider`, with a dedicated `src/proxy/kiro.ts` handler.
2. **Kiro as a transport** — keep the proxy pipeline generic, encode provider-specific behavior in a `Transport` (the layer below the proxy that handles fetch / SOCKS / relay).

The pressure points: Kiro has a different auth model (OAuth refresh token vs API-key bearer), a different wire protocol (AWS event-stream binary vs HTTP-JSON), and a different response shape (SSE re-emission needed). Cramming that into a `Transport` would force the transport to know about model selection, error rules, and response assembly — concerns the transport layer shouldn't have.

## Decision

Branch in `handleProxy` on `models.provider`. The dispatch lives in `src/server.ts` (the `model.provider === 'kiro'` check) and calls `handleKiroProxy` from `src/proxy/kiro.ts`. MiniMax keeps `src/proxy/minimax.ts` (renamed from the old `handleProxy`) and combo routing lives in `src/proxy/combo.ts`.

`ProviderName = 'minimax' | 'kiro'` is defined in `src/db/repos/accounts.ts:18` and added to both `accounts` and `models` tables via migration `002-kiro.ts`. The selection state machine (`src/accounts/selection.ts`) reads `settings.selection.<provider>` so each provider has its own `mode` + `step`.

## Consequences

### Positive

- Provider-specific auth, transform, and stream logic is isolated in one module per provider.
- Adding a future provider (Anthropic direct, Bedrock, llama.cpp) is a clean per-provider add — see `docs/guides/add-a-provider.md`.
- Each provider can have its own selection mode and step (e.g. sticky per-client-key for Kiro, round-robin for MiniMax).
- Error rules are shared (`src/accounts/errorRules.ts`) but the inputs (base_resp vs AWS-shaped error) are decoded per-provider.

### Negative

- The proxy dispatch in `src/server.ts` grows by 1 line per provider. Mitigated by keeping the dispatch table small (3 entries today).
- The selection state machine reads from two settings keys, doubling the validation surface. Mitigated by sharing the same `SelectionOpts` type.
- Combo routing has to know about both providers — it does, via `combo.models` being a list of `name` strings that each resolve to a `(provider, upstream_model)` pair.

### Neutral

- The legacy `settings.selection` key (pre-v0.13) is no longer read. Existing users silently fall back to `lowest-backoff` on upgrade. No migration code.

## Alternatives considered

### Kiro as a transport

Wrap the Kiro-specific behavior in a `TransportConfig` variant. The proxy pipeline stays generic; transport is where the AWS event-stream is decoded.

Rejected because: a `Transport` shouldn't know about error rules, model selection, or response re-emission. Putting that logic there would invert the dependency (transport depending on proxy internals). The current boundary — transport is a fetch primitive, proxy is request orchestration — is cleaner.

### Kiro as a sidecar service

Run Kiro as a separate process and proxy to it. The main router would just see another HTTP-JSON upstream.

Rejected because: the binary event-stream re-emission needs to happen on the trusted side (with the access token), and pushing it to a sidecar multiplies the deployment surface for a single-feature win.

## References

- `src/server.ts` — dispatch (`if (resolved.provider === 'kiro') return handleKiroProxy(...)`)
- `src/proxy/{minimax,kiro,combo}.ts` — three handlers
- `src/db/repos/accounts.ts:18` — `ProviderName` type
- `src/db/migrations/002-kiro.ts` — additive columns
- `CHANGELOG.md` v0.16.0 — Kiro addition entry
- `docs/guides/add-a-provider.md` — pattern for future providers
- `docs/notes/kiro-cli-reverse-engineering.md` — wire format capture
