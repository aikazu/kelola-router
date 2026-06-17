# Pioneer Authentication

Pioneer accounts authenticate with a single HTTP header on every upstream request:

```
X-API-Key: {account.api_key}
```

There is no `Authorization: Bearer` header, no `anthropic-version` header, and no token refresh flow. The long-lived key stored in the `accounts.api_key` column is sent directly.

Dashboard users add a Pioneer account via **Upstream → + Add → Pioneer** with:

- `label` (user-defined)
- `api_key` (Pioneer key, placeholder `pio_sk_xxxxxxxx`)

CLI equivalent:

```bash
tsx scripts/add-account.ts --provider pioneer --api-key pio_sk_xxx --label my-pio
```

Optional `--base-url` overrides the default `https://api.pioneer.ai` (e.g. a custom gateway).
