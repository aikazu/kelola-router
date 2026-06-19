# Z.AI Wire Format

Z.AI exposes two parallel APIs that mirror Claude Code and the OpenAI Chat
Completions surface respectively. The router selects the upstream endpoint
based on the client's body format:

| Client body format | Upstream endpoint                                        |
|--------------------|----------------------------------------------------------|
| `openai`           | `POST https://api.z.ai/api/coding/paas/v4/chat/completions` |
| `anthropic`        | `POST https://api.z.ai/api/anthropic/v1/messages`        |

Both speak HTTP Bearer auth with the user's Z.AI API key (issued at
<https://z.ai/manage-apikey/apikey-list>).

The Anthropic endpoint is the same one Claude Code itself uses per
<https://docs.z.ai/devpack/tool/claude#manual-configuration>:

```bash
ANTHROPIC_AUTH_TOKEN=your_zai_api_key
ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
```

The Coding endpoint (`/api/coding/paas/v4`) is the dedicated path for GLM
Coding Plan subscribers per
<https://docs.z.ai/api-reference/introduction.md>.

## Auth header

```
Authorization: Bearer <ZAI_API_KEY>
```

The provider module sets both `Authorization` and `Accept-Language: en-US,en`
headers (the latter is required on OpenAI-style requests per the same
introduction page).

## Model catalogue

All public GLM model ids are listed in
<https://docs.z.ai/api-reference/llm/chat-completion.md>. The seed list
(`src/db/seedBuiltinModels.ts`) mirrors the current enum. Highlights:

- `glm-5.2` — flagship; comparable to Claude Opus per the docs
- `glm-5.2[1m]` — same model with the `[1m]` suffix enabling 1M-token context
  (requires `CLAUDE_CODE_AUTO_COMPACT_WINDOW: 1000000` per the docs)
- `glm-5.1`, `glm-5-turbo`, `glm-5` — alternates in the 5.x line
- `glm-4.7`, `glm-4.7-flash`, `glm-4.7-flashx` — 4.x flagship + variants
- `glm-4.6`, `glm-4.6v`, `glm-4.5*`, `glm-4-32b-0414-128k` — older + vision

Pricing is **zero** across the board — Z.AI is a flat-rate subscription,
not per-token. The dashboard surfaces request counts only.

## Request shape (OpenAI endpoint)

Mirrors `chat.completion_create` — the router passes the client's OpenAI body
through after stripping the `zai/` prefix and forcing `stream:true` plus
`stream_options.include_usage`. No system-injection, no message folding.

```jsonc
{
  "model": "glm-5.2",
  "messages": [
    { "role": "system", "content": "You are a helpful coding assistant." },
    { "role": "user", "content": "Write a Python function to compute factorial." }
  ],
  "temperature": 1,
  "stream": true,
  "stream_options": { "include_usage": true }
}
```

Tool calls, function definitions, and `reasoning_content` are passed through
unchanged — Z.AI speaks the standard OpenAI Chat Completions surface.

## Request shape (Anthropic endpoint)

Mirrors `messages.create` — the router forwards the client's Anthropic body
verbatim (model rewrite + `stream:true` only). System, tools, thinking, and
multimodal blocks pass through unchanged.

```jsonc
{
  "model": "glm-5.2",
  "max_tokens": 1024,
  "system": "You are a helpful coding assistant.",
  "messages": [{ "role": "user", "content": "Write a Python function to compute factorial." }],
  "stream": true
}
```

## Response shape

Both endpoints stream standard OpenAI SSE (`data: { ... }\n\n`) when
`stream:true`. The router's existing `codebuddy/streamConvert` helpers handle
conversion back to Anthropic Messages SSE for `anthropic` clients via the
shared `OpenAIToAnthropicSSEAssembler`.

The terminal chunk carries `usage`:

```jsonc
{
  "id": "...",
  "object": "chat.completion.chunk",
  "model": "glm-5.2",
  "choices": [{ "index": 0, "delta": {}, "finish_reason": "stop" }],
  "usage": {
    "prompt_tokens": 17,
    "completion_tokens": 42,
    "total_tokens": 59,
    "prompt_tokens_details": { "cached_tokens": 0 }
  }
}
```

Non-stream responses are aggregated by `aggregateOpenAISSE` and returned as
either an OpenAI `chat.completion` JSON object or converted via
`responseOpenAIToAnthropic` for Anthropic-format clients.

## Error shape

Z.AI returns standard HTTP status codes; the body shape mirrors OpenAI's
`{"error":{"message":"...","type":"..."}}` envelope. `checkFallbackError` in
`src/accounts/errorRules.ts` already maps the canonical set:

- `401` → auth fail (cooldown 0, account disabled)
- `429` → backoff
- `5xx` → 5s cooldown

See `docs/reference/error-codes.md` for the full table.