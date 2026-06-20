import { type ProxyFetchOpts, proxyAwareFetch } from '../transport/proxyFetch.js';
import type { TransportConfig } from '../transport/types.js';

/**
 * POST a JSON body to an upstream provider URL. Thin wrapper over
 * proxyAwareFetch that sets the right Content-Type and serializes the body.
 */
export async function upstreamFetch(
  url: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
  transport: TransportConfig | null = null,
  opts?: ProxyFetchOpts,
  signal?: AbortSignal
): Promise<Response> {
  return proxyAwareFetch(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      ...(signal ? { signal } : {}),
    },
    transport,
    opts
  );
}
