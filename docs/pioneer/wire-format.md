# Pioneer Wire Format

Base URL
: `https://api.pioneer.ai`

Chat completions endpoint
: `POST /v1/chat/completions`

Upstream format
: Standard OpenAI Chat Completions. The proxy always forces `stream: true` and `stream_options.include_usage` on the upstream request, regardless of the client format.

Auth header
: `X-API-Key: <account_api_key>`. No `Authorization: Bearer` header and no `anthropic-version` header.

Streaming response
: OpenAI SSE. Each chunk is a `chat.completion.chunk`. Final upstream chunk may carry `usage`. Stream terminates with `data: [DONE]`.

Non-streaming response
: `chat.completion` object. The proxy aggregates the forced upstream stream when the client requested `stream: false`.

Usage shape
: ```json
{
  "prompt_tokens": 0,
  "completion_tokens": 0,
  "total_tokens": 0,
  "prompt_tokens_details": null
}
```
Pioneer does not report cache tokens; `prompt_tokens_details` is always `null` in current traffic.

Model prefix
: Clients send `pio/<pioneer-model-id>`, verbatim — including ids that carry their own vendor prefix, e.g. `pio/claude-opus-4-8` or `pio/moonshotai/Kimi-K2.6`. `parseModelPrefix` splits only on the first slash, so everything after `pio/` is the full Pioneer id.

Storage / collision handling
: Several Pioneer ids (`claude-opus-4-8`, `gpt-5.5`, `gemini-3.1-pro`, …) are identical to Kiro / CodeBuddy ids, but both `models.name` and `models.upstream_model` are GLOBALLY UNIQUE. To avoid clashing on either column, Pioneer rows are namespaced under a single `pioneer/` in both columns (e.g. name and upstream_model `pioneer/moonshotai/Kimi-K2.6`). `resolveModel` maps a clean client prefix (`pio/<id>`) to the namespaced row by retrying the lookup as `<provider>/<id>` when the bare name is missing or owned by another provider. The proxy then strips the single leading `pioneer/` from `upstream_model` to recover the exact id Pioneer's API expects.

Seeded models
: Pioneer has no builtin model list — the full catalogue is fetched live from `GET https://api.pioneer.ai/v1/models` (auth `X-API-Key`) when a Pioneer account is added (dashboard or CLI), via `fetchAndSeedPioneerModels` in `src/providers/pioneer/models.ts`. Each row is stored namespaced as `pioneer/<id>`; clients call `pio/<id>`.
