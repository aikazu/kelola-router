import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pollDeviceToken, startDeviceCodeFlow } from './device-code.js';

// Mock proxyAwareFetch
vi.mock('../../transport/proxy-fetch.js', () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from '../../transport/proxy-fetch.js';

const mockFetch = proxyAwareFetch as ReturnType<typeof vi.fn>;

describe('startDeviceCodeFlow', () => {
  beforeEach(() => mockFetch.mockReset());

  it('registers client then starts device auth (builder-id)', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ clientId: 'cid123', clientSecret: 'sec456' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          deviceCode: 'dc-xyz',
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://device.sso.us-east-1.amazonaws.com/',
          verificationUriComplete:
            'https://device.sso.us-east-1.amazonaws.com/?user_code=ABCD-EFGH',
          expiresIn: 600,
          interval: 5,
        }),
      });

    const result = await startDeviceCodeFlow({ authMethod: 'builder-id' });

    expect(result.clientId).toBe('cid123');
    expect(result.clientSecret).toBe('sec456');
    expect(result.userCode).toBe('ABCD-EFGH');
    expect(result.deviceCode).toBe('dc-xyz');
    expect(result.authMethod).toBe('builder-id');
    expect(result.region).toBe('us-east-1');

    // Verify register call
    const [regUrl, regOpts] = mockFetch.mock.calls[0];
    expect(regUrl).toBe('https://oidc.us-east-1.amazonaws.com/client/register');
    expect(JSON.parse(regOpts.body)).toMatchObject({ clientName: 'kelola-router-oauth' });

    // Verify device auth call
    const [devUrl, devOpts] = mockFetch.mock.calls[1];
    expect(devUrl).toBe('https://oidc.us-east-1.amazonaws.com/device_authorization');
    expect(JSON.parse(devOpts.body)).toMatchObject({ clientId: 'cid123', clientSecret: 'sec456' });
  });

  it('uses custom region for idc', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'c', clientSecret: 's' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          deviceCode: 'd',
          userCode: 'U',
          verificationUri: 'https://x',
          verificationUriComplete: 'https://x?u=U',
          expiresIn: 300,
        }),
      });

    const result = await startDeviceCodeFlow({
      authMethod: 'idc',
      region: 'eu-west-1',
      startUrl: 'https://my-org.awsapps.com/start',
    });

    expect(result.region).toBe('eu-west-1');
    expect(result.authMethod).toBe('idc');
    expect(mockFetch.mock.calls[0][0]).toContain('eu-west-1');
  });

  it('throws if idc has no startUrl', async () => {
    await expect(startDeviceCodeFlow({ authMethod: 'idc' })).rejects.toThrow('startUrl');
  });

  it('throws on register failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'bad request' });
    await expect(startDeviceCodeFlow({ authMethod: 'builder-id' })).rejects.toThrow(
      'Client registration failed'
    );
  });

  it('throws on device auth failure', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'c', clientSecret: 's' }) })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'server error' });
    await expect(startDeviceCodeFlow({ authMethod: 'builder-id' })).rejects.toThrow(
      'Device authorization failed'
    );
  });
});

describe('pollDeviceToken', () => {
  beforeEach(() => mockFetch.mockReset());

  it('returns success with tokens', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 }),
    });

    const result = await pollDeviceToken({ deviceCode: 'dc', clientId: 'c', clientSecret: 's' });
    expect(result.status).toBe('success');
    expect(result.accessToken).toBe('at');
    expect(result.refreshToken).toBe('rt');
  });

  it('returns pending on authorization_pending', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'authorization_pending' }),
    });

    const result = await pollDeviceToken({ deviceCode: 'dc', clientId: 'c', clientSecret: 's' });
    expect(result.status).toBe('pending');
  });

  it('returns pending on slow_down', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'slow_down' }),
    });

    const result = await pollDeviceToken({ deviceCode: 'dc', clientId: 'c', clientSecret: 's' });
    expect(result.status).toBe('pending');
  });

  it('returns error for other failures', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'expired_token', error_description: 'Device code expired' }),
    });

    const result = await pollDeviceToken({ deviceCode: 'dc', clientId: 'c', clientSecret: 's' });
    expect(result.status).toBe('error');
    expect(result.error).toBe('Device code expired');
  });

  it('posts to correct region endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 }),
    });

    await pollDeviceToken({
      deviceCode: 'dc',
      clientId: 'c',
      clientSecret: 's',
      region: 'ap-southeast-1',
    });
    expect(mockFetch.mock.calls[0][0]).toBe('https://oidc.ap-southeast-1.amazonaws.com/token');
  });
});
