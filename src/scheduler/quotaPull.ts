import type Database from "better-sqlite3";
import { listAccounts } from "../db/repos/accounts.js";
import { pullQuota } from "../providers/quota.js";
import { cleanupOldQuota } from "../db/repos/quotaSnapshots.js";
import { log } from "../util/log.js";

let intervalHandle: NodeJS.Timeout | null = null;

export function startQuotaPuller(
  db: Database.Database,
  intervalMs: number,
): void {
  if (intervalHandle) return;

  const tick = async () => {
    try {
      for (const a of listAccounts(db)) {
        if (!a.enabled) continue;
        if (a.credit_type !== "token-plan") continue;
        const r = await pullQuota(db, a);
        if (!r.ok) log.warn({ account: a.id, error: r.error }, "quota pull failed");
      }
      cleanupOldQuota(db, 30);
    } catch (e: unknown) {
      log.error({ err: (e as Error).message }, "quota tick failed");
    }
  };

  tick();
  intervalHandle = setInterval(tick, intervalMs);
  if (intervalHandle.unref) intervalHandle.unref();
  log.info({ intervalMs }, "quota puller started");
}

export function stopQuotaPuller(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}