import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { listAccounts } from '../../db/repos/accounts.js';
import { aggregateUsage, type PagedLogFilter, pagedLogs } from '../../db/repos/request-logs.js';
import { getAdminCached, setAdminCached } from './cache.js';
import { handleApiError } from './middleware.js';

export const usageRoutes = new Hono();

usageRoutes.get('/usage', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const q = c.req.query();
    // days=0 (or absent value "0") means all-time. Default window: 1 day.
    const days =
      q.days !== undefined ? Math.min(365, Math.max(0, Math.floor(Number(q.days)) || 0)) : 1;
    const allTime = days === 0;
    const page = q.page ? Math.max(1, Number(q.page)) : 1;
    const pageSize = q.page_size ? Math.min(200, Math.max(1, Number(q.page_size))) : 50;
    const clientKeyId = q.client_key ? Number(q.client_key) : undefined;
    const accountId = q.account_id || undefined;
    const model = q.model || undefined;
    const statusCode = q.status ? Number(q.status) : undefined;
    const search = q.q || undefined;
    const fromIso = q.from || undefined;
    const toIso = q.to || undefined;
    const sortBy = (q.sort_by as PagedLogFilter['sortBy']) || 'created_at';
    const sortDir = (q.sort_dir as PagedLogFilter['sortDir']) || 'desc';
    const cacheKey = `usage:${JSON.stringify({
      days,
      clientKeyId: clientKeyId ?? null,
      accountId: accountId ?? null,
      page,
      pageSize,
      model: model ?? null,
      statusCode: statusCode ?? null,
      search: search ?? null,
      fromIso: fromIso ?? null,
      toIso: toIso ?? null,
      sortBy,
      sortDir,
    })}`;
    const cached = getAdminCached<unknown>(cacheKey);
    if (cached) {
      return c.json(cached);
    }

    // Period 1: requested window for summary + page
    const filter: PagedLogFilter = {
      clientKeyId,
      accountId,
      model,
      statusCode,
      search,
      fromIso,
      toIso,
      page,
      pageSize,
      sortBy,
      sortDir,
    };
    const since = allTime ? null : new Date(Date.now() - days * 86_400_000).toISOString();
    if (!fromIso && since) filter.fromIso = since;
    const paged = pagedLogs(db, filter);

    // Build account label map for response enrichment
    const accounts = listAccounts(db);
    const accountLabelMap = new Map(accounts.map((a) => [a.id, a.label]));

    // summary: apply the FULL filter set (account/model/status/search/etc) so
    // the totals match the rows the user is viewing.
    const cur = aggregateUsage(db, {
      clientKeyId,
      accountId,
      model,
      statusCode,
      search,
      fromIso: filter.fromIso,
      toIso: filter.toIso,
      days,
    });

    // Period 2: same window length immediately before, for delta.
    // All-time has no previous period, so deltas are null. The previous-period
    // query MUST apply the same filter set as the current period — otherwise
    // the delta % is meaningless.
    const deltaPct = (a: number, b: number) => (b === 0 ? null : ((a - b) / b) * 100);
    let deltaCostPct: number | null = null;
    let deltaRequestsPct: number | null = null;
    let deltaTokensPct: number | null = null;
    if (!allTime && since) {
      const prevSince = new Date(Date.now() - 2 * days * 86_400_000).toISOString();
      const prev = aggregateUsage(db, {
        clientKeyId,
        accountId,
        model,
        statusCode,
        search,
        fromIso: prevSince,
        toIso: since,
        days: 0, // explicit window above overrides
      });
      deltaCostPct = deltaPct(cur.total_cost, prev.total_cost);
      deltaRequestsPct = deltaPct(cur.total_requests, prev.total_requests);
      deltaTokensPct = deltaPct(cur.total_tokens, prev.total_tokens);
    }

    const payload = {
      summary: {
        totalCost: cur.total_cost,
        totalRequests: cur.total_requests,
        totalTokens: cur.total_tokens,
        deltaCostPct,
        deltaRequestsPct,
        deltaTokensPct,
      },
      page: {
        rows: paged.rows.map((l) => ({
          id: l.id,
          createdAt: l.created_at,
          model: l.model,
          statusCode: l.status_code,
          cost: l.cost_usd,
          latencyMs: l.latency_ms,
          totalTokens: l.total_tokens,
          promptTokens: l.prompt_tokens,
          completionTokens: l.completion_tokens,
          clientKeyId: l.client_key_id,
          accountId: l.account_id,
          accountLabel: (l.account_id && accountLabelMap.get(l.account_id)) ?? null,
          error: l.error,
        })),
        total: paged.total,
        page: paged.page,
        pageSize: paged.pageSize,
        totalPages: paged.totalPages,
      },
    };

    return c.json(setAdminCached(cacheKey, payload));
  } catch (e) {
    return handleApiError(e);
  }
});
