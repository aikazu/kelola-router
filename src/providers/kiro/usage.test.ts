import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchKiroUsage } from './usage.js';

// Mock proxyAwareFetch
vi.mock('../../transport/proxy-fetch.js', () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from '../../transport/proxy-fetch.js';

const mockFetch = proxyAwareFetch as ReturnType<typeof vi.fn>;

describe('fetchKiroUsage', () => {
  beforeEach(() => mockFetch.mockReset());

  it('returns null when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    const result = await fetchKiroUsage('Bearer token123');

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('returns parsed KiroUsageLimits on successful response', async () => {
    const mockUsage: import('./usage.js').KiroUsageLimits = {
      nextDateReset: Date.now() + 86400_000,
      subscriptionInfo: {
        type: 'metered',
        subscriptionTitle: 'Amazon Q Developer',
        overageCapability: 'enabled',
        upgradeCapability: 'enabled',
      },
      usageBreakdownList: [
        {
          currentUsage: 42_000,
          currentUsageWithPrecision: 42000.0,
          usageLimit: 500_000,
          usageLimitWithPrecision: 500000.0,
          overageCap: 1_000_000,
          overageRate: 0.00002,
          overageCharges: 0.0,
          currentOverages: 0,
          currency: 'USD',
          displayName: 'CodeWhisperer',
          resourceType: 'code_whisperer',
          unit: 'requests',
          nextDateReset: Date.now() + 86400_000,
          bonuses: [],
        },
      ],
      overageConfiguration: { overageStatus: 'enabled' },
      userInfo: { userId: 'us-east-1:abc-123' },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockUsage,
    });

    const result = await fetchKiroUsage('Bearer token123');

    expect(result).toEqual(mockUsage);
  });

  it('sends profileArn in body when profileArn option is provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        nextDateReset: 0,
        subscriptionInfo: {},
        usageBreakdownList: [],
        overageConfiguration: {},
        userInfo: {},
      }),
    });

    await fetchKiroUsage('Bearer token123', {
      profileArn: 'arn:aws:codewhisperer:us-east-1:1:profile/PROFILE_1',
    });

    const [_url, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body).toEqual({ profileArn: 'arn:aws:codewhisperer:us-east-1:1:profile/PROFILE_1' });
  });

  it('sends empty body when profileArn is null', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        nextDateReset: 0,
        subscriptionInfo: {},
        usageBreakdownList: [],
        overageConfiguration: {},
        userInfo: {},
      }),
    });

    await fetchKiroUsage('Bearer token123', { profileArn: null });

    const [_url, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body as string);
    expect(body).toEqual({});
  });

  it('sends correct headers for GetUsageLimits endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        nextDateReset: 0,
        subscriptionInfo: {},
        usageBreakdownList: [],
        overageConfiguration: {},
        userInfo: {},
      }),
    });

    await fetchKiroUsage('Bearer token123', { profileArn: null });

    const [_url, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['Content-Type']).toBe('application/x-amz-json-1.0');
    expect(opts.headers['X-Amz-Target']).toBe('AmazonCodeWhispererService.GetUsageLimits');
    expect(opts.headers.Authorization).toBe('Bearer token123');
    expect(opts.method).toBe('POST');
  });

  it('passes abort signal to fetch', async () => {
    const controller = new AbortController();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        nextDateReset: 0,
        subscriptionInfo: {},
        usageBreakdownList: [],
        overageConfiguration: {},
        userInfo: {},
      }),
    });

    await fetchKiroUsage('Bearer token123', { signal: controller.signal });

    const [_url, opts] = mockFetch.mock.calls[0];
    expect(opts.signal).toBe(controller.signal);
  });

  it('uses custom region when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        nextDateReset: 0,
        subscriptionInfo: {},
        usageBreakdownList: [],
        overageConfiguration: {},
        userInfo: {},
      }),
    });

    await fetchKiroUsage('Bearer token123', { region: 'eu-west-1' });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('eu-west-1');
  });
});
