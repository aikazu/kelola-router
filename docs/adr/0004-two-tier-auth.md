# 0004. Two-tier auth: client_keys + cascading admin modes

Date: 2026-06-12

## Status

Accepted.

## Context

The router has two distinct identities to authenticate:

1. **Clients** (Claude Code, hermes-agent, anything speaking OpenAI/Anthropic). They send requests to `/v1/*` with a bearer token.
2. **Admins** (the human owner) accessing the dashboard at `/#/admin/*`. They manage accounts, client keys, models, etc.

Two architectures were considered:

1. **Single identity model** — every actor (client or admin) has a row in one `users` table with roles. A bearer token maps to a user; a session maps to a user; permissions are role-based.
2. **Two-tier separation** — `client_keys` for proxy traffic, `admin_password` / `x-admin-key` for the dashboard. The two never overlap. No `users` table.

The pressure: the router is single-user self-host. A `users` table is overhead for one admin. And the security properties are different — client bearers are long-lived, machine-presented, and used by untrusted code; admin auth is interactive, session-based, and rate-limited. Conflating them means the worst-case compromise of a client bearer could also compromise admin actions.

## Decision

Two tables, two paths. `client_keys` (the bearer credentials) are managed via the dashboard and presented as `Authorization: Bearer <key>` to `/v1/*`. The `requireApiKey` middleware in `src/auth.ts` looks up the key and attaches the row to the Hono context.

Admin auth has 3 cascading modes in `src/auth.ts:requireAdmin`:

1. **Session cookie** (`kelola_session`) — only if a password is set. Scrypt-hashed, stored in `settings.admin_password`. Session in `sessions` table, 7-day TTL.
2. **`x-admin-key` header** matching `ROUTER_ADMIN_KEY` env — for scripts and CI.
3. **Open mode** — if no password is set, the dashboard is reachable by anyone with the URL. This is the local-dev default.

`POST /api/login` is rate-limited (`src/auth/rateLimit.ts` — 5 attempts per 15 min per IP, in-memory bucket). CSRF is enforced by `csrfGuard` on all admin POSTs (blocks cross-origin POSTs by comparing `Origin` to `Host`).

## Consequences

### Positive

- **No `users` table.** One less schema surface to migrate. The "admin" is a configuration value, not a row.
- **Different security properties per tier.** Client bearers are long-lived, fine-grained (per-app), and visible in the dashboard. Admin sessions are short-lived, can be revoked by changing the password, and never touch the proxy.
- **Open mode is the default.** Local self-host is friction-free. Setting a password locks the dashboard.
- **No privilege escalation paths.** A leaked client bearer cannot reach `/api/admin/*` (no admin auth); a leaked admin session cannot reach `/v1/*` (no client-key attach).

### Negative

- **No multi-admin.** One password or one `ROUTER_ADMIN_KEY` is the only way to share admin access. If two humans need to co-admin, they share the password.
- **No audit log of admin actions** (currently). Every admin POST is logged to the request log; user attribution is "the session that was active" (recorded via the cookie), not a per-user identity. A future ADR could add this.
- **`x-admin-key` is a static header.** If the env var leaks, the attacker has admin access. Mitigated by the header being a separate fallback (most users use the password path).

### Neutral

- The session table schema is generic enough to support a future per-user table, but the migration isn't designed for it. Adding multi-user would need a new migration + an ADR.

## Alternatives considered

### Single `users` table

One row per admin, role-based permissions, OAuth providers.

Rejected because: single-user self-host. The operational overhead (password reset, OAuth config, user invite flow) is unjustified for one admin. If multi-tenant ever happens, this ADR should be revisited.

### Mutual TLS

Client certificates for both tiers.

Rejected because: the dashboard is browser-based, and client-cert auth in browsers is hostile UX. The API clients are heterogeneous (curl, SDKs); mTLS is operational overhead with no security gain over bearer tokens for the use case.

### JWT with rotation

Short-lived JWTs with a refresh flow for both tiers.

Rejected because: client SDKs (curl, hermes-agent) don't have a refresh-token dance baked in. Long-lived bearer tokens (revocable via the dashboard) are operationally simpler and the threat model (single-user self-host) doesn't need JWT rotation.

## References

- `src/auth.ts` — `requireApiKey`, `requireAdmin`, `csrfGuard`
- `src/auth/{password,session,rateLimit}.ts` — building blocks
- `src/api/admin/middleware.ts` — `requireAdminJson` (JSON-shaped admin gate for `/api/*`)
- `src/db/migrations/001-initial.ts` — `client_keys` + `sessions` tables
- `docs/architecture/CLAUDE.md` (legacy) — see `../../AGENTS.md` "Auth model" instead
- `docs/guides/debug-a-failed-request.md` — auth-failure debug
