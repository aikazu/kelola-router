import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { aggregateUsage, type PagedLogFilter, pagedLogs } from '../../db/repos/requestLogs.js';
import { handleApiError } from './middleware.js';

export const usageRoutes = new Hono();

usageRoutes.get('/usage', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const q = c.req.query();
    const days = q.days ? Math.min(365, Math.max(1, Number(q.days))) : 30;
    const page = q.page ? Math.max(1, Number(q.page)) : 1;
    const pageSize = q.page_size ? Math.min(200, Math.max(1, Number(q.page_size))) : 50;
    const clientKeyId = q.client_key ? Number(q.client_key) : undefined;
    const model = q.model || undefined;
    const statusCode = q.status ? Number(q.status) : undefined;
    const search = q.q || undefined;
    const fromIso = q.from || undefined;
    const toIso = q.to || undefined;
    const sortBy = (q.sort_by as PagedLogFilter['sortBy']) || 'created_at';
    const sortDir = (q.sort_dir as PagedLogFilter['sortDir']) || 'desc';

    // Period 1: requested window for summary + page
    const filter: PagedLogFilter = {
      clientKeyId,
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
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    if (!fromIso) filter.fromIso = since;
    const paged = pagedLogs(db, filter);

    // Period 2: same window length immediately before, for delta
    const prevSince = new Date(Date.now() - 2 * days * 86_400_000).toISOString();
    const prevTo = since;
    const prev = aggregateUsage(db, { clientKeyId, days }); // summary on full window
    const prevRow = db
      .prepare(`
      SELECT COALESCE(SUM(cost_usd),0) as cost, COUNT(*) as reqs, COALESCE(SUM(total_tokens),0) as toks
      FROM request_logs
      WHERE created_at >= ? AND created_at < ? ${clientKeyId !== undefined ? 'AND client_key_id = ?' : ''}
    `)
      .get(
        ...(clientKeyId !== undefined ? [prevSince, prevTo, clientKeyId] : [prevSince, prevTo])
      ) as { cost: number; reqs: number; toks: number };

    const deltaPct = (a: number, b: number) => (b === 0 ? null : ((a - b) / b) * 100);

    return c.json({
      summary: {
        totalCost: prev.total_cost,
        totalRequests: prev.total_requests,
        totalTokens: prev.total_tokens,
        deltaCostPct: deltaPct(prev.total_cost, prevRow.cost),
        deltaRequestsPct: deltaPct(prev.total_requests, prevRow.reqs),
        deltaTokensPct: deltaPct(prev.total_tokens, prevRow.toks),
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
          error: l.error,
        })),
        total: paged.total,
        page: paged.page,
        pageSize: paged.pageSize,
        totalPages: paged.totalPages,
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
});
