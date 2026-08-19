import { describe, expect, it, vi } from 'vitest';
import { checkTransportGeo } from './geoip.js';
import * as proxyFetch from './proxy-fetch.js';
import type { TransportConfig } from './types.js';

const cfg: TransportConfig = { relay: null, proxy: { kind: 'http', url: 'http://h:8080' } };

describe('checkTransportGeo', () => {
  it('returns active + country when the probe succeeds', async () => {
    vi.spyOn(proxyFetch, 'proxyAwareFetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'success', countryCode: 'SG' }), { status: 200 })
    );
    const res = await checkTransportGeo(cfg);
    expect(res.active).toBe(true);
    expect(res.country).toBe('SG');
  });

  it('returns inactive when the probe throws', async () => {
    vi.spyOn(proxyFetch, 'proxyAwareFetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await checkTransportGeo(cfg);
    expect(res.active).toBe(false);
    expect(res.country).toBeNull();
  });

  it('returns active with null country when body has no countryCode', async () => {
    vi.spyOn(proxyFetch, 'proxyAwareFetch').mockResolvedValue(
      new Response('not json', { status: 200 })
    );
    const res = await checkTransportGeo(cfg);
    expect(res.active).toBe(true);
    expect(res.country).toBeNull();
  });
});
