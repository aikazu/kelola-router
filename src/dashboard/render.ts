import { layout, type NavKey } from "./layout.js";

export type PageName = NavKey;

/**
 * Wrap page body with layout, marking the current nav link as active.
 * Pages should import this rather than `layout` directly so the active
 * nav state is always wired up.
 */
export function page(title: string, active: PageName, body: string): string {
  return layout(title, body, active);
}
