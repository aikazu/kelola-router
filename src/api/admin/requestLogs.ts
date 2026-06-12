import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import {
  getRequestLogById,
  getRequestLogByReqId,
  type RequestLog,
} from '../../db/repos/requestLogs.js';
import { ApiError, handleApiError } from './middleware.js';

export const requestLogRoutes = new Hono();

function serializeLog(row: RequestLog) {
  return {
    id: row.id,
    createdAt: row.created_at,
    model: row.model,
    requestedModel: row.requested_model ?? null,
    endpoint: row.endpoint,
    statusCode: row.status_code,
    latencyMs: row.latency_ms,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    cacheCreationTokens: row.cache_creation_tokens,
    cacheReadTokens: row.cache_read_tokens,
    totalTokens: row.total_tokens,
    cost: row.cost_usd,
    rtkBytesSaved: row.rtk_bytes_saved,
    stream: row.stream,
    clientKeyId: row.client_key_id,
    accountId: row.account_id,
    reqId: row.req_id ?? null,
    requestBody: row.request_body,
    responseBody: row.response_body,
    requestHeaders: row.request_headers ? JSON.parse(row.request_headers) : null,
    responseHeaders: row.response_headers ? JSON.parse(row.response_headers) : null,
    error: row.error,
  };
}

// Registered before '/request-logs/:id' so the literal segment wins the match.
requestLogRoutes.get('/request-logs/by-req-id/:reqId', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const row = getRequestLogByReqId(db, c.req.param('reqId'));
    if (!row) throw new ApiError('not_found', 'request log not found', 404);
    return c.json(serializeLog(row));
  } catch (e) {
    return handleApiError(e);
  }
});

requestLogRoutes.get('/request-logs/:id', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const id = Number(c.req.param('id'));
    const row = getRequestLogById(db, id);
    if (!row) throw new ApiError('not_found', 'request log not found', 404);
    return c.json(serializeLog(row));
  } catch (e) {
    return handleApiError(e);
  }
});
