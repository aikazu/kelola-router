# Memory Index

Pointers to every knowledge resource in this repository. New contributor (human or AI): start here, then read the recommended order.

## Read first (in this order)

1. **[`AGENTS.md`](AGENTS.md)**: single source of truth: project overview, architecture, workflow, conventions. Replaces what used to live in `CLAUDE.md`.
2. **[`ARCHITECTURE.md`](ARCHITECTURE.md)**: module map, state machines, data flow per request, key invariants.
3. **[`CONTRIBUTING.md`](CONTRIBUTING.md)**: human workflow: branches, commits, PRs, releases.
4. **[`README.md`](README.md)**: user-facing quick start + features.

> `CLAUDE.md` exists as a one-paragraph pointer for auto-loaders. Anything authoritative lives in `AGENTS.md`.

## Knowledge resources

| Resource | Path | Purpose |
|---|---|---|
| Architecture | [`ARCHITECTURE.md`](ARCHITECTURE.md) | Deep-dive: pipeline, state machines, module map |
| Conventions | [`AGENTS.md`](AGENTS.md) | Single source: project overview + workflow + conventions |
| Changelog | [`CHANGELOG.md`](CHANGELOG.md) | Release history (Keep-a-Changelog) |
| Roadmap | [`docs/roadmap.md`](docs/roadmap.md) | Long-term direction |

## Playbooks

Step-by-step guides for common contributor tasks. When a playbook is missing, write the work + the playbook in the same PR.

- [`docs/guides/add-a-provider.md`](docs/guides/add-a-provider.md): wire a new upstream provider alongside MiniMax / Kiro
- [`docs/guides/add-an-admin-endpoint.md`](docs/guides/add-an-admin-endpoint.md): add a `/api/admin/*` route
- [`docs/guides/add-a-dashboard-page.md`](docs/guides/add-a-dashboard-page.md): add a Preact page
- [`docs/guides/add-a-migration.md`](docs/guides/add-a-migration.md): write a new `src/db/migrations/00X-*.ts`
- [`docs/guides/debug-a-failed-request.md`](docs/guides/debug-a-failed-request.md): trace a request through the proxy
- [`docs/guides/ship-a-release.md`](docs/guides/ship-a-release.md): version bump + changelog + tag

## Reference

Terse lookup tables, auto-extracted from source.

- `docs/reference/env-vars.md`: `ROUTER_*` env vars
- `docs/reference/settings-keys.md`: keys under `settings.*`
- `docs/reference/admin-api-routes.md`: full route inventory
- `docs/reference/db-tables.md`: schema reference
- `docs/reference/error-codes.md`: MiniMax `base_resp` + HTTP mapping
- `docs/reference/cli-scripts.md`: `npm run add-*` / `seed-*` / `reset`

## Architecture Decision Records

Capture the *why* behind consequential design choices. MADR-lite format. New ADRs get a sequential number (`NNNN-…`) and follow the template in `docs/adr/0001-…`.

- `docs/adr/0001-per-provider-routing.md`: Kiro branches as a separate provider, not a transport
- `docs/adr/0002-kiro-aws-event-stream.md`: accept the binary event-stream framing, re-emit as SSE
- `docs/adr/0003-in-process-sse-bus.md`: in-process EventEmitter + SSE for the live console
- `docs/adr/0004-two-tier-auth.md`: separate `client_keys` + cascading admin modes
- `docs/adr/0005-sqlite-wal-migrations.md`: SQLite-WAL + `user_version` + additive migrations
- `docs/adr/0006-codebuddy-provider.md`: CodeBuddy as a third upstream (OpenAI bridge + shared SseAssemblerBase)
- `docs/adr/0007-provider-prefix-routing.md`: `<prefix>/<model>` on `body.model` (mx/ kr/ cb/ pio/ nt/ zai)
- `docs/adr/0008-combo-fallback-chains.md`: `combos` table; cross-provider ordered fallback + alias/combo name-uniqueness invariant
- `docs/adr/0009-transport-geoip-probe.md`: advisory country probe via ipapi.co on transport add (non-blocking, UX-only)
- `docs/adr/0010-request-log-scheduler.md`: in-process scheduler reuses quota-pull tick for `request_logs` pruning (`REQUEST_LOG_RETENTION_DAYS`, default 30)

## Agent skills

Auto-loaded task instructions for AI coding agents. Each is a terse (< 100 LOC) recipe derived from the corresponding playbook in `docs/guides/`. Same names; playbooks are human-readable, skills are agent-optimized.

- `.claude/skills/add-provider/SKILL.md`: wire a new upstream provider
- `.claude/skills/add-admin-endpoint/SKILL.md`: add a `/api/admin/*` route
- `.claude/skills/add-dashboard-page/SKILL.md`: add a Preact page
- `.claude/skills/add-migration/SKILL.md`: add a DB migration
- `.claude/skills/debug-failed-request/SKILL.md`: trace a failed proxy request
- `.claude/skills/ship-release/SKILL.md`: cut a versioned release
- `.claude/skills/sync-docs/SKILL.md`: audit + fix doc staleness against live code

## Project knowledge base

Deep technical notes indexed for search. Read with `mcp__plugin_context-mode_context-mode__ctx_search` when an agent needs depth beyond the lookup tables or playbooks.

- `.claude/docs/codebase-map.md`: module dependency graph + entry points
- `.claude/docs/state-machines.md`: account selection / backoff / lock invariants
- `.claude/docs/data-flow.md`: per-request pipeline annotated end-to-end
- `.claude/docs/kiro-protocol.md`: AWS event-stream + IDE/CLI persona wire format
- `CodeBuddy provider`: OpenAI SSE bridge to client format; see `src/providers/codebuddy/` + `docs/adr/0006-codebuddy-provider.md`
- `Pioneer provider`: OpenAI drop-in upstream, `X-API-Key` auth; reuses CodeBuddy's SSE bridge. DB rows namespaced under `pioneer/` to dodge the global-unique `name`/`upstream_model` clash with same-named Kiro models; clients still use clean `pio/<id>`. See `src/providers/pioneer/`, `src/proxy/pioneer.ts`, `docs/pioneer/{wire-format,auth}.md`.
- `Notion provider`: reverse-engineered from Notion desktop AI chat (`app.notion.com/api/v3/runInferenceTranscript`). Cookie-based session (11 cookies), 3-step temp-password login, CRDT-style JSON request + NDJSON patch-stream response. See `src/providers/notion/`, `src/proxy/notion.ts`, `docs/notion/{wire-format,capture-notes}.md`.
- `Z.AI provider`: dual endpoint upstream (`/api/coding/paas/v4` OpenAI Chat Completions + `/api/anthropic` Anthropic Messages), routed by client body format. Bearer API key, no OAuth. Prefix `zai/`. Flat-rate subscription (pricing zero). See `src/providers/zai/`, `src/proxy/zai.ts`, `docs/zai/{wire-format,auth}.md`.
- `TabiToken provider`: New-API-fork reseller gateway at `tabitoken.cc` (NOT `.com` — Cloudflare WAF-blocks non-browser UAs), OpenAI Chat Completions + native Anthropic `/v1/messages`, Bearer key (sk-…). 4-model Claude-Opus catalogue verified live; New-API error codes mapped in errorRules (`insufficient_user_quota` → balance disable). Prefix `tabi/`; model rows namespaced `tabi/<id>`. Mirror of the Pioneer pattern. See `src/providers/tabi/`, `src/proxy/tabi.ts`, `docs/tabi/{wire-format,auth}.md`.
- `.claude/docs/format-conversion.md`: OpenAI ↔ Anthropic body transform rules
- `.claude/docs/conventions.md`: terse code-level rules
- **SQLCipher encryption-at-rest**: `as unknown as Database.Database` boundary cast at `src/db/index.ts` + dual `better-sqlite3` / `better-sqlite3-multiple-ciphers` import, fresh-deploy-only `isPlaintextSqlite()` guard. Why: keeps the exported `Database` type stable across 50+ consumers. See `.omo/notepads/audit-remediation-2026-q2/decisions.md` D10.1 through D10.4.
- **Typed `getSettingT<K extends SettingKey>(db, key)`**: valibot-schema-validated settings getter at `src/db/repos/settings.ts:76`; suffix-T convention, `v.parse` (loud) over `safeParse`, coexists with untyped `getSetting<T>` until call-site migration completes. Schema registry at `src/db/repos/settings.types.ts`. See `.omo/notepads/audit-remediation-2026-q2/decisions.md` Task 21 entry.
