import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../db/index.js';
import { createAccount } from '../../db/repos/accounts.js';
import type { KiroAuth } from '../../providers/kiro/auth.js';
import type { KiroUsageLimits } from '../../providers/kiro/usage.js';
import { app, resetDb } from '../../server.js';

// Mock the two upstream Kiro helpers the quota route depends on. Each account
// triggers ensureAccessToken + fetchKiroUsage; mocking them at the module level
// lets us drive per-account success/failure from the test.
vi.mock('../../providers/kiro/auth.js', () => ({
  ensureAccessToken: vi.fn(),
}));
vi.mock('../../providers/kiro/usage.js', () => ({
  fetchKiroUsage: vi.fn(),
}));

import { ensureAccessToken } from '../../providers/kiro/auth.js';
import { fetchKiroUsage } from '../../providers/kiro/usage.js';
import type { QuotaWindow } from './quota.js';

const mockEnsureAccessToken = ensureAccessToken as ReturnType<typeof vi.fn>;
const mockFetchKiroUsage = fetchKiroUsage as ReturnType<typeof vi.fn>;

const HEALTHY_AUTH: KiroAuth = {
  accessToken: 'Bearer healthy-token',
  providerData: { region: 'us-east-1', profileArn: undefined },
};

const HEALTHY_USAGE: KiroUsageLimits = {
  nextDateReset: Math.floor(Date.now() / 1000) + 86400,
  subscriptionInfo: {
    type: 'metered',
    subscriptionTitle: 'Test Kiro',
    overageCapability: 'enabled',
    upgradeCapability: 'enabled',
  },
  usageBreakdownList: [
    {
      currentUsage: 100,
      currentUsageWithPrecision: 100,
      usageLimit: 1000,
      usageLimitWithPrecision: 1000,
      overageCap: 0,
      overageRate: 0,
      overageCharges: 0,
      currentOverages: 0,
      currency: 'USD',
      displayName: 'Credits',
      resourceType: 'credits',
      unit: 'requests',
      nextDateReset: Math.floor(Date.now() / 1000) + 86400,
      bonuses: [],
    },
  ],
  overageConfiguration: { overageStatus: 'enabled' },
  userInfo: { userId: 'u' },
};

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'qroute-')), 't.db');
  process.env.ROUTER_ADMIN_KEY = 'ak_test';
  resetDb();
  mockEnsureAccessToken.mockReset();
  mockFetchKiroUsage.mockReset();
});

describe('GET /api/admin/quota', () => {
  it('returns per-account results even if one Kiro account fails', async () => {
    const db = openDb();
    createAccount(db, {
      id: 'acc_healthy',
      label: 'Healthy',
      credit_type: 'token-plan',
      api_key: 'k1',
      provider: 'kiro',
    });
    createAccount(db, {
      id: 'acc_broken',
      label: 'Broken',
      credit_type: 'token-plan',
      api_key: 'k2',
      provider: 'kiro',
    });

    // Per-account mock outcomes: healthy succeeds, broken's ensureAccessToken
    // throws. mockImplementation routes by account.id so Promise.allSettled
    // can fan out in parallel without serializing.
    mockEnsureAccessToken.mockImplementation(async (_db, account) => {
      if (account.id === 'acc_healthy') return HEALTHY_AUTH;
      throw new Error('refresh failed');
    });
    mockFetchKiroUsage.mockResolvedValue(HEALTHY_USAGE);

    const res = await app.request('/api/admin/quota');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      accounts: Array<{
        accountId: string;
        ok: boolean;
        windows?: QuotaWindow[];
        error?: string;
      }>;
    };
    expect(Array.isArray(body.accounts)).toBe(true);
    expect(body.accounts).toHaveLength(2);

    const healthy = body.accounts.find((a) => a.accountId === 'acc_healthy');
    const broken = body.accounts.find((a) => a.accountId === 'acc_broken');
    expect(healthy?.ok).toBe(true);
    expect(healthy?.windows).toBeDefined();
    expect(healthy?.windows?.length).toBeGreaterThan(0);
    expect(broken?.ok).toBe(false);
    expect(broken?.error).toMatch(/refresh failed/);
  });
});
