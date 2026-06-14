/**
 * Kiro usage / quota fetch via GetUsageLimits on the management endpoint.
 *
 * Wire format verified against kiro-cli 2.6.0 (2026-06-09):
 *   POST https://management.{region}.kiro.dev/
 *   X-Amz-Target: AmazonCodeWhispererService.GetUsageLimits
 *   Body: {"profileArn":"arn:..."} (or {} if no profile)
 *   200 → { nextDateReset, subscriptionInfo, usageBreakdownList, overageConfiguration, userInfo }
 */
import { randomUUID } from 'node:crypto';
import { proxyAwareFetch } from '../../transport/proxyFetch.js';
import type { TransportConfig } from '../../transport/types.js';
import {
  KIRO_DEFAULT_REGION,
  kiroCliAmzUserAgent,
  kiroCliManagementEndpoint,
  kiroCliUserAgent,
} from './constants.js';

export interface KiroUsageBreakdown {
  currentUsage: number;
  currentUsageWithPrecision: number;
  usageLimit: number;
  usageLimitWithPrecision: number;
  overageCap: number;
  overageRate: number;
  overageCharges: number;
  currentOverages: number;
  currency: string;
  displayName: string;
  resourceType: string;
  unit: string;
  nextDateReset: number;
  bonuses: unknown[];
}

export interface KiroUsageLimits {
  nextDateReset: number;
  subscriptionInfo: {
    type: string;
    subscriptionTitle: string;
    overageCapability: string;
    upgradeCapability: string;
  };
  usageBreakdownList: KiroUsageBreakdown[];
  overageConfiguration: { overageStatus: string };
  userInfo: { userId: string };
}

export async function fetchKiroUsage(
  accessToken: string,
  opts: {
    region?: string;
    profileArn?: string | null;
    transport?: TransportConfig | null;
    signal?: AbortSignal;
  } = {}
): Promise<KiroUsageLimits | null> {
  const region = opts.region || KIRO_DEFAULT_REGION;
  const body = opts.profileArn ? JSON.stringify({ profileArn: opts.profileArn }) : '{}';

  const resp = await proxyAwareFetch(
    kiroCliManagementEndpoint(region),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.0',
        Accept: '*/*',
        'X-Amz-Target': 'AmazonCodeWhispererService.GetUsageLimits',
        'Amz-Sdk-Invocation-Id': randomUUID(),
        'Amz-Sdk-Request': 'attempt=1; max=3',
        'User-Agent': kiroCliUserAgent('runtime'),
        'x-amz-user-agent': kiroCliAmzUserAgent('runtime'),
        'x-amzn-codewhisperer-optout': 'false',
        'Accept-Encoding': 'gzip',
        Authorization: accessToken.toLowerCase().startsWith('bearer ')
          ? accessToken
          : `Bearer ${accessToken}`,
      },
      body,
      signal: opts.signal,
    },
    opts.transport ?? null
  );

  if (!resp.ok) return null;
  return (await resp.json()) as KiroUsageLimits;
}
