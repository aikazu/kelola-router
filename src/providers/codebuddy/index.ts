import type { TransportConfig } from '../../transport/types.js';
import type { ProxyFetchOpts } from '../../transport/proxyFetch.js';
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

export interface CodeBuddyAccount {
  api_key: string;
  base_url: string | null;
}

/**
 * Execute a request to CodeBuddy upstream.
 *
 * The body is already in Anthropic Messages format from the client.
 * We only inject system/temperature defaults if missing, then passthrough.
 */
export async function executeCodeBuddy(opts: {
  body: Record<string, unknown>;
  account: CodeBuddyAccount;
  transport: TransportConfig | null;
  proxyOpts?: ProxyFetchOpts;
}): Promise<Response> {
  const { body, account, transport, proxyOpts } = opts;

  const baseUrl = account.base_url || CODEBUDDY_BASE_URL;
  const url = `${baseUrl}${CODEBUDDY_CHAT_ENDPOINT}`;

  // Inject system/temperature defaults if missing
  const payload = ensureCodeBuddyDefaults(body);

  // Auth header — CodeBuddy uses long-lived API key
  const headers: Record<string, string> = {
    Authorization: `Bearer ${account.api_key}`,
  };

  return upstreamFetch(url, payload, headers, transport, proxyOpts);
}
