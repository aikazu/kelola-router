import type { ProxyFetchOpts } from '../../transport/proxy-fetch.js';
import type { TransportConfig } from '../../transport/types.js';
import { upstreamFetch } from '../upstream-fetch.js';
import { prepareCodeBuddyBody } from './transform.js';

// ─── Constants ───────────────────────────────────────────────────────────────

export const CODEBUDDY_BASE_URL = 'https://www.codebuddy.ai';
export const CODEBUDDY_CHAT_ENDPOINT = '/v2/chat/completions';
export const CODEBUDDY_DEFAULT_SYSTEM = 'You are a helpful assistant.';
export const CODEBUDDY_DEFAULT_TEMPERATURE = 0.7;

/** Only proven, tested models (bare names; clients route via `cb/` prefix). */
export const CODEBUDDY_MODELS = [
  'claude-opus-4.6',
  'gemini-3.1-pro',
  'gemini-3.5-flash',
  'kimi-k2.5',
] as const;

// ─── Execute ─────────────────────────────────────────────────────────────────

/**
 * Execute a request to CodeBuddy upstream.
 *
 * Converts the client body (OpenAI or Anthropic format) to OpenAI Chat
 * Completions format, strips the `cb/` model prefix, injects a default
 * system message if absent, and forces stream:true. Sends Bearer auth — no
 * anthropic-version header.
 */
export async function executeCodeBuddy(opts: {
  body: Record<string, unknown>;
  account: { api_key: string; base_url?: string | null; chat_endpoint?: string | null };
  transport: TransportConfig | null;
  proxyOpts?: ProxyFetchOpts;
  clientFormat: 'openai' | 'anthropic';
  signal?: AbortSignal;
}): Promise<Response> {
  const { body, account, transport, proxyOpts, clientFormat, signal } = opts;

  const prepared = prepareCodeBuddyBody(body, clientFormat);

  const baseUrl = account.base_url || CODEBUDDY_BASE_URL;
  const endpoint = account.chat_endpoint || CODEBUDDY_CHAT_ENDPOINT;
  const url = `${baseUrl}${endpoint}`;

  const extraHeaders: Record<string, string> = {
    Authorization: `Bearer ${account.api_key}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };

  return upstreamFetch(url, prepared, extraHeaders, transport, proxyOpts, signal);
}
