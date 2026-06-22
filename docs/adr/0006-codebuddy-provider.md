# 0006. CodeBuddy as a third upstream provider (OpenAI bridge)

Date: 2026-06-14

## Status

Accepted.

## Context

After Kiro was added as a second upstream in v0.16.0, a third provider (CodeBuddy) was brought online in v0.18.0. CodeBuddy exposes an OpenAI-format HTTP API, which differs from MiniMax (also OpenAI-format but with `base_resp` error codes) and from Kiro (AWS event-stream binary framing).

The routing pattern established in ADR 0001 (one handler per provider, dispatched by `models.provider`) meant CodeBuddy needed its own module. The open question was whether CodeBuddy's OpenAI-format upstream allowed it to reuse the MiniMax handler (`src/proxy/minimax.ts`) with a different base URL.

It could not: CodeBuddy does not return `base_resp.status_code` error codes, has no quota API, uses a distinct auth scheme, requires a guaranteed system message, and when streaming in Anthropic-SSE mode needs the OpenAI SSE → Anthropic SSE conversion that Kiro already does (but through a different event format). Sharing the MiniMax handler would require conditionals throughout the hot path, hiding CodeBuddy behavior in the wrong module.

## Decision

CodeBuddy gets its own handler: `src/proxy/codebuddy.ts`, dispatched from `src/server.ts` when `resolved.provider === 'codebuddy'`. Provider logic lives under `src/providers/codebuddy/`: format conversion, SSE assembly, auth helpers, and the seed model list.

Key implementation choices:
- **Forced `stream_options.include_usage`**: injected before upstream fetch so usage tokens always land in the SSE `[DONE]` frame, enabling cost tracking.
- **Guaranteed system message**: CodeBuddy rejects requests with no system turn; the handler injects a minimal default when the client omits one.
- **OpenAI SSE → Anthropic SSE conversion**: when the client format is `anthropic`, the handler assembles Anthropic Messages SSE events (`message_start` / `content_block_*` / `message_delta` / `message_stop`) from the upstream OpenAI SSE stream, matching the Kiro pattern.
- **Mid-stream SSE error propagation**: upstream errors that arrive inside a streaming response are surfaced as `error` events rather than silent truncation.
- **`pullQuota` no-op**: `src/providers/quota.ts` checks the provider and skips the MiniMax quota API for CodeBuddy; no stub endpoint needed.

## Consequences

### Positive

- CodeBuddy behavior (auth, error handling, format conversion) is isolated in `src/proxy/codebuddy.ts` and `src/providers/codebuddy/`. The MiniMax handler is not changed.
- Future providers with non-standard behavior follow the same per-provider module pattern.
- `pullQuota`'s provider-aware no-op means the scheduler tick continues working for all accounts without a code branch per-tick.

### Negative

- The `src/server.ts` dispatch chain grows by one `if` branch per provider. Now three.
- OpenAI SSE → Anthropic SSE conversion logic exists in two places: `src/providers/kiro/anthropicSse.ts` and `src/providers/codebuddy/`. Divergence is possible if upstream formats differ. Shared library extraction is deferred.

### Neutral

- Model names are stored bare in the DB; the `cb/` prefix is resolved at routing time (not stored). This matches the Kiro pattern (`kr/` prefix, bare model stored).

## Alternatives considered

### Reuse MiniMax handler with a `provider` flag

Pass a `provider` flag into `handleProxy` and guard the CodeBuddy-specific behavior with conditionals. Rejected because: the MiniMax handler is already 300 lines; interleaving CodeBuddy auth, error handling, and SSE conversion would obscure both providers. The per-provider module pattern from ADR 0001 keeps each file focused.

### Generic OpenAI-bridge handler shared by MiniMax and CodeBuddy

Extract a shared handler that accepts a provider config object (base URL, auth header builder, error parser). Rejected for now: MiniMax's `base_resp` error codes and CodeBuddy's system-message requirement are enough divergence that the config object would grow complex. Revisit when a fourth OpenAI-format provider appears.

## References

- `src/proxy/codebuddy.ts`: request handler
- `src/providers/codebuddy/`: auth, SSE assembly, format helpers, seed models
- `src/server.ts`: dispatch (`if (resolved.provider === 'codebuddy') return handleCodeBuddyProxy(...)`)
- `src/providers/quota.ts`: provider-aware `pullQuota` no-op
- `src/providers/modelPrefix.ts`: `cb/` prefix → `codebuddy` mapping
- `CHANGELOG.md` v0.18.0: CodeBuddy provider entry
