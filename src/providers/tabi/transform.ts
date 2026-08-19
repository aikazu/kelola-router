import type { AnthropicBody } from '../format/message-types.js';
import { bodyAnthropicToOpenAI } from '../format/transform.js';

/**
 * Prepare a client request body for the TabiToken upstream.
 *
 * TabiToken is a New-API-fork gateway that speaks standard OpenAI Chat
 * Completions. Like Pioneer, the proxy always forces upstream streaming
 * so it can convert back to Anthropic or tee usage. This function:
 *   1. converts an Anthropic body → OpenAI (reusing the shared converter),
 *   2. rewrites `model` to the real upstream id,
 *   3. forces `stream:true` + `stream_options.include_usage`,
 *   4. leaves the message list exactly as provided.
 *
 * Tabi's DB rows are namespaced under `tabi/` so their `name` never
 * collides with same-named Kiro/CodeBuddy/Pioneer models. The handler
 * resolves that row to its `upstream_model` (the bare id TabiToken
 * expects) and passes it as `upstreamModel`. When absent (e.g. direct
 * unit calls) we fall back to stripping the `tabi/` client prefix.
 */
export function prepareTabiBody(
  body: Record<string, unknown>,
  clientFormat: 'openai' | 'anthropic',
  upstreamModel?: string
): Record<string, unknown> {
  const out: Record<string, unknown> =
    clientFormat === 'anthropic'
      ? (bodyAnthropicToOpenAI(body as AnthropicBody) as unknown as Record<string, unknown>)
      : { ...body };

  if (upstreamModel) {
    out.model = upstreamModel;
  } else if (typeof out.model === 'string' && out.model.startsWith('tabi/')) {
    out.model = out.model.slice('tabi/'.length);
  }

  out.stream = true;
  const so = (out.stream_options as Record<string, unknown> | undefined) ?? {};
  out.stream_options = { ...so, include_usage: true };

  return out;
}
