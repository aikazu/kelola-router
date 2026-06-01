import type { Dispatcher } from "undici";

const cache = new Map<string, Dispatcher>();
const MAX_SIZE = 50;

export async function getDispatcher(proxyUrl: string): Promise<Dispatcher | null> {
  if (!proxyUrl) return null;
  if (cache.has(proxyUrl)) return cache.get(proxyUrl)!;
  if (cache.size >= MAX_SIZE) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  const { ProxyAgent } = await import("undici");
  const agent = new ProxyAgent({ uri: proxyUrl });
  cache.set(proxyUrl, agent);
  return agent;
}