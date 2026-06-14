import type Database from 'better-sqlite3';
import { cleanupExpiredSessions } from '../auth/session.js';
import { listAccounts } from '../db/repos/accounts.js';
import { cleanupOldQuota } from '../db/repos/quotaSnapshots.js';
import { cleanupOldLogs } from '../db/repos/requestLogs.js';
import { pullQuota } from '../providers/quota.js';
import { getRequestLogRetentionDays } from '../util/env.js';
import { log } from '../util/log.js';

const RETENTION_DAYS = getRequestLogRetentionDays();

let intervalHandle: NodeJS.Timeout | null = null;

export async function tickQuotaOnce(db: Database.Database): Promise<void> {
  try {
    for (const a of listAccounts(db)) {
      if (!a.enabled) continue;
      if (a.credit_type !== 'token-plan') continue;
      const r = await pullQuota(db, a);
      if (!r.ok) log.warn({ account: a.id, error: r.error }, 'quota pull failed');
    }
    cleanupOldQuota(db, 30);
    cleanupExpiredSessions(db);
    const removed = cleanupOldLogs(db, RETENTION_DAYS);
    if (removed > 0) log.info({ removed, retentionDays: RETENTION_DAYS }, 'request logs pruned');
  } catch (e: unknown) {
    log.error({ err: (e as Error).message }, 'quota tick failed');
  }
}

export function startQuotaPuller(db: Database.Database, intervalMs: number): void {
  if (intervalHandle) return;
  const tick = () => {
    void tickQuotaOnce(db);
  };
  void tickQuotaOnce(db);
  intervalHandle = setInterval(tick, intervalMs);
  if (intervalHandle.unref) intervalHandle.unref();
  log.info({ intervalMs }, 'quota puller started');
}

export function stopQuotaPuller(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
