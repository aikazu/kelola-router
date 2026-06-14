// Page-local types for the Transports page and its extracted sub-components.
// NOTE: the shared `Transport` in `../../lib/types.ts` is a subset (used by the
// Accounts page). The Transports page additionally needs `country`, `createdAt`
// and `usageCount`, plus a narrower `kind` union. We keep the richer shape here
// rather than mutating the shared type.

export interface Transport {
  id: string;
  label: string;
  type: 'proxy' | 'relay';
  kind: 'http' | 'socks5' | 'vercel' | 'cloudflare';
  url: string;
  enabled: boolean;
  country: string | null;
  createdAt: string;
  usageCount: number;
}

export interface TestResult {
  ok: boolean;
  status?: number;
  latencyMs: number;
  error?: string;
}

export const PROXY_KINDS = ['http', 'socks5'] as const;
export const RELAY_KINDS = ['vercel', 'cloudflare'] as const;
