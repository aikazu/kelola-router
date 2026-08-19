# TabiToken wire format

TabiToken (`https://tabitoken.com`) is a **New-API-fork reseller gateway** — an
OpenAI-compatible aggregator (same family as OpenRouter / New API) that resells
models from multiple upstream providers under its own id space. It exposes a
standard OpenAI Chat Completions API surface; there is no Anthropic-format
endpoint, so the router always bridges via OpenAI.

> **Status note (2026-08-19):** the domain was temporarily suspended by
> Cloudflare Registrar (ToS violation page at the apex). The `/api/status` and
> `/api/setup` endpoints were still reachable via the Wayback Machine the same
> day, indicating the API backend itself was intact behind the parked apex.
> If the suspension persists, point `--base-url` / dashboard Base URL at a
> mirror.

## Endpoint

```
POST https://tabitoken.com/v1/chat/completions
Authorization: Bearer <api_key>
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

## Auth

Bearer API key (`sk-…`). The key is stored in `accounts.api_key`. No refresh
tokens, no OAuth, no `anthropic-version` header — same auth model as Z.AI but
with a single OpenAI endpoint.

## Models

TabiToken does not publish a model list endpoint contract publicly; the builtin
catalogue (`src/providers/tabi/models.ts`) seeds the usual reseller set
(Claude Opus/Sonnet/Haiku, GPT-5/4o, DeepSeek, Gemini). Model rows are
namespaced `tabi/<id>` in both `name` and `upstream_model` so they never
collide on the globally-unique index with same-named Kiro / CodeBuddy /
Pioneer rows. Clients call the clean `tabi/<id>` form; the proxy strips the
prefix before forwarding (mirror of the `pioneer/` namespacing pattern).

## Dashboard integration

- `client/src/pages/Accounts.tsx`: **TabiToken** card, parallel to Pioneer/Z.AI.
- `client/src/pages/Models.tsx`: **TabiToken** model section.
- Add account → dashboard "TabiToken" card → paste key → builtin models seeded
  automatically (`seedModelsForProvider` → `seedTabiBuiltins`).
- CLI: `npm run add-account -- --provider tabi --api-key sk_…` and
  `npm run seed-tabi-models`.

## Verification

- Unit: `npx vitest run src/providers/tabi/`
- Live probe (when domain is back):
  ```bash
  curl -s https://tabitoken.com/v1/models \
    -H "Authorization: Bearer <sk-…>"
  curl -s https://tabitoken.com/v1/chat/completions \
    -H "Authorization: Bearer <sk-…>" -H "Content-Type: application/json" \
    -d '{"model":"claude-opus-5","messages":[{"role":"user","content":"hi"}],"stream":true}'
  ```
