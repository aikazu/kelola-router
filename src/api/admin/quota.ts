import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { type Account, listAccounts } from '../../db/repos/accounts.js';
import { ensureAccessToken } from '../../providers/kiro/auth.js';
import { fetchKiroUsage } from '../../providers/kiro/usage.js';
import { tickQuotaOnce } from '../../scheduler/quota-pull.js';
import { handleApiError } from './middleware.js';

export const quotaRoutes = new Hono();

export interface QuotaWindow {
  modelName: string;
  windowType: string;
  usedCount: number;
  totalCount: number;
  remainingCount: number;
  remainingPercent: number | null;
  remainsTime: number | null;
  windowEnd: string | null;
  fetchedAt: string;
}

interface QuotaAccountBase {
  accountId: string;
  label: string | null;
  creditType: string;
  enabled: boolean;
  provider: 'kiro' | 'minimax';
}

export type QuotaAccountResult =
  | (QuotaAccountBase & { ok: true; windows: QuotaWindow[]; error?: undefined })
  | (QuotaAccountBase & { ok: false; windows: []; error: string });

type QuotaFailure = Extract<QuotaAccountResult, { ok: false }>;

function baseResult(
  a: Account,
  provider: 'kiro' | 'minimax',
  creditType: string
): QuotaAccountBase {
  return {
    accountId: a.id,
    label: a.label,
    creditType,
    enabled: !!a.enabled,
    provider,
  };
}

function fallbackKiro(a: Account, error: string): QuotaFailure {
  const base = baseResult(a, 'kiro', 'kiro');
  return {
    accountId: base.accountId,
    label: base.label,
    creditType: base.creditType,
    enabled: base.enabled,
    provider: base.provider,
    ok: false,
    windows: [],
    error,
  };
}

async function fetchKiroAccount(a: Account, db: Database.Database): Promise<QuotaAccountResult> {
  try {
    const auth = await ensureAccessToken(db, a);
    const region = auth.providerData?.region || 'us-east-1';
    const profileArn = auth.providerData?.profileArn || null;
    const usage = await fetchKiroUsage(auth.accessToken, { region, profileArn });
    if (!usage) return fallbackKiro(a, 'empty usage');
    const breakdown = usage.usageBreakdownList[0];
    const resetDate = new Date(usage.nextDateReset * 1000).toISOString();
    const remainsTime = Math.max(0, usage.nextDateReset - Math.floor(Date.now() / 1000));
    return {
      ...baseResult(a, 'kiro', usage.subscriptionInfo.subscriptionTitle || 'kiro'),
      ok: true,
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
    };
  } catch (e) {
    return fallbackKiro(a, (e as Error).message);
  }
}

quotaRoutes.get('/quota', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const accounts = listAccounts(db);

    // Split Kiro (network) from MiniMax (local DB). Run Kiro fetches in parallel
    // via Promise.allSettled so one bad token doesn't tank the others.
    const kiroAccounts = accounts.filter((a) => a.provider === 'kiro');
    const kiroSettled = await Promise.allSettled(kiroAccounts.map((a) => fetchKiroAccount(a, db)));
    const kiroResults: QuotaAccountResult[] = kiroSettled.map((r, i) => {
      // Promise.allSettled preserves order; index aligns with kiroAccounts source array.
      const acc = kiroAccounts[i]!;
      if (r.status === 'fulfilled') return r.value;
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      return fallbackKiro(acc, msg);
    });

    // MiniMax path is a local SQLite read — no benefit from parallelizing.
    const minimaxResults: QuotaAccountResult[] = [];
    for (const a of accounts) {
      if (a.provider !== 'minimax') continue;
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
      minimaxResults.push({
        ...baseResult(a, 'minimax', a.credit_type),
        ok: true,
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

    return c.json({ accounts: [...kiroResults, ...minimaxResults] });
  } catch (e) {
    return handleApiError(e);
  }
});

quotaRoutes.post('/quota/pull', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    await tickQuotaOnce(db);
    return c.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
});
