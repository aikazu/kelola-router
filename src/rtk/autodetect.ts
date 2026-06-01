import { getFilter } from "./registry.js";
import { DETECT_WINDOW } from "./constants.js";
import type { FilterFn } from "./types.js";

const SIGNATURES: Record<string, RegExp | null> = {
  "smart-truncate": null,
  "dedup-log": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/m,
};

export function autoDetectFilter(text: string): FilterFn {
  const window = text.slice(0, DETECT_WINDOW);
  for (const [name, sig] of Object.entries(SIGNATURES)) {
    if (sig === null) continue;
    if (sig.test(window)) return getFilter(name)!;
  }
  return getFilter("smart-truncate")!;
}
