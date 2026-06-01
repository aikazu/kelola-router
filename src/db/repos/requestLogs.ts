import type Database from "better-sqlite3";

export interface RequestLog {
  id: number;
  client_key_id: number | null;
  account_id: string | null;
  model: string;
  endpoint: string;
  format: string;
  prompt_tokens: number;
  completion_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  cost_usd: number;
  latency_ms: number;
  ttft_ms: number | null;
  status_code: number;
  base_resp_code: number | null;
  stream: number;
  relay_path: string | null;
  proxy_path: string | null;
  rtk_bytes_saved: number;
  caveman_level: string | null;
  error_message: string | null;
  created_at: string;
}

export type RequestLogInsert = Omit<RequestLog, "id" | "created_at" | "ttft_ms" | "base_resp_code" | "relay_path" | "proxy_path" | "caveman_level" | "error_message"> & {
  ttft_ms?: number | null;
  base_resp_code?: number | null;
  relay_path?: string | null;
  proxy_path?: string | null;
  caveman_level?: string | null;
  error_message?: string | null;
};

export function insertRequestLog(db: Database.Database, log: RequestLogInsert): number {
  const info = db.prepare(`
    INSERT INTO request_logs (client_key_id, account_id, model, endpoint, format, prompt_tokens, completion_tokens,
      cache_creation_tokens, cache_read_tokens, total_tokens, cost_usd, latency_ms, ttft_ms, status_code,
      base_resp_code, stream, relay_path, proxy_path, rtk_bytes_saved, caveman_level, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    log.client_key_id, log.account_id, log.model, log.endpoint, log.format,
    log.prompt_tokens, log.completion_tokens, log.cache_creation_tokens, log.cache_read_tokens, log.total_tokens,
    log.cost_usd, log.latency_ms, log.ttft_ms ?? null, log.status_code, log.base_resp_code ?? null,
    log.stream ? 1 : 0, log.relay_path ?? null, log.proxy_path ?? null, log.rtk_bytes_saved,
    log.caveman_level ?? null, log.error_message ?? null,
  );
  return info.lastInsertRowid as number;
}

export interface LogFilter {
  clientKeyId?: number;
  limit?: number;
}

export function recentLogs(db: Database.Database, filter: LogFilter = {}): RequestLog[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.clientKeyId !== undefined) {
    where.push("client_key_id = ?");
    params.push(filter.clientKeyId);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  params.push(filter.limit ?? 100);
  return db.prepare(`SELECT * FROM request_logs ${whereSql} ORDER BY created_at DESC LIMIT ?`)
    .all(...params) as RequestLog[];
}

export interface UsageAggregate {
  total_cost: number;
  total_requests: number;
  total_tokens: number;
  by_model: { model: string; cost: number; requests: number }[];
}

export function aggregateUsage(db: Database.Database, filter: { clientKeyId?: number; days: number }): UsageAggregate {
  const since = new Date(Date.now() - filter.days * 86_400_000).toISOString();
  const where: string[] = ["created_at > ?"];
  const params: (string | number)[] = [since];
  if (filter.clientKeyId !== undefined) {
    where.push("client_key_id = ?");
    params.push(filter.clientKeyId);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const total = db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as cost, COUNT(*) as reqs, COALESCE(SUM(total_tokens), 0) as toks
    FROM request_logs ${whereSql}
  `).get(...params) as { cost: number; reqs: number; toks: number };
  const byModel = db.prepare(`
    SELECT model, SUM(cost_usd) as cost, COUNT(*) as requests
    FROM request_logs ${whereSql}
    GROUP BY model ORDER BY cost DESC
  `).all(...params) as { model: string; cost: number; requests: number }[];
  return { total_cost: total.cost, total_requests: total.reqs, total_tokens: total.toks, by_model: byModel };
}

export function cleanupOldLogs(db: Database.Database, days: number): number {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const info = db.prepare(`DELETE FROM request_logs WHERE created_at < ?`).run(cutoff);
  return info.changes;
}
