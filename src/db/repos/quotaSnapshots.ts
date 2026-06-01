import type Database from "better-sqlite3";

export interface QuotaSnapshot {
  id: number;
  account_id: string;
  source: string;
  total_count: number | null;
  remaining_count: number | null;
  used_count: number | null;
  window_type: string | null;
  window_start: string | null;
  window_end: string | null;
  raw_response: string | null;
  fetched_at: string;
}

export function insertQuotaSnapshot(
  db: Database.Database,
  s: Omit<QuotaSnapshot, "id" | "fetched_at">,
): number {
  const info = db
    .prepare(
      `INSERT INTO quota_snapshots (account_id, source, total_count, remaining_count, used_count,
      window_type, window_start, window_end, raw_response)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      s.account_id,
      s.source,
      s.total_count,
      s.remaining_count,
      s.used_count,
      s.window_type,
      s.window_start,
      s.window_end,
      s.raw_response,
    );
  return info.lastInsertRowid as number;
}

export function latestQuotaByAccount(
  db: Database.Database,
  accountId: string,
  limit = 10,
): QuotaSnapshot[] {
  return db
    .prepare(
      `SELECT * FROM quota_snapshots WHERE account_id = ? ORDER BY fetched_at DESC LIMIT ?`,
    )
    .all(accountId, limit) as QuotaSnapshot[];
}

export function cleanupOldQuota(db: Database.Database, days: number): number {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const info = db
    .prepare(`DELETE FROM quota_snapshots WHERE fetched_at < ?`)
    .run(cutoff);
  return info.changes;
}