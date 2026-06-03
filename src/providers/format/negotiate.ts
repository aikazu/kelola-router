export type Format = 'openai' | 'anthropic';
export type FormatOverride = Format | 'auto';

/**
 * Decide which upstream format the router will call given the client's
 * incoming format and an override setting. "auto" = same as client.
 *
 * Override sources (in priority order):
 *   1. settings.minimax.upstreamFormat
 *   2. ROUTER_UPSTREAM_FORMAT env
 *   3. "auto" (default = same as client)
 */
export function getUpstreamFormat(clientFormat: Format, override: FormatOverride): Format {
  if (override === 'openai' || override === 'anthropic') return override;
  return clientFormat;
}
