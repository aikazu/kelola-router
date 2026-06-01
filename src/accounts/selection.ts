import { filterAvailableAccounts } from "./state.js";
import type { AccountState, SelectionMode } from "./types.js";

export function selectAccount(
  accounts: AccountState[],
  mode: SelectionMode,
  stickyKey?: string,
  stickyMap?: Map<string, string>,
): AccountState | null {
  const available = filterAvailableAccounts(accounts);
  if (available.length === 0) return null;

  if (mode === "sticky" && stickyKey && stickyMap?.has(stickyKey)) {
    const pinnedId = stickyMap.get(stickyKey)!;
    const pinned = available.find(a => a.id === pinnedId);
    if (pinned) return pinned;
  }

  return available.sort((a, b) => a.backoffLevel - b.backoffLevel)[0];
}