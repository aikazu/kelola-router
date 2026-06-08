/**
 * Kiro (AWS CodeWhisperer) OAuth token refresh.
 *
 * Two auth families (adapted from the 9router reference, MIT):
 *   - AWS SSO OIDC (Builder ID / IDC): when providerData carries clientId +
 *     clientSecret. POSTs JSON to oidc.{region}.amazonaws.com/token.
 *   - Social auth (Kiro desktop): otherwise. POSTs {refreshToken} to the Kiro
 *     desktop refresh endpoint.
 */
import { proxyAwareFetch } from '../../transport/proxyFetch.js';
import type { TransportConfig } from '../../transport/types.js';
import { KIRO_DEFAULT_REGION, KIRO_SOCIAL_TOKEN_URL, kiroOidcTokenUrl } from './constants.js';

export interface KiroProviderData {
  authMethod?: 'social' | 'idc' | 'builder-id';
  clientId?: string;
  clientSecret?: string;
  region?: string;
  profileArn?: string;
}

export interface KiroRefreshResult {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the new access token expires (upstream `expiresIn`). */
  expiresIn?: number;
}

interface KiroTokenResponse {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
}

export async function refreshKiroToken(
  refreshToken: string,
  providerData: KiroProviderData | null | undefined,
  transport: TransportConfig | null = null
): Promise<KiroRefreshResult | null> {
  if (!refreshToken) return null;
  const clientId = providerData?.clientId;
  const clientSecret = providerData?.clientSecret;

  if (clientId && clientSecret) {
    const isIDC = providerData?.authMethod === 'idc';
    const region = providerData?.region || KIRO_DEFAULT_REGION;
    const endpoint = isIDC ? kiroOidcTokenUrl(region) : kiroOidcTokenUrl(KIRO_DEFAULT_REGION);
    const resp = await proxyAwareFetch(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ clientId, clientSecret, refreshToken, grantType: 'refresh_token' }),
      },
      transport
    );
    if (!resp.ok) return null;
    const tokens = (await resp.json()) as KiroTokenResponse;
    if (!tokens.accessToken) return null;
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken || refreshToken,
      expiresIn: tokens.expiresIn,
    };
  }

  const resp = await proxyAwareFetch(
    KIRO_SOCIAL_TOKEN_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'kiro-cli/1.0.0',
      },
      body: JSON.stringify({ refreshToken }),
    },
    transport
  );
  if (!resp.ok) return null;
  const tokens = (await resp.json()) as KiroTokenResponse;
  if (!tokens.accessToken) return null;
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || refreshToken,
    expiresIn: tokens.expiresIn,
  };
}
