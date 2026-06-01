export type ProxyKind = "http" | "socks5";
export type RelayKind = "vercel" | "cloudflare";

export interface ProxyConfig {
  kind: ProxyKind;
  url: string;
}

export interface RelayConfig {
  kind: RelayKind;
  url: string;
}

export interface TransportConfig {
  relay: RelayConfig | null;
  proxy: ProxyConfig | null;
}