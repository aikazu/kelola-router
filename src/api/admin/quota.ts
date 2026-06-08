import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { listAccounts } from '../../db/repos/accounts.js';
import { ensureAccessToken } from '../../providers/kiro/auth.js';
import { fetchKiroUsage } from '../../providers/kiro/usage.js';
import { handleApiError } from './middleware.js';

export const quotaRoutes = new Hono();

quotaRoutes.get('/quota', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const accounts = listAccounts(db);
    const results = [];

    for (const a of accounts) {
      if (a.provider === 'kiro') {
        // Fetch live usage from Kiro management endpoint
        try {
          const auth = await ensureAccessToken(db, a);
          const region = auth.providerData?.region || 'us-east-1';
          const profileArn = auth.providerData?.profileArn || null;
          const usage = await fetchKiroUsage(auth.accessToken, { region, profileArn });
          if (usage) {
            const breakdown = usage.usageBreakdownList[0];
            const resetDate = new Date(usage.nextDateReset * 1000).toISOString();
            const remainsTime = Math.max(0, usage.nextDateReset - Math.floor(Date.now() / 1000));
            results.push({
              accountId: a.id,
              label: a.label,
              creditType: usage.subscriptionInfo.subscriptionTitle || 'kiro',
              enabled: !!a.enabled,
              provider: 'kiro',
              windows: breakdown
                ? [
                    {
                      modelName: breakdown.displayName || 'Credits',
                      windowType: 'monthly',
                      usedCount: Math.round(breakdown.currentUsageWithPrecision),
                      totalCount: breakdown.usageLimit,
                      remainingCount:
                        breakdown.usageLimit - Math.round(breakdown.currentUsageWithPrecision),
                      remainingPercent: Math.round(
                        ((breakdown.usageLimit - breakdown.currentUsageWithPrecision) /
                          breakdown.usageLimit) *
                          100
                      ),
                      remainsTime,
                      windowEnd: resetDate,
                      fetchedAt: new Date().toISOString(),
                    },
                  ]
                : [],
            });
            continue;
          }
        } catch {
          /* fall through to empty */
        }
        results.push({
          accountId: a.id,
          label: a.label,
          creditType: 'kiro',
          enabled: !!a.enabled,
          provider: 'kiro',
          windows: [],
        });
        continue;
      }

      // MiniMax: existing quota_snapshots logic
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
      results.push({
        accountId: a.id,
        label: a.label,
        creditType: a.credit_type,
        enabled: !!a.enabled,
        provider: 'minimax',
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
      });
    }
    return c.json(results);
  } catch (e) {
    return handleApiError(e);
  }
});
