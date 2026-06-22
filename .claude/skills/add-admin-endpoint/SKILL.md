---
name: add-admin-endpoint
description: Add a new Hono route under /api/admin/* with admin auth + CSRF guard + JSON error handling.
when-to-use: When the user asks to add a new admin API endpoint, dashboard data source, or admin CRUD route.
---

# Add an Admin API Endpoint

Full playbook: `docs/guides/add-an-admin-endpoint.md`. Read it first.

## Steps

1. **Route module**: `src/api/admin/<name>.ts`. Export `<name>Routes = new Hono()`. Each handler wraps the body in `try { ... } catch (e) { return handleApiError(e); }`. Use `throw new ApiError('code', 'msg', status)` for input errors. `c.get('db') as Database.Database` for the DB.
2. **Register**: `src/api/admin/index.ts`: `app.route('/admin/<name>', <name>Routes)`. Admin auth + CSRF guard already applied at the top of the file.
3. **Repo (if new table or new CRUD)**: `src/db/repos/<name>.ts`. Use `cachedStmt(db, sql)` for prepared statements. Return `T | null` (not `undefined`). Use `ulid()` for IDs, `datetime('now')` defaults.
4. **Migration (if new table)**: see `add-migration` skill.
5. **Test**: `src/api/admin/<name>.test.ts`. Pattern: `process.env.ROUTER_DB_PATH = join(mkdtempSync(...), 't.db')` in `beforeEach`, `resetDb()` from `src/server.ts`, call your `createApp(db)`. Use `mockResolvedValueOnce` for single-shot fetch mocks, `mockImplementation` for multi-shot (Response bodies are single-read).
6. **Route inventory**: `docs/reference/admin-api-routes.md`: add a row to the appropriate section.

## Test

```bash
npm test -- <name>
npx vitest run src/api/admin/<name>.test.ts
npm run typecheck
```

## Commit

```bash
git commit -m "feat(admin): add /api/admin/<name> endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## See also

- `docs/guides/add-an-admin-endpoint.md`: full playbook with code + checklist
- `docs/reference/admin-api-routes.md`: existing route inventory
- `src/api/admin/middleware.ts`: `requireAdminJson`, `ApiError`, `handleApiError`
