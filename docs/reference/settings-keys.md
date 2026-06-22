# Settings Keys

Keys stored in the `settings` table. Read via `getSetting(db, '...')` (1s cache) and written via `setSetting(db, '...', value)`. Typed reads: `getSettingT<K extends SettingKey>(db, key): SettingsMap[K] | null`. Source: `src/db/repos/settings.types.ts` (`SETTINGS_SCHEMAS` registry) + `src/api/admin/settings.ts`.

| Key | Type | Default | Purpose | Set by |
|---|---|---|---|---|
| `caveman` | `{ level: 'off' \| 'terse' \| 'ultra' }` | `{ level: 'off' }` | System-prompt compression level | `POST /api/admin/settings/caveman` |
| `rtk` | `{ enabled: boolean, minCompressSize?: number, rawCap?: number, filters?: string[] }` | `{ enabled: true }` | Runtime filter compression (RTK) toggle + tuning knobs | `POST /api/admin/settings/rtk` |
| `caching` | `{ autoBreakpoints: boolean, respectCallerMarkers?: boolean }` | `{ autoBreakpoints: true }` | Inject `cache_control` breakpoints on system + last user message | `POST /api/admin/settings/caching` |
| `minimax` | `{ upstreamFormat?: 'auto' \| 'openai' \| 'anthropic', m3DefaultMaxCompletionTokens?: number }` | `{}` | Per-provider body conversion override. Empty / missing `upstreamFormat` = `auto` (detect from client). `m3DefaultMaxCompletionTokens` applies when M3 model requested without explicit value | `POST /api/admin/settings/minimax` + `ROUTER_UPSTREAM_FORMAT` env |
| `transport` | `{ relay: RelayConfig \| null, proxy: ProxyConfig \| null, proxyFailureMode?: 'direct' \| 'block' }` | `{ relay: null, proxy: null }` | Global transport fallback. Per-account transports (in the `transports` table) override this. `proxyFailureMode` defaults to `'direct'` | `PUT /api/admin/transports/failure-mode` for `proxyFailureMode`; relay/proxy rows via `transports` table |
| `admin_password` | scrypt string \| `null` | `null` | Hashed password for the dashboard login. Null = open mode | `POST /api/admin/settings/password`, cleared via `setSetting(..., null)` |
| `build` | `{ version: string }` | `{ version: <package.json> }` | Build version string surfaced on the dashboard sidebar. Auto-synced on server boot | Set by `server.ts` boot from `package.json` |
| `selection.minimax` | `{ mode: 'lowest-backoff' \| 'round-robin' \| 'sticky', step?: number }` | `{ mode: 'lowest-backoff', step: 1 }` | Account selection strategy for MiniMax accounts | `GET/POST /api/admin/settings/selection/minimax` |
| `selection.kiro` | same shape as `selection.minimax` | same | Account selection strategy for Kiro accounts | `GET/POST /api/admin/settings/selection/kiro` |
| `selection.codebuddy` | same shape as `selection.minimax` | same | Account selection strategy for CodeBuddy accounts | `GET/POST /api/admin/settings/selection/codebuddy` |
| `selection.pioneer` | same shape as `selection.minimax` | same | Account selection strategy for Pioneer accounts | `GET/POST /api/admin/settings/selection/pioneer` |
| `selection.notion` | same shape as `selection.minimax` | same | Account selection strategy for Notion accounts (schema-registered; v1 Notion has no multi-account failover, so no current reader branches on this; see CHANGELOG 0.20.0) | `GET/POST /api/admin/settings/selection/notion` |
| `selection.zai` | same shape as `selection.minimax` | same | Account selection strategy for Z.AI accounts | `GET/POST /api/admin/settings/selection/zai` |

## Special values

- **`null`** is what `getSetting` returns for an unset key (NOT `undefined`). Repos coerce `?? null` to satisfy `T | null` signatures. Tests rely on this.
- **JSON values** are stored as TEXT. `getSetting` parses them; never store raw strings.
- **Cache TTL**: 1s for most keys. Call `clearCacheForDb(db)` in tests when changing settings mid-test.
- **Optional fields** in object schemas (`minCompressSize`, `respectCallerMarkers`, `m3DefaultMaxCompletionTokens`, `proxyFailureMode`, `step`) are tolerated by the valibot schemas because the dashboard POST handlers may write partial objects. Readers guard each field individually with `?.` or fall back to a hardcoded default.

Regenerate when keys are added/removed/deprecated. Source: `src/db/repos/settings.types.ts` (`SETTINGS_SCHEMAS` registry) + `src/api/admin/settings.ts`.
