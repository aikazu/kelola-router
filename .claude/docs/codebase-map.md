# Codebase Map

> Module dependency graph + entry points. For architectural overview see `ARCHITECTURE.md`. For terse lookup tables see `docs/reference/`.

## Why this exists

When refactoring, the agent needs to know what imports what and who calls whom. This file is the answer to "if I change X, what else breaks?". The dependency graph below is extracted from `import` statements across `src/` and `client/src/`.

## Top-level entry points

| File | Role | Imported by |
|---|---|---|
| `src/server.ts` | Hono app. Wires routes, middleware, the proxy dispatch. ~330 LOC. | `npm start`, `npm run dev:server` (and indirectly `tests/`) |
| `src/proxy/minimax.ts` | `handleProxy`: the MiniMax/OpenAI/Anthropic path. ~470 LOC. | `server.ts` (re-exports a wrapper) |
| `src/proxy/kiro.ts` | `handleKiroProxy`: the Kiro/AWS CodeWhisperer path. ~270 LOC. | `server.ts` |
| `src/proxy/combo.ts` | `handleComboProxy`: fallback chains across models. ~470 LOC. | `server.ts` |
| `src/proxy/helpers.ts` | 34 LOC of shared response/request utilities. | All 3 proxy handlers |
| `src/accounts/selection.ts` | `selectAccount`: the state machine. | All 3 proxy handlers |
| `src/accounts/state.ts` | `applyAccountError`, `isModelLockActive`. | All 3 proxy handlers |
| `src/db/index.ts` | `openDb()`, `migrate()`. Singleton via `getDb()`. | `server.ts`, every `db/repos/*.ts` |
| `client/src/main.tsx` | Preact entry. Mounts `<App />`. | `client/index.html` |
| `client/src/App.tsx` | QueryClientProvider + PrimeCache + AppShell. | `main.tsx` |
| `client/src/layout/AppShell.tsx` | Hash router (`#/admin/<page>`) + lazy page imports. | `App.tsx` |

## Server module dependency graph

`server.ts` imports (top-level only; not transitively listed):
- `hono` + middleware from `src/auth/index.ts` + `src/api/admin/`
- The 3 proxy handlers from `src/proxy/{minimax,kiro,combo}.ts`
- Scheduler: `src/scheduler/quota-pull.ts`
- Transport: `src/transport/resolve.ts` (used by proxy handlers, transitively)
- DB: `src/db/index.ts`

`src/proxy/minimax.ts` imports:
- `src/accounts/{selection,state,locks,error-rules,types}`
- `src/proxy/augment.ts` (caveman + cache_control)
- `src/console/{bus,flow}`
- `src/db/repos/{accounts,combos,request-logs,settings}`
- `src/providers/{alias,format/negotiate,format/transform,minimax,parse-error,pricing,upstream-fetch}`
- `src/rtk/`
- `src/providers/minimax/hot-path-metrics`
- `src/streaming/pipe-with-usage`
- `src/transport/resolve`
- `src/util/log`
- `src/proxy/{capture,helpers}`

`src/proxy/kiro.ts` imports the same minus RTK/proxy/augment/alias-negotiation, plus `src/providers/kiro/`.

`src/accounts/selection.ts` imports:
- `src/accounts/state` (filter helper)
- `src/accounts/types`

`src/accounts/state.ts` imports:
- `src/accounts/error-rules` (decision)
- `src/accounts/types`

`src/accounts/locks.ts` imports: `src/util/log` only. Pure SQL.

`src/db/repos/settings.ts` has 1s cache via `WeakMap<Database, Map>`. Imported by all repos that read settings + the proxy handlers + `src/api/admin/settings.ts`.

## Client module dependency graph

`client/src/main.tsx` → `App.tsx`

`App.tsx` imports:
- `@tanstack/react-query` (`QueryClientProvider`, `useQueryClient`)
- `client/src/components/{Confirm,ToastProvider}`
- `client/src/layout/AppShell`
- `client/src/lib/{api,query-client}`

`AppShell.tsx` imports all page components as `lazy(() => import(...))`. The `KNOWN_ROUTES` array + `switch (current)` are the dispatch.

Each page imports:
- `@tanstack/react-query` (`useQuery`, `useMutation`, `useQueryClient`)
- `client/src/components/*` (Card, Button, Modal, …)
- `client/src/lib/api` (`apiFetch`)
- `client/src/layout/TopBar` (most pages)

`client/src/lib/api.ts` exports `apiFetch<T>(path, opts)` which:
- prepends `/api`
- handles JSON request/response
- throws `ApiError` on non-2xx
- handles CSRF via `x-csrf-token` if a cookie is set

## Cyclic imports (be aware)

- `server.ts` ↔ `src/proxy/{minimax,kiro,combo}.ts`. Broken by passing a `CursorRef` ref-object from server.ts to the proxy handlers. See comment in `src/proxy/kiro.ts` line 27-30. Don't try to "fix" this; the ref pattern is intentional.
- `src/db/repos/*` ↔ `src/db/index.ts`. Repos import `openDb` from `db/index.ts`. Tests use a per-test db handle via `process.env.ROUTER_DB_PATH`. Don't cache the db handle in module scope.

## Where new code goes (decision tree)

| If you're adding… | Goes in… |
|---|---|
| New upstream provider | `src/providers/<name>/` + `src/proxy/<name>.ts` + extension to `ProviderName` in `db/repos/accounts.ts` |
| New admin route | `src/api/admin/<name>.ts` (Hono sub-router) + register in `src/api/admin/index.ts` |
| New repo function | `src/db/repos/<table>.ts` |
| New DB table | `src/db/migrations/00X-*.ts` + repo at `src/db/repos/<table>.ts` |
| New dashboard page | `client/src/pages/<Name>.tsx` + register in `AppShell` + entry in `Sidebar` |
| New shared UI component | `client/src/components/<Name>.tsx` |
| New error class / state machine | Extend `src/accounts/{state,selection,error-rules,types}.ts` |
| New console event | Extend `src/console/{types,flow}.ts` (union + builder) |

## Gotchas

- **Don't import from `src/proxy/*` into `src/server.ts` other than the handler function.** The handlers are the only public surface. The proxy module also imports `providers/minimax/hot-path-metrics`; that's a singleton meant to be imported by proxy handlers only.
- **Don't add `any` to a repo return type.** If the SQL column is nullable, return `T | null` (not `undefined`); tests rely on this.
- **Don't add new state machine logic outside `src/accounts/`.** Selection / backoff / lock is one cohesive module; spread it and you lose the invariants.
- **Don't break the `CursorRef` pattern.** `server.ts` owns the in-memory `rrCursor` and `stickyMap`; the proxy handlers mutate them through a ref. Don't try to lift the state into a module-global; that breaks test isolation.
- **Don't import `better-sqlite3` types in client code.** The dashboard is browser-side; server types don't flow there.

## Cross-refs

- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md): module map (visual)
- [`../../AGENTS.md`](../../AGENTS.md): TDD + test patterns
- [`../docs/guides/add-a-provider.md`](../docs/guides/add-a-provider.md): provider integration checklist
- [`../docs/guides/add-an-admin-endpoint.md`](../docs/guides/add-an-admin-endpoint.md): admin route checklist
- [`../docs/guides/add-a-dashboard-page.md`](../docs/guides/add-a-dashboard-page.md): page checklist
- [`../docs/guides/add-a-migration.md`](../docs/guides/add-a-migration.md): migration checklist
- [`../skills/add-provider/SKILL.md`](../skills/add-provider/SKILL.md): provider skill
