# CLI Scripts

All CLI entry points. The dashboard covers everything here; these are power-user shortcuts and seed/reset operations. Source: `package.json` `scripts` field + `scripts/*.ts` (each is a `tsx` script runnable directly).

Models auto-seed per-provider on account-add, so the `seed-*` scripts are manual idempotent re-seeds, not required for first run.

| Script | Command | Purpose |
|---|---|---|
| Dev (both) | `npm run dev` | Run server (`tsx watch :20137`) + client (`vite :5173`) concurrently |
| Dev (server) | `npm run dev:server` | Backend only |
| Dev (client) | `npm run dev:client` | Frontend only |
| Build | `npm run build` | `vite build` client → `client/dist/`, then `tsc` → `dist/` |
| Build (client) | `npm run build:client` | `cd client && vite build` only |
| Start | `npm start` | `node dist/server.js` (production) |
| Test | `npm test` | Vitest run (server) |
| Test (client) | `npm run test:client` | Vitest run (client SPA) |
| Test (watch) | `npm run test:watch` | Vitest watch mode |
| Typecheck | `npm run typecheck` | `tsc --noEmit` (server only; client needs `cd client && npm run typecheck`) |
| Lint | `npm run lint` | `biome check .` |
| Lint (fix) | `npm run lint:fix` | `biome check --write .` |

## Data scripts (`scripts/*.ts`)

Idempotent / destructive operations. Prefer the dashboard for non-bulk work.

Every `scripts/<name>.ts` has two npm-script entries: a bare one for local use and a `<name>:docker` variant that pins `ROUTER_DB_PATH=./data/router.db` for the Docker volume mount. The `seed-all` / `seed-all:docker` scripts fan out across every provider in one call.

| Script | Command | Idempotent? | Purpose |
|---|---|---|---|
| Add client key | `npm run add-client-key -- --label <name>` | yes (label is the natural key) | Create a new client key, print the bearer once |
| Add account (MiniMax) | `npm run add-account -- --label <name> --credit-type payg\|token-plan --api-key mm_xxx` | yes (label) | Create a MiniMax upstream account |
| Add account (Kiro) | `npm run add-account -- --provider kiro --label <name> --refresh-token eyJ...` (+ optional `--client-id`/`--client-secret`/`--region`/`--profile-arn`) | yes (label) | Create a Kiro account; refresh token stored in `api_key` |
| Add account (CodeBuddy) | `npm run add-account -- --provider codebuddy --label <name> --api-key <key>` | yes (label) | Add a CodeBuddy account (API key) |
| Add account (Pioneer) | `npm run add-account -- --provider pioneer --label <name> --api-key <key>` | yes (label) | Add a Pioneer account (X-API-Key); models live-seed on add |
| Add account (Notion) | `npm run notion-add-account` | yes (label) | Interactive 3-step OTP login (email → temp password → cookies persisted in `provider_data` JSON) |
| Seed MiniMax models | `npm run seed-models` | yes (upsert by `upstream_model`) | Live-fetch + upsert MiniMax models from `/v1/models` |
| Seed Kiro models | `npm run seed-kiro-models` | yes | Upsert builtin Kiro (Claude / AWS) models |
| Seed CodeBuddy models | `npm run seed-codebuddy-models` | yes | Upsert builtin CodeBuddy models |
| Seed Z.AI models | `npm run seed-zai-models` | yes | Upsert builtin Z.AI models (12-row curated list, real per-token pricing) |
| Seed Notion models | `npm run seed-notion-models` | yes | Upsert builtin Notion models (20-row catalogue from `src/providers/notion/manifest.json`) |
| Seed all | `npm run seed-all` | yes | Chain all five `seed-*` scripts |
| Reset | `npm run reset` | **destructive** | Remove `router.db` + WAL/SHM sidecars. Wipes all data |

### Docker variants

Each entry above has a `<name>:docker` sibling that hard-codes `ROUTER_DB_PATH=./data/router.db` so the script targets the volume-mounted DB inside the Docker container:

```bash
npm run add-account:docker          -- --provider minimax --label my-acc --api-key mm_xxx
npm run seed-models:docker
npm run seed-kiro-models:docker
npm run seed-codebuddy-models:docker
npm run seed-zai-models:docker
npm run notion-add-account:docker
npm run seed-notion-models:docker
npm run seed-all:docker
npm run reset:docker
```

## Argument conventions

- All `--label` values are user-defined, used as the natural key. Re-running with the same label updates in place where possible.
- `--api-key` and `--refresh-token` values are **never echoed back** after creation. Store the value before running.
- For multi-line / special-character values, wrap in single quotes: `--api-key 'mm_abc...xyz'`.

## Output convention

All scripts print a one-line summary to stdout. Errors go to stderr with a non-zero exit code. No interactive prompts.

Regenerate this table when scripts are added/removed. Source: `package.json` `scripts` field + `scripts/*.ts`.