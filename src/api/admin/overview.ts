import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { listAccounts } from '../../db/repos/accounts.js';
import { aggregateUsage, recentLogs } from '../../db/repos/requestLogs.js';
import { handleApiError } from './middleware.js';

export const overviewRoutes = new Hono();

overviewRoutes.get('/overview', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const agg = aggregateUsage(db, { days: 7 });
    const accounts = listAccounts(db);
    const recent = recentLogs(db, { limit: 5 });
    const enabledAccounts = accounts.filter((a) => a.enabled).length;
    const ckRow = db.prepare(`SELECT COUNT(*) as n FROM client_keys WHERE enabled = 1`).get() as {
      n: number;
    };
    return c.json({
      stats: {
        totalCost: agg.total_cost,
        totalRequests: agg.total_requests,
        totalTokens: agg.total_tokens,
        enabledAccounts,
        totalAccounts: accounts.length,
        activeClientKeys: ckRow.n,
      },
      byModel: agg.by_model.map((m) => ({ model: m.model, cost: m.cost, requests: m.requests })),
      recent: recent.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        model: r.model,
        statusCode: r.status_code,
        cost: r.cost_usd,
        latencyMs: r.latency_ms,
        clientKeyId: r.client_key_id,
        accountId: r.account_id,
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
});
