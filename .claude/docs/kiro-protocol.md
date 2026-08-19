# Kiro Protocol

> Wire format + auth + persona details for the Kiro upstream (AWS CodeWhisperer / Amazon Q). The full reverse-engineering notes live in `docs/notes/kiro-cli-reverse-engineering.md` (capture-from-real-traffic). This file is the digest.

## Why this exists

Kiro is the most complex provider in the router. Two client personas (`ide` / `cli`), a binary event-stream wire format, OAuth refresh tokens with 5-min expiry buffer, and a `profileArn` requirement that triggers a management-API round-trip on first use. When something breaks, the agent needs the protocol details, not just a function pointer.

## Two personas

| Persona | Host | UA / SDK fingerprint | When to use |
|---|---|---|---|
| `ide` (default) | `codewhisperer.{region}.amazonaws.com` | aws-sdk-js + `KiroIDE` | Legacy, battle-tested. Use unless explicitly told otherwise. |
| `cli` (experimental) | `runtime.{region}.kiro.dev` | aws-sdk-rust + `AmazonQ-For-CLI` | Looks like the real kiro-cli 2.6.0. Lower ban-risk. |

Switch per-account via `accounts.provider_data.persona` field. Toggle in the dashboard (Upstream → Edit → Persona) or `PATCH /api/admin/accounts/:id {persona}`.

**Never change the default from `ide` without explicit instruction.** Changing the default would break every existing Kiro account.

## Auth: refresh token + cached bearer

`src/providers/kiro/auth.ts:ensureAccessToken(db, account)`:
1. Read `accounts.access_token` + `accounts.token_expires_at`
2. If valid + > 5 min buffer: return existing
3. Else: call `refreshKiroToken(account.provider_data)` → `{ access_token, expires_in }`
4. Persist to DB (UPDATE `accounts SET access_token=?, token_expires_at=?`)
5. Return new bearer

`refreshKiroToken` picks the right URL:
- If `provider_data.clientId` + `clientSecret` present: AWS SSO OIDC endpoint `oidc.{region}.amazonaws.com/token`
- Else: Kiro desktop social `prod.us-east-1.auth.desktop.kiro.dev/refreshToken`

## Request: `buildKiroPayload` (OpenAI → CodeWhisperer)

`src/providers/kiro/transform.ts`. Branches on `persona`:

### Body shape: IDE persona

```jsonc
{
  "conversationState": {
    "currentMessage": { "userInputMessage": { ... } },
    "history": [ ... 0..N prior turns ... ]
  },
  "profileArn": "<resolved>"
}
```

System / tool messages are folded into the user turn (CodeWhisperer has no `system` role). Tools are transformed to `toolSpecification`. Images stay as content blocks.

### Body shape: CLI persona

Same as IDE structurally, but:
- `chatTriggerType: 'MANUAL'`
- Per-message `envState`
- `agentContinuationId` + `agentTaskType: 'vibe'`
- NO `inferenceConfig` (CLI doesn't use it)
- Model id is converted to dotted form: `claude-sonnet-4-6` → `claude-sonnet-4.6`

### Suffix handling

Synthetic model variants keep the suffix in `upstream_model`:
- `claude-sonnet-4-6-thinking` → upstream `claude-sonnet-4-6` + injected `<thinking_mode>enabled</thinking_mode>`
- `claude-sonnet-4-6-agentic` → injected chunked-write system prompt
- `claude-sonnet-4-6-thinking-agentic` → both

The executor strips the suffix before sending.

## Response: AWS event-stream binary

`src/providers/kiro/eventstream.ts:decodeFrames(rawStream)`. AWS event-stream is a binary framing format with:
- 12-byte prelude (total length + headers length)
- Headers (name-value pairs)
- Payload (JSON or binary)
- 4-byte CRC (optional, sometimes skipped)

Each frame is decoded into:
```ts
{ headers: { eventType, contentType, ... }, payload: Uint8Array }
```

### Re-emission

For each event, the assembler (`src/providers/kiro/assembler.ts`) re-emits as OpenAI SSE chunks:

| Upstream event | OpenAI chunk |
|---|---|
| `assistantResponseEvent` | `chat.completion.chunk` with delta.content |
| `toolUseEvent` | `chat.completion.chunk` with delta.tool_calls |
| `messageStopEvent` | `chat.completion.chunk` with finish_reason |
| `metadataEvent` (usage) | (no chunk, just captured for cost) |

For Anthropic clients, `anthropic-sse.ts` re-emits as native Messages SSE:
- `message_start` → `content_block_start` (text/thinking/tool_use) → `content_block_delta` (×N) → `content_block_stop` → `message_delta` (stop_reason) → `message_stop`

## `profileArn` discovery (CLI persona only)

The CLI runtime host REJECTS requests without `profileArn`. On first CLI-persona use:

1. `ensureProfileArn(db, account)` checks `accounts.provider_data.profileArn`
2. If missing: call `ListAvailableProfiles` on `management.{region}.kiro.dev` (wire format captured from kiro-cli)
3. Take the first profile
4. Persist to `provider_data.profileArn`
5. Return it

The management host also uses `aws-sdk-rust` + `AmazonQ-For-CLI` fingerprint. The `discoverProfileArn` function in `src/providers/kiro/profile.ts` does the round-trip.

## Error handling

- **401 on `ensureAccessToken`**: token refresh failed. The account is marked `status='error'`. The user must re-add the account.
- **Upstream 4xx/5xx**: same `checkFallbackError` pipeline as MiniMax. `base_resp` doesn't apply (Kiro uses AWS-shaped errors, not MiniMax-shaped).
- **Persona mismatch**: `codewhisperer` host for `cli` persona → 403. Reverse → 403 too. Ensure the persona matches the host.

## Code map

```
src/providers/kiro/
├── constants.ts     endpoints, persona type, UA builders, toCliModelId()
├── transform.ts     buildKiroPayload(): branches IDE vs CLI
├── index.ts         executeKiro(): picks endpoint + headers per persona
├── profile.ts       discoverProfileArn() + ensureProfileArn()
├── auth.ts          ensureAccessToken(): token refresh + DB cache
├── token-refresh.ts  KiroProviderData type (persona, profileArn, clientId, ...)
├── eventstream.ts   binary frame decoder
├── assembler.ts     → OpenAI SSE chunks
├── anthropic-sse.ts  → native Anthropic Messages SSE
├── device-code.ts    AWS Builder ID / IDC device code flow
├── account-import.ts buildKiroAccountFields (token / idc / social)
├── device-code.test.ts
├── constants.test.ts
├── profile.test.ts
└── transform.test.ts
```

## Gotchas

- **Default persona is `ide`.** If the user switches to `cli`, they accept the risk of a less-tested wire format.
- **The `profileArn` is per-account.** Each account has its own discovery round-trip. Don't share.
- **AWS event-stream frames are 1 KB to 4 KB.** Don't read the whole response into memory; pipe it.
- **The `cli` persona's `chatTriggerType: 'MANUAL'` is required** by the runtime host. Without it, the request is rejected.
- **The dot-vs-dash model id conversion is lossy** for display. The Kiro runtime host requires dotted form; the IDE host accepts either. The conversion happens in `constants.ts:toCliModelId()`.
- **Kiro responses are 2-3× slower** than MiniMax because of the binary framing + re-emission. TTFT is higher.

## Cross-refs

- [`docs/notes/kiro-cli-reverse-engineering.md`](../../docs/notes/kiro-cli-reverse-engineering.md): full capture-from-traffic notes (single source of truth for wire format)
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md): provider branching in `handleProxy`
- [`../../docs/guides/add-a-provider.md`](../../docs/guides/add-a-provider.md): when extending with new personas
- [`../skills/add-provider/SKILL.md`](../skills/add-provider/SKILL.md): provider integration skill
- `src/providers/kiro/constants.ts`: endpoint + UA constants
