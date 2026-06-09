import type { Dispatcher } from 'undici';
import { Lru } from '../util/lru.js';

const MAX_SIZE = 50;

// undici's ProxyAgent has a close() that returns Promise<undefined>; we call it
// on eviction so keep-alive sockets are released.
type Closable = Dispatcher & { close?: () => Promise<unknown> };
const cache = new Lru<Dispatcher>(MAX_SIZE, {
  dispose: (_key, value) => {
    const c = value as Closable;
    if (typeof c.close === 'function') {
      // Fire-and-forget; we don't await agent teardown on the hot path.
      void c.close().catch(() => undefined);
    }
  },
});

export async function getDispatcher(proxyUrl: string): Promise<Dispatcher | null> {
  if (!proxyUrl) return null;
  const cached = cache.get(proxyUrl);
  if (cached) return cached;
  const { ProxyAgent } = await import('undici');
  const agent = new ProxyAgent({ uri: proxyUrl });
  cache.set(proxyUrl, agent);
  return agent;
}

/** Drop a single URL from the cache (or the whole cache if no URL given). */
export function invalidateDispatcher(proxyUrl?: string): void {
  cache.invalidate(proxyUrl);
}

/** Test-only: clear cache between tests. */
export function _resetDispatcherCacheForTests(): void {
  cache.invalidate();
}
