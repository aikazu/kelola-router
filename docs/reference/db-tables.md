# DB Tables

Schema reference for every table in the SQLite-WAL database. Source: `src/db/migrations/00{1,2,3,4,5,6}-*.ts`. Migrations tracked via `PRAGMA user_version` (current = 6). All migrations are additive (`ALTER TABLE ADD COLUMN`) after `001-initial`.

## `accounts` (`001-initial` + 4 ALTERs)

Upstream credentials (MiniMax API key or Kiro OAuth refresh token).

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `acc_<ulid>` |
| `label` | TEXT NOT NULL | human-readable |
| `credit_type` | TEXT NOT NULL CHECK (`payg` / `token-plan`) | MiniMax only; Kiro rows use `payg` |
| `api_key` | TEXT NOT NULL UNIQUE | MiniMax: API key. Kiro: OAuth refresh token |
| `base_url` | TEXT NULL | optional override (MiniMax region usually via env) |
| `enabled` | INT NOT NULL DEFAULT 1 | soft-disable without losing the row |
| `rate_limited_until` | TEXT NULL | ISO timestamp; account skipped while in future |
| `backoff_level` | INT NOT NULL DEFAULT 0 | exponential backoff counter |
| `last_error` | TEXT NULL | `{status, message, timestamp, baseRespCode}` JSON |
| `status` | TEXT NOT NULL DEFAULT `active` CHECK (`active` / `error` / `disabled`) | `error` set on 401; cleared on next success |
| `created_at` | TEXT NOT NULL DEFAULT `(datetime('now'))` | |
| `provider` | TEXT NOT NULL DEFAULT `minimax` (`002-kiro`) | `minimax` or `kiro` |
| `access_token` | TEXT NULL (`002-kiro`) | Kiro: cached short-lived bearer |
| `token_expires_at` | TEXT NULL (`002-kiro`) | Kiro: ISO timestamp |
| `provider_data` | TEXT NULL (`002-kiro`) | Kiro: JSON `{clientId, clientSecret, region, profileArn, authMethod}` |
| `relay_id` | TEXT NULL (`003-transports`) | single relay (mutually exclusive with proxy*) |
| `proxy_id` | TEXT NULL (`003-transports`) | single proxy |
| `proxy_pool` | TEXT NULL (`003-transports`) | JSON array of proxy transport ids |
| `proxy_rotate_every` | INT NOT NULL DEFAULT 1 (`003-transports`) | advance pool cursor every N requests |

\* `resolveTransportForAccount` enforces mutual exclusion at fetch time.

## `account_model_locks` (`001-initial`)

Per-(account, model) temporary lock to stop hammering a failing model on one account.

| Column | Type | Notes |
|---|---|---|
| `account_id` | TEXT NOT NULL | FK → `accounts(id)` ON DELETE CASCADE |
| `model` | TEXT NOT NULL | |
| `locked_until` | TEXT NOT NULL | ISO timestamp; lock auto-expires |

PK: `(account_id, model)`.

## `client_keys` (`001-initial`)

Bearer credentials for clients (Claude Code, hermes-agent).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `label` | TEXT NOT NULL | |
| `key` | TEXT NOT NULL UNIQUE | opaque bearer |
| `enabled` | INT NOT NULL DEFAULT 1 | soft-disable |
| `created_at` | TEXT NOT NULL DEFAULT `(datetime('now'))` | |

Unique partial index `idx_client_keys_active_key` on `key WHERE enabled = 1` — a disabled key can be re-enabled with the same secret.

## `request_logs` (`001-initial` + 1 ALTER)

Per-request telemetry. 29 columns. Full schema in `src/db/repos/requestLogs.ts` (the `RequestLog` interface). Key columns: `id`, `client_key_id`, `account_id`, `model`, `requested_model` (alias if any), `endpoint`, `format` (`openai` / `anthropic`), `prompt_tokens`, `completion_tokens`, `cache_creation_tokens`, `cache_read_tokens`, `total_tokens`, `cost_usd`, `latency_ms`, `ttft_ms`, `status_code`, `base_resp_code`, `stream` (0/1), `relay_path`, `proxy_path`, `rtk_bytes_saved`, `caveman_level`, `error_message`, `request_body`, `response_body`, `request_headers`, `response_headers`, `error`, `req_id` (added `004-reqid`), `created_at`.

Retention: pruned at `REQUEST_LOG_RETENTION_DAYS` (default 30) by `src/scheduler/quotaPull.ts`.

## `quota_snapshots` (`001-initial`)

Per-account quota poll results. Columns: `id`, `account_id` (FK CASCADE), `source` (e.g. `minimax-dashboard`), `model_name`, `total_count`, `remaining_count`, `used_count`, `remaining_percent`, `remains_time` (seconds), `window_type` (`5h` / `weekly` / …), `window_start`, `window_end`, `raw_response` (full JSON), `fetched_at`.

Latest snapshot per `(model_name, window_type)` is what the Quota page renders.

## `models` (`001-initial` + 1 ALTER)

Catalog of upstream models + pricing.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `name` | TEXT NOT NULL UNIQUE | router-facing name (what clients send) |
| `display_name` | TEXT NULL | human label |
| `family` | TEXT NULL | e.g. `m3`, `m2.7`, `kiro` |
| `upstream_model` | TEXT NOT NULL | unique-indexed — actual wire id |
| `context_window` | INT NULL | |
| `pricing_input` | REAL NULL | USD per 1M tokens |
| `pricing_output` | REAL NULL | |
| `pricing_cache_read` | REAL NULL | |
| `pricing_cache_write` | REAL NULL | |
| `pricing_tiers` | TEXT NULL | JSON: per-tier pricing (base/highspeed/promotional) |
| `capabilities` | TEXT NULL | JSON array |
| `source` | TEXT NOT NULL DEFAULT `''` | `builtin` / `user` / `fetched` |
| `enabled` | INT NOT NULL DEFAULT 1 | |
| `created_at` | TEXT NOT NULL DEFAULT `(datetime('now'))` | |
| `provider` | TEXT NOT NULL DEFAULT `minimax` (`002-kiro`) | |

## `model_aliases` (`001-initial`)

| Column | Type | Notes |
|---|---|---|
| `alias_name` | TEXT PK | what the client sends |
| `upstream_model` | TEXT NOT NULL | resolved to a `models.upstream_model` |
| `label` | TEXT NULL | |
| `source` | TEXT NOT NULL DEFAULT `''` | `builtin` / `user` |
| `created_at` | TEXT NOT NULL DEFAULT `(datetime('now'))` | |

Unique constraint: `alias_name` must not collide with `combos.name` (enforced in `createCombo`).

## `combos` (`005-combos`)

Ordered fallback chain: request a combo name → try each model in sequence.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `combo_<ulid>` |
| `name` | TEXT NOT NULL UNIQUE | client-facing; conflicts with aliases |
| `models` | TEXT NOT NULL | JSON array of model names (ordered) |
| `created_at` | TEXT NOT NULL DEFAULT `(datetime('now'))` | |
| `updated_at` | TEXT NOT NULL DEFAULT `(datetime('now'))` | |

## `transports` (`003-transports`)

Proxy / relay endpoints.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `label` | TEXT NOT NULL | |
| `type` | TEXT NOT NULL CHECK (`proxy` / `relay`) | |
| `kind` | TEXT NOT NULL | `proxy`: `http` / `socks5`. `relay`: `vercel` / `cloudflare` |
| `url` | TEXT NOT NULL | |
| `enabled` | INT NOT NULL DEFAULT 1 | |
| `created_at` | TEXT NOT NULL DEFAULT `(datetime('now'))` | |
| `country` | TEXT NULL | Geoip country code (e.g. 'SG'), null until probed |

## `sessions` (`001-initial`)

Dashboard session cookies (when password is set). Columns: `id` (PK), `user_agent`, `ip`, `created_at`, `expires_at` (7-day TTL), `last_seen`. Cleaned by `cleanupExpiredSessions` in `src/scheduler/quotaPull.ts`.

## `settings` (`001-initial`)

Generic key-value store for all runtime config. Columns: `key` (PK), `value` (TEXT JSON), `updated_at`. See `docs/reference/settings-keys.md` for the live key inventory.

## Indexes

`001-initial` also ships these additive indexes (safe to re-run on existing DBs):

- `idx_logs_client_created` on `request_logs(client_key_id, created_at DESC)`
- `idx_logs_account_created` on `request_logs(account_id, created_at DESC)`
- `idx_logs_model_created` on `request_logs(model, created_at DESC)`
- `idx_logs_status` on `request_logs(status_code, created_at DESC)`
- `idx_logs_model_created_cost` on `request_logs(model, created_at, cost_usd)`
- `idx_logs_created_at` on `request_logs(created_at DESC)`
- `idx_accounts_enabled_status` on `accounts(enabled, status, credit_type)`
- `idx_client_keys_active_key` UNIQUE on `client_keys(key) WHERE enabled = 1`
- `idx_quota_account_fetched` on `quota_snapshots(account_id, fetched_at DESC)`

## Migrations

| # | File | Adds |
|---|---|---|
| 1 | `001-initial.ts` | All tables above (consolidated). `user_version` 0 → 1 |
| 2 | `002-kiro.ts` | Kiro columns on `accounts` + `models` |
| 3 | `003-transports.ts` | `transports` table + 4 columns on `accounts` |
| 4 | `004-reqid.ts` | `req_id` on `request_logs` |
| 5 | `005-combos.ts` | `combos` table |
| 6 | `006-transport-country.ts` | `country` column on `transports` |

Current `user_version` = 6. Each migration is additive (no schema rewrites); existing rows survive upgrade.
