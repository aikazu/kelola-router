# Z.AI Authentication

Z.AI uses a single long-lived **API key** for both the OpenAI Chat
Completions endpoint and the Anthropic Messages endpoint. No OAuth, no
short-lived bearer rotation — the key goes directly into
`accounts.api_key` and the proxy sends it as `Authorization: Bearer <key>`
on every request.

## Getting a key

1. Visit <https://z.ai/model-api> and sign in (or register).
2. Open <https://z.ai/manage-apikey/apikey-list> and create a new API key.
3. Copy the value — it is shown only once at creation time.

## Storage

Stored under the existing `accounts` row with `provider='zai'`. No new
columns are required because the long-lived key fits in `accounts.api_key`.

```
label      = "zai-1"           # or any user-chosen name
api_key    = "zai_xxxxxxxxxx"
provider   = 'zai'
credit_type= 'payg'             # subscription-plan semantics
enabled    = 1
base_url   = null               # falls back to defaults in executeZai
```

The CLI runner (`scripts/add-account.ts --provider zai`) writes the same
shape.

## CLI

```bash
# Add an account + auto-seed builtin models
npm run add-account -- --provider zai --api-key zai_xxx --label zai-1

# Or with a private gateway
npm run add-account -- --provider zai --api-key zai_xxx \
  --label zai-private --base-url https://my-gateway.example/zai

# Re-seed the model catalogue (idempotent upsert)
npm run seed-zai-models
```

## Dashboard

The Accounts page (`client/src/pages/Accounts.tsx`) renders a `<ZaiCard />`
section. Click "+ Add", paste the key, save. The model catalogue is
auto-seeded on save (calls `seedZaiBuiltins`); the Models page exposes the
catalogue under the "Z.AI" section.

## Quota / billing model

Z.AI is a **flat-rate subscription** (the "GLM Coding Plan" per
<https://docs.z.ai/devpack/overview>). There is no per-token bill — pricing
columns in the `models` table are seeded at zero for all Z.AI rows and the
dashboard surfaces request counts only.

The Coding Plan uses 5-hour + weekly rolling windows. GLM-5.2 and
GLM-5-Turbo are billed at 1× off-peak and 2-3× peak (14:00–18:00 UTC+8) per
the docs. The router does not enforce this — billing is upstream.