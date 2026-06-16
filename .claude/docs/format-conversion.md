# Format Conversion

> OpenAI ↔ Anthropic body and response transform rules. For terse reference see `docs/reference/`. Source: `src/providers/format/transform.ts` (309 LOC).

## Why this exists

The router accepts OpenAI and Anthropic client formats and proxies to MiniMax (which speaks OpenAI-shaped JSON) or Kiro (which speaks AWS event-stream). Format conversion lives in `src/providers/format/transform.ts`. The conversion is loss-y in places — agents need to know what's preserved and what's approximated.

## Two settings control conversion

| Setting | Default | Effect |
|---|---|---|
| `settings.minimax.upstreamFormat` | `auto` (detect from client) | `openai` forces OpenAI-shape upstream regardless of client. `anthropic` forces Anthropic-shape. |
| `ROUTER_UPSTREAM_FORMAT` env | (none) | Overrides the setting. Same values. |

When the client is OpenAI and upstream is Anthropic (`upstreamFormat: 'anthropic'`): outbound body converted via `bodyOpenAIToAnthropic`, response via `responseAnthropicToOpenAI`.

When client is Anthropic and upstream is OpenAI: `bodyAnthropicToOpenAI` + `responseOpenAIToAnthropic`.

## OpenAI → Anthropic body

`bodyOpenAIToAnthropic(body)`:
- `messages: [{role: 'system', content}, {role: 'user', content}, ...]`
  → `{ system: <extracted>, messages: [{role, content: <user/assistant only>}] }`
- System messages become the top-level `system` field. Multiple system messages are concatenated with `\n\n`.
- User/assistant messages pass through, but tool messages are special — see below.
- `tools: [{type: 'function', function: {name, description, parameters}}]`
  → `tools: [{name, description, input_schema: <parameters>}]`
- `tool_choice: 'auto' | 'any' | 'none' | {type: 'function', function: {name}}`
  → `tool_choice: {type: 'auto' | 'any' | 'tool', name?: <name>}`
  - `none` is approximated as `{type: 'auto'}` (Anthropic has no `none` — it just means "don't force tool use")
- `stream: true` → `stream: true` (plus `stream_options: {include_usage: true}` injected for OpenAI streaming — see below)
- `temperature`, `max_tokens`, `top_p`, `stop` — direct map
- `response_format: {type: 'json_object'}` → not directly supported by Anthropic; warning emitted, best-effort
- `n` (multiple completions) → not supported by Anthropic; warning emitted

### Tool messages — special case

OpenAI tool messages are `{role: 'tool', tool_call_id, content}`. Anthropic has `tool_result` blocks inside the `user` message. Conversion:
```ts
{ role: 'tool', tool_call_id: 'X', content: '...' }
→
{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'X', content: '...' }] }
```

The corresponding assistant message has `tool_use` blocks (not tool_calls) — see response conversion below.

## Anthropic → OpenAI body

`bodyAnthropicToOpenAI(body)`:
- `{ system, messages: [...] }` → `{ messages: [{role: 'system', content: system}, ...messages] }`
- `tools: [{name, description, input_schema}]` → `tools: [{type: 'function', function: {name, description, parameters: input_schema}}]`
- `tool_choice: {type, name?}` → `tool_choice: 'auto' | 'none' | {type: 'function', function: {name: name}}`
- `max_tokens` → `max_tokens` (direct)
- `stream: true` → `stream: true` (no `stream_options` injection — Anthropic is the upstream here)
- `metadata.user_id` → discarded (no OpenAI equivalent)

## Response conversion

`responseAnthropicToOpenAI(body)`:
- Anthropic `{id, type: 'message', role: 'assistant', content: [{type: 'text', text}, {type: 'tool_use', id, name, input}], stop_reason, usage: {input_tokens, output_tokens}}`
  → OpenAI `{id, object: 'chat.completion', choices: [{index: 0, message: {role: 'assistant', content: <text or null>, tool_calls: [...]}, finish_reason}], usage: {prompt_tokens, completion_tokens, total_tokens}}`
- `stop_reason` mapping:
  - `end_turn` → `stop`
  - `max_tokens` → `length`
  - `tool_use` → `tool_calls`
  - `stop_sequence` → `stop`
- `usage` mapping:
  - `input_tokens` → `prompt_tokens`
  - `output_tokens` → `completion_tokens`
  - (cache read/creation tokens are added by the router based on `request_logs.cache_*_tokens`, not from the upstream response)

`responseOpenAIToAnthropic(body)` is the inverse.

## Streaming chunks

The streaming conversion is more involved because each chunk is partial. See `src/streaming/pipeWithUsage.ts` for the SSE pipe. Key invariants:

- `chat.completion.chunk` with delta.content → `content_block_start` + `content_block_delta` (text)
- `chat.completion.chunk` with delta.tool_calls → `content_block_start` (tool_use) + `content_block_delta` (input_json_delta)
- Final `chat.completion.chunk` with finish_reason → `message_delta` (stop_reason) + `message_stop`
- The router injects `stream_options.include_usage=true` so OpenAI streaming responses include the usage chunk — this is the project's auto-inject behavior (`src/proxy/minimax.ts`). Without it, `usage` is null and cost tracking breaks.

## Cache control

Anthropic has `cache_control: {type: 'ephemeral'}` on content blocks. OpenAI has no equivalent. The router:
- Passes `cache_control` through to Anthropic (upstream)
- Strips `cache_control` from the body when converting Anthropic → OpenAI (it would be ignored anyway)
- The router's own cache injection (`src/cache-injection.ts`) adds `cache_control` to the system + last user message if `settings.caching.autoBreakpoints` is on

## Code map

```
src/providers/format/
├── transform.ts        309 LOC — all 4 conversion functions
├── negotiate.ts        getUpstreamFormat(db, requestedFormat) — picks openai vs anthropic
├── headers.test.ts
└── transform.test.ts   50+ tests covering edge cases
```

## Gotchas

- **The `none` tool_choice doesn't exist in Anthropic.** Conversion to `{type: 'auto'}` is a best-effort approximation. Clients that depend on `none` to suppress all tool use will still see Anthropic tool-using responses.
- **`response_format: {type: 'json_object'}` is not supported by Anthropic.** The router warns and passes the body through unchanged. Anthropic may or may not produce valid JSON.
- **`stop_sequences` is an array in Anthropic, scalar in OpenAI.** `bodyAnthropicToOpenAI` joins with `||` separator (which OpenAI splits back). Loss-y for clients that use `||` in their stops.
- **`metadata.user_id` is dropped** on Anthropic → OpenAI. No way to preserve it.
- **The router injects `stream_options.include_usage=true` for OpenAI streaming** — even if the client didn't set it. This is intentional. See `AGENTS.md` "Architecture (one-page)" and `src/proxy/format/`.
- **Tool messages always require a preceding assistant tool_calls message.** If the client sends a tool message with no matching `tool_use_id` upstream, the upstream may 400.
- **System messages at the END of the messages array** (some clients do this) are moved to the top by the OpenAI → Anthropic converter. The reverse is also true.

## Cross-refs

- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — pipeline overview
- [`../../docs/guides/debug-a-failed-request.md`](../../docs/guides/debug-a-failed-request.md) — format-mismatch debug
- `src/providers/format/transform.ts` — source of truth
- `src/providers/format/transform.test.ts` — edge-case coverage
