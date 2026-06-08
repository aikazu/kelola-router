import { beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverProfileArn, ensureProfileArn } from './profile.js';

vi.mock('../../transport/proxyFetch.js', () => ({
  proxyAwareFetch: vi.fn(),
}));
vi.mock('../../db/repos/accounts.js', () => ({
  updateAccount: vi.fn(),
}));

import { updateAccount } from '../../db/repos/accounts.js';
import { proxyAwareFetch } from '../../transport/proxyFetch.js';

const mockFetch = proxyAwareFetch as ReturnType<typeof vi.fn>;
const mockUpdate = updateAccount as ReturnType<typeof vi.fn>;

const ARN = 'arn:aws:codewhisperer:us-east-1:730335587721:profile/X7UKYWNDQVV7';

describe('discoverProfileArn', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockUpdate.mockReset();
  });

  it('POSTs ListAvailableProfiles to the management host and returns the first arn', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ profiles: [{ arn: ARN, profileName: 'KiroProfile-us-east-1' }] }),
    });

    const arn = await discoverProfileArn('tok', 'us-east-1');
    expect(arn).toBe(ARN);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://management.us-east-1.kiro.dev/');
    expect(opts.headers['X-Amz-Target']).toBe('AmazonCodeWhispererService.ListAvailableProfiles');
    expect(opts.headers['Content-Type']).toBe('application/x-amz-json-1.0');
    expect(opts.headers['User-Agent']).toContain('codewhispererruntime');
    expect(opts.headers.Authorization).toBe('Bearer tok');
    expect(opts.body).toBe('{}');
  });

  it('returns null on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
    expect(await discoverProfileArn('tok', 'us-east-1')).toBeNull();
  });

  it('returns null when no profiles are available', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ profiles: [] }) });
    expect(await discoverProfileArn('tok', 'eu-central-1')).toBeNull();
  });
});

describe('ensureProfileArn', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockUpdate.mockReset();
  });

  const account = { id: 'acc1' } as never;

  it('returns the existing arn without a network call', async () => {
    const auth = { accessToken: 'tok', providerData: { profileArn: ARN, region: 'us-east-1' } };
    const arn = await ensureProfileArn({} as never, account, auth);
    expect(arn).toBe(ARN);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('discovers, persists, and mutates providerData when arn is missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ profiles: [{ arn: ARN }] }),
    });
    const auth = {
      accessToken: 'tok',
      providerData: { region: 'us-east-1' } as Record<string, unknown>,
    };
    const arn = await ensureProfileArn({} as never, account, auth as never);
    expect(arn).toBe(ARN);
    expect(auth.providerData.profileArn).toBe(ARN);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [, id, patch] = mockUpdate.mock.calls[0];
    expect(id).toBe('acc1');
    expect(JSON.parse(patch.provider_data).profileArn).toBe(ARN);
  });

  it('returns null and does not persist when discovery fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
    const auth = { accessToken: 'tok', providerData: { region: 'us-east-1' } };
    const arn = await ensureProfileArn({} as never, account, auth as never);
    expect(arn).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
