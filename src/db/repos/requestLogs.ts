import type Database from 'better-sqlite3';

export interface RequestLog {
  id: number;
  client_key_id: number | null;
  account_id: string | null;
  model: string;
  requested_model: string | null;
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
  request_body: string | null;
  response_body: string | null;
  request_headers: string | null;
  response_headers: string | null;
  error: string | null;
}

export type RequestLogInsert = Omit<
  RequestLog,
  | 'id'
  | 'created_at'
  | 'ttft_ms'
  | 'base_resp_code'
  | 'relay_path'
  | 'proxy_path'
  | 'caveman_level'
  | 'error_message'
  | 'request_body'
  | 'response_body'
  | 'request_headers'
  | 'response_headers'
  | 'error'
  | 'requested_model'
> & {
  ttft_ms?: number | null;
  base_resp_code?: number | null;
  relay_path?: string | null;
  proxy_path?: string | null;
  caveman_level?: string | null;
  error_message?: string | null;
  request_body?: string | null;
  response_body?: string | null;
  request_headers?: string | null;
  response_headers?: string | null;
  error?: string | null;
  requested_model?: string | null;
};

export function insertRequestLog(db: Database.Database, log: RequestLogInsert): number {
  const info = db
    .prepare(`
    INSERT INTO request_logs (client_key_id, account_id, model, requested_model, endpoint, format, prompt_tokens, completion_tokens,
      cache_creation_tokens, cache_read_tokens, total_tokens, cost_usd, latency_ms, ttft_ms, status_code,
      base_resp_code, stream, relay_path, proxy_path, rtk_bytes_saved, caveman_level, error_message,
      request_body, response_body, request_headers, response_headers, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .run(
      log.client_key_id,
      log.account_id,
      log.model,
      log.requested_model ?? null,
      log.endpoint,
      log.format,
      log.prompt_tokens,
      log.completion_tokens,
      log.cache_creation_tokens,
      log.cache_read_tokens,
      log.total_tokens,
      log.cost_usd,
      log.latency_ms,
      log.ttft_ms ?? null,
      log.status_code,
      log.base_resp_code ?? null,
      log.stream ? 1 : 0,
      log.relay_path ?? null,
      log.proxy_path ?? null,
      log.rtk_bytes_saved,
      log.caveman_level ?? null,
      log.error_message ?? null,
      log.request_body ?? null,
      log.response_body ?? null,
      log.request_headers ?? null,
      log.response_headers ?? null,
      log.error ?? null
    );
  return info.lastInsertRowid as number;
}

const pending = new Set<Promise<void>>();

/**
 * Queue a request-log insert to run after the current task, off the response
 * critical path. The row is still written in full. Tests await flushDeferredLogs().
 */
export function insertRequestLogDeferred(db: Database.Database, log: RequestLogInsert): void {
  const p = new Promise<void>((resolve) => {
    queueMicrotask(() => {
      try {
        insertRequestLog(db, log);
      } catch {
        /* logging must never break the proxy */
      }
      resolve();
    });
  });
  pending.add(p);
  void p.then(() => pending.delete(p));
}

/** Await all queued deferred inserts (test determinism / graceful shutdown). */
export async function flushDeferredLogs(): Promise<void> {
  await Promise.all([...pending]);
}

export function getRequestLogById(db: Database.Database, id: number): RequestLog | null {
  const row = db.prepare('SELECT * FROM request_logs WHERE id = ?').get(id) as
    | RequestLog
    | undefined;
  return row ?? null;
}

export interface LogFilter {
  clientKeyId?: number;
  limit?: number;
}

export function recentLogs(db: Database.Database, filter: LogFilter = {}): RequestLog[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.clientKeyId !== undefined) {
    where.push('client_key_id = ?');
    params.push(filter.clientKeyId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(filter.limit ?? 100);
  return db
    .prepare(`SELECT * FROM request_logs ${whereSql} ORDER BY created_at DESC LIMIT ?`)
    .all(...params) as RequestLog[];
}

export interface PagedLogFilter {
  clientKeyId?: number;
  model?: string;
  statusCode?: number;
  search?: string;
  fromIso?: string;
  toIso?: string;
  page: number;
  pageSize: number;
  sortBy?: 'created_at' | 'cost_usd' | 'latency_ms' | 'total_tokens' | 'status_code';
  sortDir?: 'asc' | 'desc';
}

export interface PagedLogs {
  rows: RequestLog[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const SORTABLE = new Set(['created_at', 'cost_usd', 'latency_ms', 'total_tokens', 'status_code']);

export function pagedLogs(db: Database.Database, filter: PagedLogFilter): PagedLogs {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.clientKeyId !== undefined) {
    where.push('client_key_id = ?');
    params.push(filter.clientKeyId);
  }
  if (filter.model) {
    where.push('model = ?');
    params.push(filter.model);
  }
  if (filter.statusCode !== undefined) {
    where.push('status_code = ?');
    params.push(filter.statusCode);
  }
  if (filter.fromIso) {
    where.push('created_at >= ?');
    params.push(filter.fromIso);
  }
  if (filter.toIso) {
    where.push('created_at <= ?');
    params.push(filter.toIso);
  }
  if (filter.search) {
    where.push('(model LIKE ? OR error LIKE ? OR CAST(id AS TEXT) LIKE ?)');
    const term = `%${filter.search}%`;
    params.push(term, term, term);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortBy = SORTABLE.has(filter.sortBy ?? '') ? filter.sortBy! : 'created_at';
  const sortDir = filter.sortDir === 'asc' ? 'ASC' : 'DESC';
  const total = (
    db.prepare(`SELECT COUNT(*) as n FROM request_logs ${whereSql}`).get(...params) as { n: number }
  ).n;
  const offset = (filter.page - 1) * filter.pageSize;
  const rows = db
    .prepare(
      `SELECT * FROM request_logs ${whereSql} ORDER BY ${sortBy} ${sortDir} LIMIT ? OFFSET ?`
    )
    .all(...params, filter.pageSize, offset) as RequestLog[];
  return {
    rows,
    total,
    page: filter.page,
    pageSize: filter.pageSize,
    totalPages: Math.max(1, Math.ceil(total / filter.pageSize)),
  };
}

export interface UsageAggregate {
  total_cost: number;
  total_requests: number;
  total_tokens: number;
  by_model: { model: string; cost: number; requests: number }[];
}

export function aggregateUsage(
  db: Database.Database,
  filter: { clientKeyId?: number; days: number }
): UsageAggregate {
  const since = new Date(Date.now() - filter.days * 86_400_000).toISOString();
  const where: string[] = ['created_at > ?'];
  const params: (string | number)[] = [since];
  if (filter.clientKeyId !== undefined) {
    where.push('client_key_id = ?');
    params.push(filter.clientKeyId);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = db
    .prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as cost, COUNT(*) as reqs, COALESCE(SUM(total_tokens), 0) as toks
    FROM request_logs ${whereSql}
  `)
    .get(...params) as { cost: number; reqs: number; toks: number };
  const byModel = db
    .prepare(`
    SELECT model, SUM(cost_usd) as cost, COUNT(*) as requests
    FROM request_logs ${whereSql}
    GROUP BY model ORDER BY cost DESC
  `)
    .all(...params) as { model: string; cost: number; requests: number }[];
  return {
    total_cost: total.cost,
    total_requests: total.reqs,
    total_tokens: total.toks,
    by_model: byModel,
  };
}

export function cleanupOldLogs(db: Database.Database, days: number): number {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const info = db.prepare(`DELETE FROM request_logs WHERE created_at < ?`).run(cutoff);
  return info.changes;
}
