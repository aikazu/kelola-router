# Settings Keys

Keys stored in the `settings` table. Read via `getSetting(db, '...')` (1s cache) and written via `setSetting(db, '...', value)`. Source: grep `getSetting` and `setSetting` across `src/`.

| Key | Type | Default | Purpose | Set by |
|---|---|---|---|---|
| `caveman` | `{ level: 'off' \| 'lite' \| 'full' }` | `{ level: 'off' }` | System-prompt compression level | `POST /api/admin/settings/caveman` |
| `rtk` | `{ enabled: boolean }` | `{ enabled: false }` | Runtime filter compression (RTK) toggle | `POST /api/admin/settings/rtk` |
| `caching` | `{ autoBreakpoints: boolean }` | `{ autoBreakpoints: false }` | Inject `cache_control` breakpoints on system + last user message | `POST /api/admin/settings/caching` |
| `minimax` | `{ upstreamFormat?: 'openai' \| 'anthropic' }` | `{}` | Per-provider body conversion override. Empty = `auto` (detect from client) | `POST /api/admin/settings/minimax` + `ROUTER_UPSTREAM_FORMAT` env |
| `selection.minimax` | `{ mode: 'lowest-backoff' \| 'round-robin' \| 'sticky', step: number }` | `{ mode: 'lowest-backoff', step: 1 }` | Account selection strategy for MiniMax accounts | `GET/POST /api/admin/settings/selection/:provider` |
| `selection.kiro` | same shape as `selection.minimax` | same | Account selection strategy for Kiro accounts | same |
| `transport` | `{ relay?: string, proxy?: string, proxyFailureMode?: 'direct' \| 'block' }` | `{}` | Legacy global transport fallback. Per-account transports (in the `transports` table) override this | `PUT /api/admin/transports/failure-mode` for `proxyFailureMode`; older fields rarely set |
| `admin_password` | scrypt string | `null` | Hashed password for the dashboard login. Null = open mode | `POST /api/admin/settings/password`, cleared via `setSetting(..., null)` |
| `build.version` | string | (none) | Build version string surfaced on the dashboard sidebar | Set by build pipeline |

## Special values

- **`null`** is what `getSetting` returns for an unset key (NOT `undefined`). Repos coerce `?? null` to satisfy `T | null` signatures. Tests rely on this.
- **JSON values** are stored as TEXT. `getSetting` parses them — never store raw strings.
- **Cache TTL**: 1s for most keys, 5s for `transport` (see `src/db/repos/settings.ts`). Call `clearCacheForDb(db)` in tests when changing settings mid-test.

Regenerate when keys are added/removed/deprecated. Source: `grep -rEon "getSetting\([^,]+, ['\"][^'\"]+['\"]" src/`.
