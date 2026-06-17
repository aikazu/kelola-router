const PREFIX_TO_PROVIDER: Readonly<Record<string, string>> = {
  mm: 'minimax',
  kr: 'kiro',
  cb: 'codebuddy',
  pio: 'pioneer',
  nt: 'notion',
};

export interface ParsedModel {
  /** Resolved provider when prefixed, else null. */
  provider: string | null;
  /** Part after the prefix, or the whole string when bare. */
  modelName: string;
  prefixed: boolean;
}

/**
 * Parse a `body.model` string into its provider prefix and model name.
 *
 * - `<mm|kr|cb|pio>/<name>` → prefixed, provider mapped, name is everything after
 *   the first slash.
 * - A string with a slash whose first segment is not a known prefix throws.
 * - A string with no slash is bare (resolved later via combos/aliases).
 */
export function parseModelPrefix(raw: string): ParsedModel {
  const slash = raw.indexOf('/');
  if (slash === -1) {
    return { provider: null, modelName: raw, prefixed: false };
  }
  const head = raw.slice(0, slash);
  const provider = PREFIX_TO_PROVIDER[head];
  if (!provider) {
    throw new Error(`unknown model prefix: ${head}`);
  }
  return { provider, modelName: raw.slice(slash + 1), prefixed: true };
}
