import type { AnthropicBody } from '../format/messageTypes.js';
import { bodyAnthropicToOpenAI } from '../format/transform.js';

/**
 * Prepare a client request body for the Pioneer upstream.
 *
 * Pioneer speaks standard OpenAI Chat Completions and supports both streaming
 * and non-stream responses natively, but the proxy always forces upstream
 * streaming so it can convert back to Anthropic or tee usage. This function:
 *   1. converts an Anthropic body → OpenAI (reusing the shared converter),
 *   2. rewrites `model` to the real upstream id,
 *   3. forces `stream:true` + `stream_options.include_usage`,
 *   4. leaves the message list exactly as provided (no default system injection).
 *
 * Pioneer's DB rows are namespaced under `pioneer/` so their `name` never
 * collides with same-named Kiro/CodeBuddy models (e.g. `claude-opus-4-8`).
 * The handler resolves that row to its `upstream_model` (the bare id Pioneer
 * expects) and passes it as `upstreamModel`. When absent (e.g. direct unit
 * calls) we fall back to stripping the `pio/` client prefix.
 */
export function preparePioneerBody(
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
  } else if (typeof out.model === 'string' && out.model.startsWith('pio/')) {
    out.model = out.model.slice('pio/'.length);
  }

  out.stream = true;
  const so = (out.stream_options as Record<string, unknown> | undefined) ?? {};
  out.stream_options = { ...so, include_usage: true };

  return out;
}
