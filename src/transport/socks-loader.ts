import type { Dispatcher } from 'undici';

const cache = new Map<string, Dispatcher>();
const MAX_SIZE = 50;

function evictIfFull(): void {
  if (cache.size >= MAX_SIZE) {
    const first = cache.keys().next().value as string | undefined;
    if (first) cache.delete(first);
  }
}

export async function getSocksDispatcher(socksUrl: string): Promise<Dispatcher> {
  const cached = cache.get(socksUrl);
  if (cached) return cached;
  const mod = await import('socks-proxy-agent');
  const SocksProxyAgent = mod.SocksProxyAgent;
  const agent = new SocksProxyAgent(socksUrl) as unknown as Dispatcher;
  evictIfFull();
  cache.set(socksUrl, agent);
  return agent;
}

export function invalidateSocks(socksUrl?: string): void {
  if (socksUrl === undefined) {
    cache.clear();
    return;
  }
  cache.delete(socksUrl);
}

export function _resetSocksCacheForTests(): void {
  cache.clear();
}
