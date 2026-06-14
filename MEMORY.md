# Memory Index

Pointers to every knowledge resource in this repository. New contributor (human or AI): start here, then read the recommended order.

## Read first (in this order)

1. **[`AGENTS.md`](AGENTS.md)** — workflow + conventions for AI coding agents. TDD, no `any`, commit format, test patterns.
2. **[`CLAUDE.md`](CLAUDE.md)** — auto-loaded by Claude Code. Overview: proxy pipeline, two-tier auth, MiniMax/Kiro quirks, schema summary.
3. **[`ARCHITECTURE.md`](ARCHITECTURE.md)** — module map, state machines, data flow per request, key invariants.
4. **[`CONTRIBUTING.md`](CONTRIBUTING.md)** — human workflow: branches, commits, PRs, releases.
5. **[`README.md`](README.md)** — user-facing quick start + features.

## Knowledge resources

| Resource | Path | Purpose |
|---|---|---|
| Architecture | [`ARCHITECTURE.md`](ARCHITECTURE.md) | Deep-dive: pipeline, state machines, module map |
| Conventions | [`AGENTS.md`](AGENTS.md) | TDD, no `any`, commit format, test patterns |
| Changelog | [`CHANGELOG.md`](CHANGELOG.md) | Release history (Keep-a-Changelog) |
| Roadmap | [`docs/roadmap.md`](docs/roadmap.md) | Long-term direction |

## Playbooks

Step-by-step guides for common contributor tasks. When a playbook is missing, write the work + the playbook in the same PR.

- [`docs/guides/add-a-provider.md`](docs/guides/add-a-provider.md) — wire a new upstream provider alongside MiniMax / Kiro
- [`docs/guides/add-an-admin-endpoint.md`](docs/guides/add-an-admin-endpoint.md) — add a `/api/admin/*` route
- [`docs/guides/add-a-dashboard-page.md`](docs/guides/add-a-dashboard-page.md) — add a Preact page
- [`docs/guides/add-a-migration.md`](docs/guides/add-a-migration.md) — write a new `src/db/migrations/00X-*.ts`
- [`docs/guides/debug-a-failed-request.md`](docs/guides/debug-a-failed-request.md) — trace a request through the proxy
- [`docs/guides/ship-a-release.md`](docs/guides/ship-a-release.md) — version bump + changelog + tag

## Reference

Terse lookup tables, auto-extracted from source.

- `docs/reference/env-vars.md` — `ROUTER_*` env vars
- `docs/reference/settings-keys.md` — keys under `settings.*`
- `docs/reference/admin-api-routes.md` — full route inventory
- `docs/reference/db-tables.md` — schema reference
- `docs/reference/error-codes.md` — MiniMax `base_resp` + HTTP mapping
- `docs/reference/cli-scripts.md` — `npm run add-*` / `seed-*` / `reset`

## Architecture Decision Records

Capture the *why* behind consequential design choices. MADR-lite format. New ADRs get a sequential number (`NNNN-…`) and follow the template in `docs/adr/0001-…`.

- `docs/adr/0001-per-provider-routing.md` — Kiro branches as a separate provider, not a transport
- `docs/adr/0002-kiro-aws-event-stream.md` — accept the binary event-stream framing, re-emit as SSE
- `docs/adr/0003-in-process-sse-bus.md` — in-process EventEmitter + SSE for the live console
- `docs/adr/0004-two-tier-auth.md` — separate `client_keys` + cascading admin modes
- `docs/adr/0005-sqlite-wal-migrations.md` — SQLite-WAL + `user_version` + additive migrations

## Agent skills

Auto-loaded task instructions for AI coding agents. Each is a terse (< 100 LOC) recipe derived from the corresponding playbook in `docs/guides/`. Same names; playbooks are human-readable, skills are agent-optimized.

- `.claude/skills/add-provider/SKILL.md` — wire a new upstream provider
- `.claude/skills/add-admin-endpoint/SKILL.md` — add a `/api/admin/*` route
- `.claude/skills/add-dashboard-page/SKILL.md` — add a Preact page
- `.claude/skills/add-migration/SKILL.md` — add a DB migration
- `.claude/skills/debug-failed-request/SKILL.md` — trace a failed proxy request
- `.claude/skills/ship-release/SKILL.md` — cut a versioned release

## Project knowledge base

Deep technical notes indexed for search. Read with `mcp__plugin_context-mode_context-mode__ctx_search` when an agent needs depth beyond the lookup tables or playbooks.

- `.claude/docs/codebase-map.md` — module dependency graph + entry points
- `.claude/docs/state-machines.md` — account selection / backoff / lock invariants
- `.claude/docs/data-flow.md` — per-request pipeline annotated end-to-end
- `.claude/docs/kiro-protocol.md` — AWS event-stream + IDE/CLI persona wire format
- `CodeBuddy provider` — OpenAI SSE bridge to client format; see `src/providers/codebuddy/` + `docs/adr/0006-codebuddy-provider.md`
- `.claude/docs/format-conversion.md` — OpenAI ↔ Anthropic body transform rules
- `.claude/docs/conventions.md` — terse code-level rules
