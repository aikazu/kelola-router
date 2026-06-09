import type { FilterFn } from './types.js';

export function safeApply(fn: FilterFn | undefined, text: string): string {
  if (typeof fn !== 'function') return text;
  try {
    const out = fn(text);
    if (typeof out !== 'string') return text;
    return out;
  } catch (err: unknown) {
    const name = fn.filterName || 'anonymous';
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[rtk] warning: filter '${name}' panicked — passing through: ${message}`);
    return text;
  }
}
