import type { TransportConfig } from "./types.js";

/**
 * Forwards a request to upstream. In v0.1, relay + proxy are ignored
 * (always direct). v0.6 implements both paths.
 */
export async function proxyAwareFetch(
  targetUrl: string,
  options: RequestInit,
  _transportConfig: TransportConfig | null,
): Promise<Response> {
  return globalThis.fetch(targetUrl, options);
}