import { Hono } from "hono";
import type Database from "better-sqlite3";
import { getRequestLogById } from "../../db/repos/requestLogs.js";
import { handleApiError, ApiError } from "./middleware.js";

export const requestLogRoutes = new Hono();

requestLogRoutes.get("/request-logs/:id", (c) => {
  try {
    const db = c.get("db") as Database.Database;
    const id = Number(c.req.param("id"));
    const row = getRequestLogById(db, id);
    if (!row) throw new ApiError("not_found", "request log not found", 404);
    return c.json({
      id: row.id, createdAt: row.created_at, model: row.model, statusCode: row.status_code,
      latencyMs: row.latency_ms,
      promptTokens: row.prompt_tokens, completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens, cost: row.cost_usd,
      clientKeyId: row.client_key_id, accountId: row.account_id,
      requestBody: row.request_body, responseBody: row.response_body,
      requestHeaders: row.request_headers ? JSON.parse(row.request_headers) : null,
      responseHeaders: row.response_headers ? JSON.parse(row.response_headers) : null,
      error: row.error,
    });
  } catch (e) { return handleApiError(e); }
});
