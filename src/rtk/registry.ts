import { dedupLog } from './filters/dedup-log.js';
import { smartTruncate } from './filters/smart-truncate.js';
import type { FilterFn } from './types.js';

const FILTERS: Record<string, FilterFn> = {
  'smart-truncate': smartTruncate,
  'dedup-log': dedupLog,
};

export function getFilter(name: string): FilterFn | undefined {
  return FILTERS[name];
}
