import type { Dispatcher } from "undici";

export async function getSocksDispatcher(socksUrl: string): Promise<Dispatcher> {
  const mod = await import("socks-proxy-agent");
  const SocksProxyAgent = mod.SocksProxyAgent;
  return new SocksProxyAgent(socksUrl) as unknown as Dispatcher;
}