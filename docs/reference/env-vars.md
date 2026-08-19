# Environment Variables

All `ROUTER_*` env vars read by the server, plus other vars the router respects. Source: `src/util/env.ts` and direct `process.env.*` reads across `src/`. Defaults shown are what the code uses when the var is unset.

| Var | Default | Where read | Purpose |
|---|---|---|---|
| `HOST` | `127.0.0.1` | `src/util/env.ts:7` | Server bind address |
| `PORT` | `20137` | `src/util/env.ts:11` | Server bind port |
| `LOG_LEVEL` | `info` | `src/util/env.ts:27` | Pino level: `trace`/`debug`/`info`/`warn`/`error`/`fatal` |
| `ROUTER_DB_PATH` | `~/.local/share/kelola-router/router.db` (or `%APPDATA%` on Windows) | `src/util/env.ts:21` + `src/db/index.ts:11` | Override SQLite path. Docker mount: `/data/router.db` |
| `ROUTER_DB_KEY` | (unset → unencrypted) | `src/util/env.ts` (getDbKey) + `src/db/index.ts` | SQLCipher encryption-at-rest key. When set, DB is encrypted via better-sqlite3-multiple-ciphers. Fresh-deploy only (refuses to open an existing unencrypted file). Lives only in process env |
| `MINIMAX_REGION` | `intl` | `src/util/env.ts:17` | Upstream region: `intl` or `cn`. Switches MiniMax base URL via `src/providers/baseUrl.ts` |
| `MINIMAX_API_KEY` | (none) | `.env.example` | Convenience for local passthrough testing only. Does NOT auto-create an account. Real accounts live in the `accounts` table (add via dashboard or `npm run add-account`). Not read by app code; reserved for manual/test use only. |
| `ROUTER_ADMIN_KEY` | (none) | `src/auth/index.ts:121` + `src/api/admin/middleware.ts:18` | If set, dashboard accepts the `x-admin-key` header. Used by scripts. Ignored if no password is set (open mode) |
| `ROUTER_COOKIE_SECURE` | unset | `src/auth/index.ts:22` | Set to `1` to force the `Secure` flag on session cookies. Auto-set when `x-forwarded-proto=https` |
| `ROUTER_UPSTREAM_FORMAT` | `auto` | `src/proxy/minimax.ts:142` + `src/proxy/combo.ts:57` | Override `settings.minimax.upstreamFormat`. `auto` = detect from client. `openai` / `anthropic` force a side |
| `REQUEST_LOG_RETENTION_DAYS` | `30` | `src/scheduler/quota-pull.ts:9` | Days to keep `request_logs` rows before prune. Set by the quota-pull scheduler tick |
| `CONSOLE_FLOW` | (enabled) | `src/console/sink.ts:14` | Set to `0` to silence the per-request ANSI flow on stdout. SSE stream to dashboard is unaffected |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` / `ALL_PROXY` | (none) | `src/transport/proxy-fetch.ts:47-62` | Standard proxy env vars. Honored by global proxy fetch. Account-specific transports in the `transports` table take precedence |
| `VITEST` | (none) | `src/server.ts:303` | When set (vitest auto-sets it), `server.ts` skips `listen()` so test suites can import the Hono app without port conflicts |
| `XDG_DATA_HOME` | `~/.local/share` | `src/db/index.ts:19` | Linux: parent of the default DB directory |
| `APPDATA` | (none) | `src/db/index.ts:17` | Windows: parent of the default DB directory |

Regenerate this table when env vars are added/removed/deprecated. Source files listed in the column above.
