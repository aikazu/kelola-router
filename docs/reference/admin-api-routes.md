# Admin API Routes

All routes under `/api/admin/*` (Hono router). All require admin auth (session cookie / `x-admin-key` / open mode). All POST/PATCH/PUT/DELETE are blocked by a CSRF guard when `Origin` does not match `Host`. Source: `src/api/admin/*.ts`.

## Auth (`src/api/admin/auth.ts`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/me` | Current auth state: `{ authed, passwordSet }` |
| `POST` | `/api/login` | Login (rate-limited 5/15min/IP) |
| `POST` | `/api/logout` | Destroy session cookie |

## Re-auth gate (`src/api/admin/reauth.ts`)

Short-lived (60s) HttpOnly re-auth cookie that gates sensitive reveal operations (for example, client-key bearer). Cleared on timeout or explicit clear.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/admin/reauth/verify` | Verify dashboard password; set the re-auth cookie |
| `POST` | `/api/admin/reauth/clear` | Clear the re-auth cookie |

## Security (`src/api/admin/security.ts`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/security/status` | Deployment security posture `{ mode: 'open'\|'password', dbEncrypted, dbKeySet }` for the `SecurityBanner` |

## Overview & usage

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/overview` | Dashboard summary: counts, last 24h cost, errors |
| `GET` | `/api/admin/usage` | Aggregated usage: by model, by client key, by day, by hour |
| `GET` | `/api/admin/request-logs/:id` | Single request log row (with bodies + headers) |
| `GET` | `/api/admin/request-logs/by-req-id/:reqId` | Request log row by console `reqId` (correlates to live console blocks) |

## Client keys (`src/api/admin/client-keys.ts`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/client-keys/` | List all client keys (masked) |
| `POST` | `/api/admin/client-keys/` | Create new key. Returns full plaintext key once |
| `GET` | `/api/admin/client-keys/:id/key` | Reveal the full bearer. Requires re-auth cookie from `POST /api/admin/reauth/verify` (else `401 reauth_required`); writes an `audit_log` event on reveal |
| `PATCH` | `/api/admin/client-keys/:id` | Update label / enabled |
| `POST` | `/api/admin/client-keys/:id/enable` | Enable a disabled key |
| `POST` | `/api/admin/client-keys/:id/disable` | Disable (soft; keeps the row) |
| `DELETE` | `/api/admin/client-keys/:id` | Hard delete |

## Accounts (`src/api/admin/accounts.ts`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/accounts/` | List accounts (all providers). Each row shows provider, credit_type, status, backoff |
| `POST` | `/api/admin/accounts/` | Provider-aware create (label, credit_type, api_key, base_url). `provider` body field selects `minimax` (default) / `codebuddy` / `pioneer` (allowlist). `credit_type` defaults to `payg` for pioneer, else `token-plan`. Seeds the provider model catalogue (best-effort). Kiro uses `POST /api/admin/accounts/kiro`. |
| `PATCH` | `/api/admin/accounts/:id` | Update label / enabled / base_url / provider_data / transport assignment |
| `POST` | `/api/admin/accounts/:id/enable` | Enable |
| `POST` | `/api/admin/accounts/:id/disable` | Disable |
| `DELETE` | `/api/admin/accounts/:id` | Hard delete |
| `GET` | `/api/admin/accounts/:id/usage` | Per-account usage aggregates |
| `GET` | `/api/admin/accounts/:id/locks` | List active per-model locks for this account |
| `DELETE` | `/api/admin/accounts/:id/locks/:model` | Clear a single model lock |
| `POST` | `/api/admin/accounts/kiro` | Create a Kiro account (manual token / idc / social method) |
| `POST` | `/api/admin/accounts/kiro/device-code` | Start AWS Builder ID / IDC device-code flow |
| `POST` | `/api/admin/accounts/kiro/poll` | Poll device-code token endpoint until user completes browser step |
| `GET` | `/api/admin/accounts/kiro/auto-import` | Read `~/.aws/sso/cache` and return candidate profiles for one-click import |
| `POST` | `/api/admin/accounts/notion/request-otp` | Notion 3-step auth: step 1: submit email, request a 6-char temp password |
| `POST` | `/api/admin/accounts/notion/verify-otp` | Notion 3-step auth: step 2: submit temp password, persist 11 cookies in `provider_data` JSON |
| `GET` | `/api/admin/accounts/notion/reauth-required` | Returns whether any active Notion account has expired / missing cookies and needs re-auth |

## Models (`src/api/admin/models.ts`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/models/` | List models with `aliasCount` + `contextOutput` + `comboCount` per model |
| `POST` | `/api/admin/models/` | Manually add a model (name, upstream_model, pricing, …). `family` field persisted (whitespace-only → `null`) |
| `POST` | `/api/admin/models/fetch/:provider` | Pull upstream model list and upsert. Supports `minimax` + `pioneer`; 404 for others; 400 when no active account; 502 on upstream failure |
| `POST` | `/api/admin/models/bulk-toggle` | Enable/disable a set of model names in one call |
| `POST` | `/api/admin/models/:name/enable` | Enable a single model |
| `POST` | `/api/admin/models/:name/disable` | Disable a single model |
| `POST` | `/api/admin/models/:name/test` | Send a minimal completion to this model through the router; reports latency + status (stateless) |
| `GET` | `/api/admin/models/:name/refs` | Alias + combo references for this model (powers the "X references" UI in the dashboard) |
| `PATCH` | `/api/admin/models/:name` | Update editable fields (rejects unknown / wrong-type / empty patch; name + upstream_model immutable) |
| `DELETE` | `/api/admin/models/:name` | Hard delete. `409 has_refs` when an alias or combo still references the model |

## Aliases (`src/api/admin/aliases.ts`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/aliases/` | List all model aliases |
| `POST` | `/api/admin/aliases/` | Create alias (alias_name, upstream_model, label). Rejects names conflicting with an existing combo (per ADR 0008) |
| `PUT` | `/api/admin/aliases/:name` | Update upstream_model / label / source |
| `DELETE` | `/api/admin/aliases/:name` | Delete alias |

## Combos (`src/api/admin/combos.ts`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/combos/` | List combos |
| `POST` | `/api/admin/combos/` | Create combo (name + ordered model list). Rejects names conflicting with an existing alias |
| `PUT` | `/api/admin/combos/:id` | Update models list |
| `DELETE` | `/api/admin/combos/:id` | Delete combo |

## Quota (`src/api/admin/quota.ts`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/quota` | Latest quota snapshot per `(model_name, window_type)`, grouped for the Quota page. Response shape: `{ accounts: QuotaAccountResult[] }` where each entry is `{ ok: true, windows: QuotaWindow[] }` or `{ ok: false, windows: [], error: string }` |
| `POST` | `/api/admin/quota/pull` | Manually trigger a quota pull (default runs every scheduler tick) |

## Settings (`src/api/admin/settings.ts`)

`GET /api/admin/settings/` returns `null` for un-written keys (per audit-fix A7); the client merges UI defaults. The keys + schemas live in `src/db/repos/settings.types.ts` (`SETTINGS_SCHEMAS`).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/settings/` | Read all settings (caveman, rtk, caching, minimax, transport, build, selection.*, admin_password) |
| `POST` | `/api/admin/settings/caveman` | Set caveman level (`off` \| `terse` \| `ultra`) |
| `POST` | `/api/admin/settings/rtk` | Set rtk enabled |
| `POST` | `/api/admin/settings/caching` | Set caching.autoBreakpoints |
| `POST` | `/api/admin/settings/minimax` | Set minimax.upstreamFormat |
| `GET` | `/api/admin/settings/selection/:provider` | Read account selection mode + step for `provider ∈ {minimax, kiro, codebuddy, pioneer, notion, zai}` |
| `POST` | `/api/admin/settings/selection/:provider` | Set selection mode + step |
| `POST` | `/api/admin/settings/password` | Set / change dashboard password (scrypt) |

## Transports (`src/api/admin/transports.ts`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/transports/` | List proxy + relay transports |
| `POST` | `/api/admin/transports/` | Create a new transport (proxy or relay) |
| `PATCH` | `/api/admin/transports/:id` | Update label / url / enabled |
| `DELETE` | `/api/admin/transports/:id` | Hard delete |
| `POST` | `/api/admin/transports/bulk-delete` | Delete a set of transport ids in one call |
| `POST` | `/api/admin/transports/:id/test` | Probe the transport (TCP connect + GeoIP lookup) |
| `GET` | `/api/admin/transports/failure-mode` | Read `proxyFailureMode` (`'direct'` default) |
| `PUT` | `/api/admin/transports/failure-mode` | Set `'direct'` (fall back) or `'block'` (return error) |

Regenerate this file when routes are added/removed. Source: `grep -rEn "(get|post|patch|delete|put)\(['\"]/" src/api/`.
