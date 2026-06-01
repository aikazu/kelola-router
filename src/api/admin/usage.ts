import { Hono } from "hono";
import type Database from "better-sqlite3";
import { recentLogs, aggregateUsage } from "../../db/repos/requestLogs.js";
import { handleApiError } from "./middleware.js";

export const usageRoutes = new Hono();

usageRoutes.get("/usage", (c) => {
  try {
    const db = c.get("db") as Database.Database;
    const days = Number(c.req.query("days") ?? "30");
    const clientKeyQ = c.req.query("client_key");
    const clientKeyId = clientKeyQ ? Number(clientKeyQ) : undefined;
    const filter: { clientKeyId?: number; limit: number } = { limit: 100 };
    if (clientKeyId !== undefined) filter.clientKeyId = clientKeyId;
    const logs = recentLogs(db, filter);
    const agg = aggregateUsage(db, { ...(clientKeyId !== undefined ? { clientKeyId } : {}), days });
    return c.json({
      summary: {
        totalCost: agg.total_cost, totalRequests: agg.total_requests, totalTokens: agg.total_tokens,
      },
      logs: logs.map(l => ({
        id: l.id, createdAt: l.created_at, model: l.model, statusCode: l.status_code,
        cost: l.cost_usd, latencyMs: l.latency_ms, totalTokens: l.total_tokens,
        promptTokens: l.prompt_tokens, completionTokens: l.completion_tokens,
        clientKeyId: l.client_key_id, accountId: l.account_id,
      })),
    });
  } catch (e) { return handleApiError(e); }
});
