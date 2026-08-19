/**
 * Build Kiro `accounts` row fields from an import request.
 *
 * Supports every way a user can hand us Kiro credentials:
 *   - "token"      — paste the credential JSON from Kiro IDE
 *                    (`~/.aws/sso/cache/kiro-auth-token.json`) or the AWS SSO
 *                    cache file, OR just a raw refresh token.
 *   - "builder-id" — AWS Builder ID. With clientId+clientSecret it refreshes via
 *                    AWS SSO OIDC (us-east-1); otherwise via Kiro desktop social
 *                    auth (refresh token only).
 *   - "idc"        — AWS IAM Identity Center (corporate SSO): clientId +
 *                    clientSecret + region, refreshed via oidc.{region}.
 *   - "social"     — Kiro desktop social login (refresh token only).
 *
 * The refresh token is stored in `accounts.api_key`; SSO/OIDC details go in
 * `provider_data`; any access token + expiry are cached so the first request
 * does not have to refresh.
 */

export type KiroImportMethod = 'token' | 'builder-id' | 'idc' | 'social';

export interface KiroImportInput {
  label?: string;
  method?: KiroImportMethod;
  credentialJson?: string | Record<string, unknown>;
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: string;
  clientId?: string;
  clientSecret?: string;
  region?: string;
  profileArn?: string;
}

export interface KiroAccountFields {
  label: string;
  api_key: string;
  provider_data: string;
  access_token: string | null;
  token_expires_at: string | null;
}

function parseCredentialJson(raw: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new Error('credentialJson is not valid JSON');
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function buildKiroAccountFields(input: KiroImportInput): KiroAccountFields {
  const json = input.credentialJson ? parseCredentialJson(input.credentialJson) : {};

  // Explicit fields win over values pulled from the pasted credential blob.
  const refreshToken = str(input.refreshToken) ?? str(json.refreshToken);
  const accessToken = str(input.accessToken) ?? str(json.accessToken);
  const expiresAt = str(input.expiresAt) ?? str(json.expiresAt);
  const clientId = str(input.clientId) ?? str(json.clientId);
  const clientSecret = str(input.clientSecret) ?? str(json.clientSecret);
  const region = str(input.region) ?? str(json.region);
  const profileArn = str(input.profileArn) ?? str(json.profileArn);

  if (!refreshToken) {
    throw new Error('refresh token is required (paste credential JSON or provide refreshToken)');
  }

  const hasOidc = Boolean(clientId && clientSecret);
  let authMethod: 'idc' | 'builder-id' | 'social';
  switch (input.method) {
    case 'idc':
      if (!hasOidc) throw new Error('IAM Identity Center requires clientId + clientSecret');
      authMethod = 'idc';
      break;
    case 'builder-id':
      authMethod = hasOidc ? 'builder-id' : 'social';
      break;
    case 'social':
      authMethod = 'social';
      break;
    default:
      // "token" / unspecified: infer from what we got.
      authMethod = hasOidc ? (region && region !== 'us-east-1' ? 'idc' : 'builder-id') : 'social';
  }

  const providerData: Record<string, string> = { authMethod };
  if (hasOidc) {
    providerData.clientId = clientId!;
    providerData.clientSecret = clientSecret!;
  }
  if (region) providerData.region = region;
  if (profileArn) providerData.profileArn = profileArn;

  return {
    label: str(input.label) ?? 'kiro',
    api_key: refreshToken,
    provider_data: JSON.stringify(providerData),
    access_token: accessToken ?? null,
    token_expires_at: expiresAt ?? null,
  };
}
