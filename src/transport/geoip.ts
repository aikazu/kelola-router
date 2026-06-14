import { proxyAwareFetch } from './proxyFetch.js';
import type { TransportConfig } from './types.js';

export interface GeoResult {
  /** True if the request reached the geoip endpoint through the transport. */
  active: boolean;
  /** 2-letter country code (e.g. 'SG'), null if undetermined. */
  country: string | null;
}

// Free, no-key geoip. Returns the egress IP's country as seen by the upstream,
// which is exactly the IP a proxy/relay presents.
const GEO_URL = 'https://ipapi.co/json/';

/**
 * Probe a transport for connectivity + egress country. Routes a lightweight GET
 * through the transport; a reachable endpoint marks it active and the response
 * country code is captured (e.g. 'SG'). Never throws — failures map to
 * `{ active: false, country: null }`.
 */
export async function checkTransportGeo(
  cfg: TransportConfig,
  timeoutMs = 8000
): Promise<GeoResult> {
  try {
    const res = await proxyAwareFetch(
      GEO_URL,
      { method: 'GET', signal: AbortSignal.timeout(timeoutMs) },
      cfg
    );
    let country: string | null = null;
    try {
      const body = (await res.json()) as { country_code?: string; countryCode?: string };
      country = body.country_code ?? body.countryCode ?? null;
    } catch {
      country = null;
    }
    return { active: true, country: country ? country.toUpperCase() : null };
  } catch {
    return { active: false, country: null };
  }
}
