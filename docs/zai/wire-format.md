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

The router ships with a curated seed list at
`src/db/seedBuiltinModels.ts → seedZaiBuiltins`. All entries carry real
per-token pricing (USD / 1M tokens) sourced from
<https://docs.z.ai/guides/overview/pricing>. Pricing-free Flash variants
have zero rows.

### Text models

| Model id            | Display            | Context | Input $/M | Output $/M | Cache read $/M |
|---------------------|--------------------|---------|-----------|------------|----------------|
| `glm-4.7`           | GLM-4.7            | 200K    | 0.6       | 2.2        | 0.11           |
| `glm-4.7-flash`     | GLM-4.7 Flash      | 200K    | free      | free       | free           |
| `glm-4.7-flashx`    | GLM-4.7 FlashX     | 200K    | 0.07      | 0.4        | 0.01           |
| `glm-5`             | GLM-5              | 200K    | 1.0       | 3.2        | 0.2            |
| `glm-5-turbo`       | GLM-5 Turbo        | 200K    | 1.2       | 4.0        | 0.24           |
| `glm-5.1`           | GLM-5.1            | 200K    | 1.4       | 4.4        | 0.26           |
| `glm-5.2`           | GLM-5.2            | 1M      | 1.4       | 4.4        | 0.26           |
| `glm-5.2[1m]`       | GLM-5.2 (1M)       | 1M      | 1.4       | 4.4        | 0.26           |

`glm-5.2` ships with a true 1M-token context (per the dedicated
[glm-5.2 model guide](https://docs.z.ai/guides/llm/glm-5.2)). The
`[1m]` suffix is preserved verbatim and selects the same upstream model;
pair it with `CLAUDE_CODE_AUTO_COMPACT_WINDOW: 1000000` in
`~/.claude/settings.json` per the docs.

### Vision models

| Model id              | Display         | Context | Input $/M | Output $/M | Cache read $/M |
|-----------------------|-----------------|---------|-----------|------------|----------------|
| `glm-4.6v`            | GLM-4.6V        | 128K    | 0.3       | 0.9        | 0.05           |
| `glm-4.6v-flash`      | GLM-4.6V Flash  | 128K    | free      | free       | free           |
| `glm-4.6v-flashx`     | GLM-4.6V FlashX | 128K    | 0.04      | 0.4        | 0.004          |
| `glm-5v-turbo`        | GLM-5V Turbo    | 200K    | 1.2       | 4.0        | 0.24           |

`glm-5v-turbo` is Z.AI's first multimodal coding foundation model. Image,
video, text, and file input → text output. See the
[glm-5v-turbo guide](https://docs.z.ai/guides/vlm/glm-5v-turbo) and
[glm-4.6v guide](https://docs.z.ai/guides/vlm/glm-4.6v) for capability
matrices.

### Out-of-seed models

Anything in the upstream enum
(<https://docs.z.ai/api-reference/llm/chat-completion.md>) but not in the
curated list can be added manually via the dashboard's Models page → "+ Add
model". The upstream `model` field accepts the bare id exactly as the docs
spell it (e.g. `glm-4.5-x`, `glm-4.5-air`, `glm-4-32b-0414-128k`).

## Request shape (OpenAI endpoint)

Mirrors `chat.completion_create`. The router passes the client's OpenAI body
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
unchanged. Z.AI speaks the standard OpenAI Chat Completions surface.

## Request shape (Anthropic endpoint)

Mirrors `messages.create`. The router forwards the client's Anthropic body
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