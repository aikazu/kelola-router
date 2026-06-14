# CLI Scripts

All CLI entry points. The dashboard covers everything here; these are power-user shortcuts and seed/reset operations. Source: `package.json` `scripts` field + `scripts/*.ts` (each is a `tsx` script runnable directly).

| Script | Command | Purpose |
|---|---|---|
| Dev (both) | `npm run dev` | Run server (`tsx watch :20137`) + client (`vite :5173`) concurrently |
| Dev (server) | `npm run dev:server` | Backend only |
| Dev (client) | `npm run dev:client` | Frontend only |
| Build | `npm run build` | `vite build` client → `client/dist/`, then `tsc` → `dist/` |
| Start | `npm start` | `node dist/server.js` (production) |
| Test | `npm test` | Vitest run (server) |
| Test (client) | `npm run test:client` | Vitest run (client SPA) |
| Test (watch) | `npm run test:watch` | Vitest watch mode |
| Typecheck | `npm run typecheck` | `tsc --noEmit` (server only; client needs `cd client && npm run typecheck`) |
| Lint | `npm run lint` | `biome check .` |
| Lint (fix) | `npm run lint:fix` | `biome check --write .` |

## Data scripts (`scripts/*.ts`)

Idempotent / destructive operations. Prefer the dashboard for non-bulk work.

| Script | Command | Idempotent? | Purpose |
|---|---|---|---|
| Add client key | `npm run add-client-key -- --label <name>` | yes (label is the natural key) | Create a new client key, print the bearer once |
| Add MiniMax account | `npm run add-account -- --label <name> --credit-type payg\|token-plan --api-key mm_xxx` | yes (label) | Create a MiniMax upstream account |
| Add Kiro account | `npm run add-kiro-account -- --label <name> --refresh-token eyJ...` (+ optional `--client-id`/`--client-secret`/`--region`/`--profile-arn`) | yes (label) | Create a Kiro account; refresh token stored in `api_key` |
| Seed MiniMax models | `npm run seed-models` | yes (upsert by `upstream_model`) | Upsert the 9 builtin MiniMax models |
| Seed Kiro models | `npm run seed-kiro-models` | yes | Upsert builtin Kiro (Claude / AWS) models |
| Add CodeBuddy account | `tsx scripts/add-codebuddy-account.ts` | yes (label) | Add a CodeBuddy account (API key) |
| Seed CodeBuddy models | `tsx scripts/seed-codebuddy-models.ts` | yes | Upsert builtin CodeBuddy models |
| Reset | `npm run reset` | **destructive** | Remove `router.db` + WAL/SHM sidecars. Wipes all data |

## Argument conventions

- All `--label` values are user-defined, used as the natural key. Re-running with the same label updates in place where possible.
- `--api-key` and `--refresh-token` values are **never echoed back** after creation. Store the value before running.
- For multi-line / special-character values, wrap in single quotes: `--api-key 'mm_abc...xyz'`.

## Output convention

All scripts print a one-line summary to stdout. Errors go to stderr with a non-zero exit code. No interactive prompts.

Regenerate this table when scripts are added/removed. Source: `package.json` `scripts` field + `scripts/*.ts`.
