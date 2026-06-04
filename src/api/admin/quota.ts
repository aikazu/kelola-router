import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { listAccounts } from '../../db/repos/accounts.js';
import { handleApiError } from './middleware.js';

export const quotaRoutes = new Hono();

quotaRoutes.get('/quota', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const accounts = listAccounts(db);
    return c.json(
      accounts.map((a) => {
        // Latest snapshot per (model_name, window_type). Real data is per-model
        // (general, video, …) so grouping by window_type alone collapses models.
        const snaps = db
          .prepare(
            `SELECT * FROM quota_snapshots
         WHERE account_id = ?
         AND model_name IS NOT NULL
         AND id IN (
           SELECT MAX(id) FROM quota_snapshots
           WHERE account_id = ?
           AND model_name IS NOT NULL
           GROUP BY model_name, window_type
         )
         ORDER BY model_name, window_type DESC`
          )
          .all(a.id, a.id) as Array<{
          model_name: string | null;
          window_type: string | null;
          total_count: number | null;
          remaining_count: number | null;
          used_count: number | null;
          remaining_percent: number | null;
          remains_time: number | null;
          window_end: string | null;
          fetched_at: string;
        }>;
        return {
          accountId: a.id,
          label: a.label,
          creditType: a.credit_type,
          enabled: !!a.enabled,
          windows: snaps.map((s) => ({
            modelName: s.model_name ?? 'general',
            windowType: s.window_type ?? 'unknown',
            usedCount: s.used_count ?? 0,
            totalCount: s.total_count ?? 0,
            remainingCount: s.remaining_count ?? 0,
            remainingPercent: s.remaining_percent,
            remainsTime: s.remains_time,
            windowEnd: s.window_end,
            fetchedAt: s.fetched_at,
          })),
        };
      })
    );
  } catch (e) {
    return handleApiError(e);
  }
});
