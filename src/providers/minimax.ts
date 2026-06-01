import { getBaseUrl } from "./baseUrl.js";
import { buildHeaders } from "./headers.js";

export const PROVIDER = "minimax" as const;
export type Provider = typeof PROVIDER;

export interface MinimaxAccount {
  provider: Provider;
  apiKey: string;
  baseUrl: string | null;
}

export function upstreamUrl(account: MinimaxAccount, format: "openai" | "anthropic", path: string): string {
  return `${getBaseUrl({ provider: PROVIDER, baseUrl: account.baseUrl }, format)}${path}`;
}

export function upstreamHeaders(account: MinimaxAccount, stream: boolean, format: "openai" | "anthropic"): Record<string, string> {
  return buildHeaders({ provider: PROVIDER, apiKey: account.apiKey }, stream, format);
}
