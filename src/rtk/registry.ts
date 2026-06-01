import type { FilterFn } from "./types.js";
import { smartTruncate } from "./filters/smartTruncate.js";
import { dedupLog } from "./filters/dedupLog.js";

const FILTERS: Record<string, FilterFn> = {
  "smart-truncate": smartTruncate,
  "dedup-log": dedupLog,
};

export function getFilter(name: string): FilterFn | undefined {
  return FILTERS[name];
}
