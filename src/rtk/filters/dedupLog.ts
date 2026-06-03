import { DEDUP_LINE_MAX } from '../constants.js';
import type { FilterFn } from '../types.js';

export const dedupLog: FilterFn = (text: string): string => {
  const lines = text.split('\n');
  const seen = new Map<string, number>();
  const result: string[] = [];

  for (const line of lines) {
    const count = seen.get(line) ?? 0;
    if (count < 3) {
      result.push(line);
      seen.set(line, count + 1);
    } else if (count === 3) {
      result.push(`... [${line} repeated]`);
      seen.set(line, count + 1);
    }
  }

  if (result.length > DEDUP_LINE_MAX) {
    return (
      result.slice(0, DEDUP_LINE_MAX).join('\n') + `\n... [truncated to ${DEDUP_LINE_MAX} lines]`
    );
  }
  return result.join('\n');
};
dedupLog.filterName = 'dedup-log';
