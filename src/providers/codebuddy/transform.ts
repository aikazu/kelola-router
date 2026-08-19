// src/providers/codebuddy/transform.ts
import type { AnthropicBody } from '../format/message-types.js';
import { bodyAnthropicToOpenAI } from '../format/transform.js';
import { CODEBUDDY_DEFAULT_SYSTEM } from './index.js';

/**
 * Prepare a client request body for the CodeBuddy upstream.
 *
 * CodeBuddy speaks OpenAI Chat Completions and is **stream-only** and
 * **requires a `system` role message**. This:
 *   1. converts an Anthropic body → OpenAI (reusing the shared converter),
 *   2. strips the `cb/` model prefix,
 *   3. guarantees a system message exists (injects a default if absent),
 *   4. forces `stream:true` + `stream_options.include_usage`.
 */
export function prepareCodeBuddyBody(
  body: Record<string, unknown>,
  clientFormat: 'openai' | 'anthropic'
): Record<string, unknown> {
  const out: Record<string, unknown> =
    clientFormat === 'anthropic'
      ? (bodyAnthropicToOpenAI(body as AnthropicBody) as unknown as Record<string, unknown>)
      : { ...body };

  if (typeof out.model === 'string' && out.model.startsWith('cb/')) {
    out.model = out.model.slice('cb/'.length);
  }

  const messages = Array.isArray(out.messages) ? [...(out.messages as unknown[])] : [];
  const hasSystem = messages.some(
    (m) => !!m && typeof m === 'object' && (m as { role?: string }).role === 'system'
  );
  if (!hasSystem) {
    messages.unshift({ role: 'system', content: CODEBUDDY_DEFAULT_SYSTEM });
  }
  out.messages = messages;

  out.stream = true;
  const so = (out.stream_options as Record<string, unknown> | undefined) ?? {};
  out.stream_options = { ...so, include_usage: true };

  return out;
}
