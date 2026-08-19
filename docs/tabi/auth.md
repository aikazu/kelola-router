# TabiToken auth

TabiToken is a New-API-fork gateway that authenticates with a single **Bearer
API key** (`sk-…`) on every `/v1/*` request.

## Key lifecycle

1. Sign up at `tabitoken.com` (free credit promo, check-in bonus) and copy the
   API key from the console.
2. Store it on the account row: dashboard **Upstream → TabiToken → + Add**,
   or CLI:
   ```bash
   npm run add-account -- --provider tabi --label tabi1 --api-key sk_…
   ```
3. The router sends `Authorization: Bearer <key>` on every upstream call
   (`src/providers/tabi/index.ts`).

## No refresh cycle

Unlike Kiro (OAuth refresh token) there is no token refresh: the key is
long-lived until revoked from the TabiToken console. `accounts.access_token` /
`token_expires_at` are not used for this provider.

## Security notes

- Keys live only in `accounts.api_key` (SQLite, WAL). If `ROUTER_DB_KEY` is
  set, the DB is SQLCipher-encrypted at rest.
- Client keys (`client_keys`) never see the upstream TabiToken key.
- Treat the key as a credential: don't commit it, don't paste it into logs.
  If leaked, revoke in the TabiToken console and replace via
  `PATCH /api/admin/accounts/:id` from the dashboard edit modal.
