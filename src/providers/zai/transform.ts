// src/providers/zai/transform.ts
import type { AnthropicBody } from '../format/messageTypes.js';

/**
 * Prepare a client request body for the Z.AI upstream.
 *
 * Z.AI speaks standard OpenAI Chat Completions at `/api/coding/paas/v4` and
 * Anthropic Messages at `/api/anthropic`. We pick the endpoint based on the
 * client's format: Anthropic body → Anthropic endpoint, OpenAI body → OpenAI
 * endpoint. We always force upstream streaming so the proxy can convert back
 * to the client's preferred format (or tee usage) using the shared
 * `codebuddy/streamConvert` helpers.
 *
 * Mirrors `preparePioneerBody`:
 *   1. converts Anthropic → OpenAI when upstream format is OpenAI
 *      (reusing the shared converter),
 *   2. rewrites `model` to the real upstream id (resolving the `zai/` prefix),
 *   3. forces `stream:true` + `stream_options.include_usage`,
 *   4. leaves the message list as provided (no system injection — z.ai accepts
 *      bare user turns and treats tool_choice the OpenAI way).
 *
 * Anthropic-format upstream bodies are passed through unchanged except for
 * model rewrite + stream forcing (Anthropic Messages SSE uses its own
 * event format with `message_start`, `content_block_delta`, etc., handled
 * by the response assembler in the proxy layer).
 */
export function prepareZaiBody(
  body: Record<string, unknown>,
  clientFormat: 'openai' | 'anthropic',
  upstreamModel?: string
): Record<string, unknown> {
  if (clientFormat === 'anthropic') {
    // Send the Anthropic body to the Anthropic endpoint verbatim after
    // rewriting model + forcing stream. Tools / system / thinking all pass
    // through unchanged — z.ai's anthropic endpoint mirrors the Claude
    // Messages API surface (see docs.z.ai/devpack/tool/claude).
    const out: Record<string, unknown> = { ...(body as AnthropicBody) };
    if (upstreamModel) {
      out.model = upstreamModel;
    } else if (typeof out.model === 'string' && out.model.startsWith('zai/')) {
      out.model = out.model.slice('zai/'.length);
    }
    out.stream = true;
    return out;
  }

  // OpenAI client → OpenAI upstream.
  const out: Record<string, unknown> = { ...body };
  if (upstreamModel) {
    out.model = upstreamModel;
  } else if (typeof out.model === 'string' && out.model.startsWith('zai/')) {
    out.model = out.model.slice('zai/'.length);
  }
  out.stream = true;
  const so = (out.stream_options as Record<string, unknown> | undefined) ?? {};
  out.stream_options = { ...so, include_usage: true };
  return out;
}
