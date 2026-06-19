// Client-side mirror of the server's PREFIX_TO_PROVIDER map
// (src/providers/modelPrefix.ts). Keep in sync when a provider is added.

export const PREFIX_BY_PROVIDER: Record<string, string> = {
  minimax: 'mx',
  kiro: 'kr',
  codebuddy: 'cb',
  pioneer: 'pio',
  notion: 'nt',
  zai: 'zai',
};

/** Providers whose upstream exposes a /v1/models list endpoint. */
export const PROVIDERS_WITH_UPSTREAM_LIST = new Set(['minimax', 'pioneer']);

/**
 * Client call string for a model row, e.g. `pio/claude-opus-4-8`.
 * Pioneer rows are namespaced `pioneer/<id>` in the DB; strip the namespace once.
 */
export function callName(provider: string, dbName: string): string {
  const prefix = PREFIX_BY_PROVIDER[provider];
  if (!prefix) return dbName;
  const bare = provider === 'pioneer' ? dbName.replace(/^pioneer\//, '') : dbName;
  return `${prefix}/${bare}`;
}
