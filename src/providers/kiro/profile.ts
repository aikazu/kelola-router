/**
 * Kiro CLI profile discovery.
 *
 * The CLI runtime endpoint (`runtime.{region}.kiro.dev`) rejects requests
 * without a `profileArn`, but accounts onboarded via OAuth (Builder ID / IDC)
 * or a raw refresh token don't carry one. The real kiro-cli resolves it by
 * calling `AmazonCodeWhispererService.ListAvailableProfiles` on the management
 * host and caching the first profile's ARN.
 *
 * Wire format verified against captured kiro-cli 2.6.0 traffic:
 *   POST https://management.{region}.kiro.dev/
 *   content-type: application/x-amz-json-1.0
 *   x-amz-target: AmazonCodeWhispererService.ListAvailableProfiles
 *   body: {}
 *   200 → {"profiles":[{"arn":"arn:aws:codewhisperer:…:profile/…","profileName":"…"}]}
 */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Account } from '../../db/repos/accounts.js';
import { updateAccount } from '../../db/repos/accounts.js';
import { proxyAwareFetch } from '../../transport/proxyFetch.js';
import type { TransportConfig } from '../../transport/types.js';
import type { KiroAuth } from './auth.js';
import {
  KIRO_DEFAULT_REGION,
  kiroCliAmzUserAgent,
  kiroCliManagementEndpoint,
  kiroCliUserAgent,
} from './constants.js';

interface ListAvailableProfilesResponse {
  profiles?: Array<{ arn?: string; profileName?: string }>;
}

/**
 * Discover the first available profile ARN for a Kiro access token in a region.
 * Returns null when the call fails or the account has no profiles in `region`.
 */
async function discoverProfileArn(
  accessToken: string,
  region: string,
  transport: TransportConfig | null = null,
  signal?: AbortSignal
): Promise<string | null> {
  const resp = await proxyAwareFetch(
    kiroCliManagementEndpoint(region),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.0',
        Accept: '*/*',
        'X-Amz-Target': 'AmazonCodeWhispererService.ListAvailableProfiles',
        'Amz-Sdk-Invocation-Id': randomUUID(),
        'Amz-Sdk-Request': 'attempt=1; max=3',
        'User-Agent': kiroCliUserAgent('runtime'),
        'x-amz-user-agent': kiroCliAmzUserAgent('runtime'),
        'x-amzn-codewhisperer-optout': 'false',
        'Accept-Encoding': 'gzip',
        Authorization: `Bearer ${accessToken}`,
      },
      body: '{}',
      signal,
    },
    transport
  );
  if (!resp.ok) return null;
  const data = (await resp.json()) as ListAvailableProfilesResponse;
  const arn = data.profiles?.find((p) => p.arn)?.arn;
  return arn ?? null;
}

/**
 * Ensure a CLI-persona Kiro account has a `profileArn`, discovering + persisting
 * it on first use. Returns the ARN (existing or freshly discovered), or null if
 * discovery failed. Mutates `auth.providerData` in place so the caller sees it.
 */
export async function ensureProfileArn(
  db: Database.Database,
  account: Account,
  auth: KiroAuth,
  transport: TransportConfig | null = null,
  signal?: AbortSignal
): Promise<string | null> {
  const existing = auth.providerData?.profileArn;
  if (existing) return existing;

  const region = auth.providerData?.region || KIRO_DEFAULT_REGION;
  const arn = await discoverProfileArn(auth.accessToken, region, transport, signal);
  if (!arn) return null;

  // Persist into the provider_data JSON blob so we discover only once.
  const pd = { ...(auth.providerData ?? {}), profileArn: arn };
  if (auth.providerData) auth.providerData.profileArn = arn;
  updateAccount(db, account.id, { provider_data: JSON.stringify(pd) });
  return arn;
}

// @internal — exported for unit tests only; callers should use ensureProfileArn
export { discoverProfileArn };
