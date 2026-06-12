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

## Playbooks (when written)

Step-by-step guides for common tasks. Missing one? Write it as a follow-up commit.

- `docs/guides/add-a-provider.md` — wire a new upstream provider (Anthropic, Azure, …)
- `docs/guides/add-an-admin-endpoint.md` — add a `/api/admin/*` route
- `docs/guides/add-a-dashboard-page.md` — add a Preact page
- `docs/guides/add-a-migration.md` — write a new `src/db/migrations/00X-*.ts`
- `docs/guides/debug-a-failed-request.md` — trace a request through the proxy
- `docs/guides/ship-a-release.md` — version bump + changelog + tag

## Reference (when written)

Terse lookup tables, auto-extracted from source.

- `docs/reference/env-vars.md` — `ROUTER_*` env vars
- `docs/reference/settings-keys.md` — keys under `settings.*`
- `docs/reference/admin-api-routes.md` — full route inventory
- `docs/reference/db-tables.md` — schema reference
- `docs/reference/error-codes.md` — MiniMax `base_resp` + HTTP mapping
- `docs/reference/cli-scripts.md` — `npm run add-*` / `seed-*` / `reset`

## Architecture Decision Records

- `docs/adr/0001-per-provider-routing.md` — (planned) why Kiro branches off `handleProxy` instead of being a transport
- `docs/adr/0002-event-stream-vs-json-for-kiro.md` — (planned) why Kiro uses AWS event-stream binary framing
- `docs/adr/0003-console-sse-bus.md` — (planned) why in-process SSE bus instead of WebSocket
- `docs/adr/0004-two-tier-auth.md` — (planned) why client_key and admin_key are separate

## Agent skills (when written)

`.claude/skills/<name>/SKILL.md` — auto-loaded task instructions. Each skill is terse (< 100 LOC), step-by-step, with file:line references and a checklist. Same names as the playbooks above.

## Project knowledge base (when written)

`.claude/docs/*.md` — deep technical notes indexed for search. Topics planned:

- `codebase-map.md` — module dependency graph
- `state-machines.md` — selection / backoff / lock
- `data-flow.md` — request pipeline end-to-end
- `kiro-protocol.md` — AWS event-stream + cli/ide persona
- `format-conversion.md` — OpenAI ↔ Anthropic transform
- `conventions.md` — terse coding rules
