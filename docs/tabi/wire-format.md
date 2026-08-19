# TabiToken wire format

TabiToken (system name **TaBiAI**, `https://tabitoken.cc`) is a **New-API-fork
reseller gateway** — an OpenAI-compatible aggregator (same family as OpenRouter
/ New API) that resells models from multiple upstream providers under its own
id space. It exposes a standard OpenAI Chat Completions surface **and** an
Anthropic Messages surface on the same `/v1` base; the router bridges to the
OpenAI endpoint for both client formats.

> **Verified live 2026-08-19** after the earlier Cloudflare Registrar
> suspension lifted. Key facts from probing the live gateway:
>
> - **The API server is `tabitoken.cc`, not `tabitoken.com`.** `/api/status`
>   reports `server_address: "https://tabitoken.cc"` (New-API fork
>   `v1.0.0-rc.23`). The `.com` apex is the Cloudflare-fronted marketing site
>   and **WAF-blocks non-browser user agents** (curl/undici get a 403
>   "Attention Required" page) — the router default base URL is therefore
>   `https://tabitoken.cc`.
> - `/v1/models` (Bearer auth) returns the full model list: exactly **4
>   models**, all Claude Opus — `claude-opus-5`, `claude-opus-5-thinking`,
>   `claude-opus-4-8`, `claude-opus-4-8-thinking` — each with
>   `supported_endpoint_types: ["anthropic","openai"]`.
> - `/api/pricing` (no auth) returns per-model pricing: `model_price` USD per
>   1M input tokens — $0.8 (opus-5) and $0.5 (opus-4.8), `completion_ratio: 0`
>   (see Pricing notes below). `quota_per_unit: 500000`, USD display.
> - A chat request with a valid but exhausted key returns HTTP 403
>   `{"error":{...,"code":"insufficient_user_quota"}}` with a Chinese message
>   (预扣费额度失败 = pre-deduction failed). The gateway pre-deducts the full
>   model price per request, so a successful no-credit completion could not be
>   exercised; every other stage (auth, routing, balance check) is confirmed.

## Endpoint

```
POST https://tabitoken.cc/v1/chat/completions
Authorization: Bearer ***
Content-Type: application/json
Accept: text/event-stream
```

The router hits this single OpenAI endpoint for **all** client formats:

- OpenAI client body → forwarded as-is (model prefix stripped)
- Anthropic client body → `bodyAnthropicToOpenAI` (shared converter) →
  upstream → OpenAI SSE → `openaiSSEToAnthropicSSE` back to the client

The proxy always forces `stream: true` + `stream_options.include_usage: true`
so usage can be teed even for non-streaming clients (see
`src/providers/tabi/transform.ts`).

> The gateway also speaks **Anthropic natively at `POST /v1/messages`** (same
> `/v1` base, same Bearer key — confirmed: a no-auth POST returns 401
> `new_api_error`, and the `/anthropic/v1/messages` path is just the SPA
> catch-all). We deliberately bridge everything through OpenAI today; a future
> optimization could hit `/v1/messages` directly for Anthropic-format clients
> (Z.AI-style dual endpoints).

## Auth

Bearer API key (`sk-…`). The key is stored in `accounts.api_key`. No refresh
tokens, no OAuth, no `anthropic-version` header on the OpenAI endpoint. A
missing/invalid key yields HTTP 401 `{"error":{"message":"Invalid token …","type":"new_api_error"}}`.

## Errors (New-API envelope)

All failures come back as JSON with a `new_api_error` envelope; messages are
often in Chinese. `src/providers/parse-error.ts` extracts the semantic `code`
field (`parsed.error.code`) and `src/accounts/error-rules.ts` maps it:

| code | HTTP | mapping |
|---|---|---|
| `insufficient_user_quota` | 403 | `source: 'balance'` → account permanently disabled (re-enable after top-up) |
| `invalid_api_key` / `authentication_error` | 401 | no cooldown, account marked error |
| `context_length_exceeded` | 400 | `source: 'token-limit'`, caller error, no backoff |
| *(no code — e.g. `Invalid token`)* | 401 | existing status rule (no cooldown) |

`handleUpstreamError` (and the inline paths in `minimax.ts` / `combo.ts`) pass
the parsed code through; other providers are unaffected (no code → previous
behaviour).

## Models

The builtin catalogue (`src/providers/tabi/models.ts`) mirrors the live
catalogue exactly — 4 rows:

| name (client) | pricing_input (USD/1M) |
|---|---|
| `tabi/claude-opus-5` | 0.80 |
| `tabi/claude-opus-5-thinking` | 0.80 |
| `tabi/claude-opus-4-8` | 0.50 |
| `tabi/claude-opus-4-8-thinking` | 0.50 |

Model rows are namespaced `tabi/<id>` in both `name` and `upstream_model` so
they never collide on the globally-unique index with same-named Kiro /
CodeBuddy / Pioneer rows. Clients call the clean `tabi/<id>` form; the proxy
strips the prefix before forwarding.

## Pricing notes

- The dashboard prices are **Anthropic official list prices**, not the
  reseller's billing: Claude Opus 5 / Opus 4.8 (and the -thinking variants)
  are $5 input / $25 output per 1M tokens, cache hits $0.50, 5-minute cache
  write $6.25 (verified on docs.anthropic.com, 2026-08-19; 1h cache write is
  $10). Full 1M context is billed at standard rates.
- TabiToken's own billing is far cheaper and is what your prepaid credit
  actually pays: `/api/pricing` reports `model_price` $0.8 (opus-5) / $0.5
  (opus-4.8) per 1M **input** tokens with `completion_ratio: 0` (output billed
  free on a New-API fork). The gateway **pre-deducts** the full model price
  per request, so even a one-token call needs the whole $0.8/$0.5 in credit.
- The router's cost tracking deliberately reports official list prices for
  realistic estimates; if you prefer to track your real TabiToken spend,
  override the four `/api/pricing` rows from the Models page.

## Dashboard integration

- `client/src/pages/Accounts.tsx`: **TabiToken** card, parallel to Pioneer/Z.AI.
- `client/src/pages/Models.tsx`: **TabiToken** model section.
- Add account → dashboard "TabiToken" card → paste key → builtin models seeded
  automatically (`seedModelsForProvider` → `seedTabiBuiltins`).
- CLI: `npm run add-account -- --provider tabi --api-key sk_…` and
  `npm run seed-tabi-models`.

## Verification

- Unit: `npx vitest run src/providers/tabi/`
- Live probe (2026-08-19, keys redacted):
  ```bash
  # model list (valid key required)
  curl -s https://tabitoken.cc/v1/models -H "Authorization: Bearer sk-…"
  # public pricing + status (no auth)
  curl -s https://tabitoken.cc/api/pricing
  curl -s https://tabitoken.cc/api/status
  # chat (expect 200; insufficient credit → 403 insufficient_user_quota)
  curl -s https://tabitoken.cc/v1/chat/completions \
    -H "Authorization: Bearer sk-…" -H "Content-Type: application/json" \
    -d '{"model":"claude-opus-5","messages":[{"role":"user","content":"hi"}],"stream":true}'
  ```
- The `.com` host is Cloudflare-WAF'd for non-browser UAs — always probe
  `.cc` (or pass a browser User-Agent when testing `.com`).