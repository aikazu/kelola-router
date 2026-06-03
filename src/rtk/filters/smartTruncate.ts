import {
  SMART_TRUNCATE_HEAD,
  SMART_TRUNCATE_MIN_LINES,
  SMART_TRUNCATE_TAIL,
} from '../constants.js';
import type { FilterFn } from '../types.js';

export const smartTruncate: FilterFn = (text: string): string => {
  const lines = text.split('\n');
  if (lines.length < SMART_TRUNCATE_MIN_LINES) return text;
  const head = lines.slice(0, SMART_TRUNCATE_HEAD);
  const tail = lines.slice(-SMART_TRUNCATE_TAIL);
  const skipped = lines.length - SMART_TRUNCATE_HEAD - SMART_TRUNCATE_TAIL;
  return [...head, `... [${skipped} lines truncated] ...`, ...tail].join('\n');
};
smartTruncate.filterName = 'smart-truncate';
