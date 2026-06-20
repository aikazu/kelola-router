import type { ProxyFetchOpts } from '../../transport/proxyFetch.js';
import type { TransportConfig } from '../../transport/types.js';
import { upstreamFetch } from '../upstreamFetch.js';
import { preparePioneerBody } from './transform.js';

// ─── Constants ───────────────────────────────────────────────────────────────

export const PIONEER_BASE_URL = 'https://api.pioneer.ai';
export const PIONEER_CHAT_ENDPOINT = '/v1/chat/completions';

// ─── Execute ─────────────────────────────────────────────────────────────────

/**
 * Execute a request to Pioneer upstream.
 *
 * Pioneer speaks standard OpenAI Chat Completions. We convert the client body
 * (OpenAI or Anthropic format) to OpenAI Chat Completions format, strip the
 * `pio/` model prefix, and force `stream:true` so we always get upstream SSE.
 * Sends `X-API-Key` auth — no Bearer, no anthropic-version header.
 */
export async function executePioneer(opts: {
  body: Record<string, unknown>;
  account: { api_key: string; base_url?: string | null; chat_endpoint?: string | null };
  transport: TransportConfig | null;
  proxyOpts?: ProxyFetchOpts;
  clientFormat: 'openai' | 'anthropic';
  /** Resolved upstream model id (Pioneer DB names are `pioneer/`-namespaced). */
  upstreamModel?: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const { body, account, transport, proxyOpts, clientFormat, upstreamModel, signal } = opts;

  const prepared = preparePioneerBody(body, clientFormat, upstreamModel);

  const baseUrl = account.base_url || PIONEER_BASE_URL;
  const endpoint = account.chat_endpoint || PIONEER_CHAT_ENDPOINT;
  const url = `${baseUrl}${endpoint}`;

  const extraHeaders: Record<string, string> = {
    'X-API-Key': account.api_key,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };

  return upstreamFetch(url, prepared, extraHeaders, transport, proxyOpts, signal);
}
