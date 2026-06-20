// src/providers/zai/index.ts
import type { ProxyFetchOpts } from '../../transport/proxyFetch.js';
import type { TransportConfig } from '../../transport/types.js';
import { upstreamFetch } from '../upstreamFetch.js';
import { prepareZaiBody } from './transform.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Z.AI exposes two parallel APIs that mirror Claude Code and the OpenAI
 * Chat Completions surface respectively:
 *   - Anthropic Messages at `/api/anthropic`
 *   - OpenAI Chat Completions at `/api/coding/paas/v4`
 *
 * The Coding endpoint is required for GLM Coding Plan subscribers per
 * https://docs.z.ai/api-reference/introduction.md; the anthropic endpoint
 * is what Claude Code itself uses (https://docs.z.ai/devpack/tool/claude).
 */
export const ZAI_ANTHROPIC_BASE_URL = 'https://api.z.ai/api/anthropic';
export const ZAI_OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4';

export const ZAI_ANTHROPIC_MESSAGES_ENDPOINT = '/v1/messages';
export const ZAI_OPENAI_CHAT_ENDPOINT = '/chat/completions';

/** Bare model ids exposed to z.ai. Pricing is zero — z.ai is a subscription plan. */
export const ZAI_MODELS = [
  'glm-5.2',
  'glm-5.2[1m]',
  'glm-5.1',
  'glm-5-turbo',
  'glm-5',
  'glm-4.7',
  'glm-4.7-flash',
  'glm-4.7-flashx',
  'glm-4.6',
  'glm-4.6v',
  'glm-4.5',
  'glm-4.5-air',
  'glm-4.5-x',
  'glm-4.5-airx',
  'glm-4.5-flash',
  'glm-4-32b-0414-128k',
] as const;

// ─── Execute ─────────────────────────────────────────────────────────────────

/**
 * Execute a request to Z.AI upstream.
 *
 * Routes to the Anthropic Messages endpoint when the client sent an Anthropic
 * body, otherwise to the OpenAI Chat Completions endpoint. Both speak HTTP
 * Bearer auth with the user's z.ai API key.
 */
export async function executeZai(opts: {
  body: Record<string, unknown>;
  account: { api_key: string; base_url?: string | null };
  transport: TransportConfig | null;
  proxyOpts?: ProxyFetchOpts;
  clientFormat: 'openai' | 'anthropic';
  /** Resolved upstream model id (DB stores bare names — no `zai/` prefix). */
  upstreamModel?: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const { body, account, transport, proxyOpts, clientFormat, upstreamModel, signal } = opts;

  const prepared = prepareZaiBody(body, clientFormat, upstreamModel);

  const baseUrl =
    account.base_url ||
    (clientFormat === 'anthropic' ? ZAI_ANTHROPIC_BASE_URL : ZAI_OPENAI_BASE_URL);
  const endpoint =
    clientFormat === 'anthropic' ? ZAI_ANTHROPIC_MESSAGES_ENDPOINT : ZAI_OPENAI_CHAT_ENDPOINT;
  const url = `${baseUrl}${endpoint}`;

  const extraHeaders: Record<string, string> = {
    Authorization: `Bearer ${account.api_key}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    // Z.AI requires Accept-Language on OpenAI requests (see introduction.md).
    'Accept-Language': 'en-US,en',
  };

  return upstreamFetch(url, prepared, extraHeaders, transport, proxyOpts, signal);
}
