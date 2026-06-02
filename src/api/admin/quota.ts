import { Hono } from "hono";
import type Database from "better-sqlite3";
import { listAccounts } from "../../db/repos/accounts.js";
import { handleApiError } from "./middleware.js";

export const quotaRoutes = new Hono();

quotaRoutes.get("/quota", (c) => {
  try {
    const db = c.get("db") as Database.Database;
    const accounts = listAccounts(db);
    return c.json(accounts.map(a => {
      const snaps = db.prepare(
        `SELECT * FROM quota_snapshots
         WHERE account_id = ?
         AND id IN (
           SELECT MAX(id) FROM quota_snapshots
           WHERE account_id = ? AND window_type = '5h' GROUP BY window_type
           UNION
           SELECT MAX(id) FROM quota_snapshots
           WHERE account_id = ? AND window_type = 'weekly' GROUP BY window_type
         )`
      ).all(a.id, a.id, a.id) as Array<{
        window_type: string; total_count: number | null; remaining_count: number | null;
        used_count: number | null; window_end: string | null; fetched_at: string;
      }>;
      return {
        accountId: a.id,
        label: a.label,
        creditType: a.credit_type,
        enabled: !!a.enabled,
        windows: snaps.map(s => ({
          windowType: s.window_type ?? "unknown",
          usedCount: s.used_count ?? 0,
          totalCount: s.total_count ?? 0,
          remainingCount: s.remaining_count ?? 0,
          windowEnd: s.window_end,
          fetchedAt: s.fetched_at,
        })),
      };
    }));
  } catch (e) { return handleApiError(e); }
});
