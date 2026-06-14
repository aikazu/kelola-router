import type { ProxyFetchOpts } from '../../transport/proxyFetch.js';
import type { TransportConfig } from '../../transport/types.js';
import { upstreamFetch } from '../upstreamFetch.js';
import { ensureCodeBuddyDefaults } from './transform.js';

// ─── Constants ───────────────────────────────────────────────────────────────

export const CODEBUDDY_BASE_URL = 'https://www.codebuddy.ai';
export const CODEBUDDY_CHAT_ENDPOINT = '/v2/chat/completions';
export const CODEBUDDY_DEFAULT_SYSTEM = 'You are a helpful assistant.';
export const CODEBUDDY_DEFAULT_TEMPERATURE = 0.7;

/** Only proven, tested models. */
export const CODEBUDDY_MODELS = [
  'codebuddy/claude-opus-4.6',
  'codebuddy/gemini-3.1-pro',
  'codebuddy/gemini-2.5-flash',
  'codebuddy/kimi-k2.5',
] as const;

// ─── Execute ─────────────────────────────────────────────────────────────────

/**
 * Execute a request to CodeBuddy upstream.
 *
 * The body is already in Anthropic Messages format from the client.
 * We only inject system/temperature defaults if missing, then passthrough.
 */
export async function executeCodeBuddy(opts: {
  body: Record<string, unknown>;
  account: { api_key: string; base_url?: string | null; chat_endpoint?: string | null };
  transport: TransportConfig | null;
  proxyOpts?: ProxyFetchOpts;
  skipModelStrip?: boolean;
}): Promise<Response> {
  const { body, account, transport, proxyOpts } = opts;

  // Ensure system + temperature defaults
  const prepared = ensureCodeBuddyDefaults(body);

  // Strip 'codebuddy/' prefix from model name — upstream expects raw model name
  // Unless skip_model_strip is set (e.g. enowxai bridge handles it)
  if (typeof prepared.model === 'string' && prepared.model.startsWith('codebuddy/')) {
    if (!opts.skipModelStrip) {
      prepared.model = prepared.model.slice('codebuddy/'.length);
    }
  }

  const baseUrl = account.base_url || CODEBUDDY_BASE_URL;
  // Allow per-account endpoint override via provider_data (e.g. for enowxai bridge)
  const endpoint = account.chat_endpoint || CODEBUDDY_CHAT_ENDPOINT;
  const url = `${baseUrl}${endpoint}`;

  const extraHeaders: Record<string, string> = {
    Authorization: `Bearer ${account.api_key}`,
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };

  return upstreamFetch(url, prepared, extraHeaders, transport, proxyOpts);
}
