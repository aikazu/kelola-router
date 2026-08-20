// src/providers/qwencloud/transform.ts
import type { AnthropicBody } from '../format/message-types.js';

/**
 * Prepare a client request body for the QwenCloud (Aliyun token-plan) upstream.
 *
 * QwenCloud speaks a single Anthropic-Messages-compatible surface at
 * `/apps/anthropic/v1/messages` (see docs/qwencloud/wire-format.md), so unlike
 * `prepareZaiBody` there is only one outgoing format and no OpenAI↔Anthropic
 * conversion. The transform therefore stays minimal:
 *
 *   1. rewrites `model` to the real upstream id (resolving the `qctp/` prefix
 *      or honoring the DB-resolved `upstreamModel`),
 *   2. forces `stream:true` so the proxy can tee usage / convert back to the
 *      client's preferred format.
 *
 * Everything else (system, messages, tools, thinking, cache_control) passes
 * through verbatim — Aliyun's anthropic endpoint mirrors the Claude Messages
 * API surface.
 */
export function prepareQwenCloudBody(
  body: Record<string, unknown>,
  upstreamModel?: string
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(body as AnthropicBody) };
  if (upstreamModel) {
    out.model = upstreamModel;
  } else if (typeof out.model === 'string' && out.model.startsWith('qctp/')) {
    out.model = out.model.slice('qctp/'.length);
  }
  out.stream = true;
  return out;
}
