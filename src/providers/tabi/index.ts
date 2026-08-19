import type { ProxyFetchOpts } from '../../transport/proxyFetch.js';
import type { TransportConfig } from '../../transport/types.js';
import { upstreamFetch } from '../upstreamFetch.js';
import { prepareTabiBody } from './transform.js';

// ─── Constants ───────────────────────────────────────────────────────────────

export const TABI_BASE_URL = 'https://tabitoken.com';
export const TABI_CHAT_ENDPOINT = '/v1/chat/completions';

// ─── Execute ─────────────────────────────────────────────────────────────────

/**
 * Execute a request to TabiToken upstream.
 *
 * TabiToken speaks standard OpenAI Chat Completions (New API fork). We
 * convert the client body (OpenAI or Anthropic format) to OpenAI Chat
 * Completions format, strip the `tabi/` model prefix, and force
 * `stream:true` so we always get upstream SSE. Sends Bearer token auth.
 */
export async function executeTabi(opts: {
  body: Record<string, unknown>;
  account: { api_key: string; base_url?: string | null; chat_endpoint?: string | null };
  transport: TransportConfig | null;
  proxyOpts?: ProxyFetchOpts;
  clientFormat: 'openai' | 'anthropic';
  /** Resolved upstream model id (Tabi DB names are `tabi/`-namespaced). */
  upstreamModel?: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const { body, account, transport, proxyOpts, clientFormat, upstreamModel, signal } = opts;

  const prepared = prepareTabiBody(body, clientFormat, upstreamModel);

  const baseUrl = account.base_url || TABI_BASE_URL;
  const endpoint = account.chat_endpoint || TABI_CHAT_ENDPOINT;
  const url = `${baseUrl}${endpoint}`;

  const extraHeaders: Record<string, string> = {
    Authorization: `Bearer ${account.api_key}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };

  return upstreamFetch(url, prepared, extraHeaders, transport, proxyOpts, signal);
}
