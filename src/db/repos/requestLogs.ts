import type Database from 'better-sqlite3';
import type { Statement } from 'better-sqlite3';
import { log } from '../../util/log.js';
import { bumpAdminCacheVersion } from '../hooks.js';

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
  req_id: string | null;
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
  | 'req_id'
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
  req_id?: string | null;
};

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_BATCH_MS = 50;
const DEFAULT_MAX_PENDING_PER_DB = 1000;

const deferredLogQueueConfig = {
  batchSize: DEFAULT_BATCH_SIZE,
  batchMs: DEFAULT_BATCH_MS,
  maxPendingPerDb: DEFAULT_MAX_PENDING_PER_DB,
};

export function configureDeferredLogQueueForTests(config: {
  batchSize?: number;
  batchMs?: number;
  maxPendingPerDb?: number;
}): void {
  deferredLogQueueConfig.batchSize = config.batchSize ?? deferredLogQueueConfig.batchSize;
  deferredLogQueueConfig.batchMs = config.batchMs ?? deferredLogQueueConfig.batchMs;
  deferredLogQueueConfig.maxPendingPerDb =
    config.maxPendingPerDb ?? deferredLogQueueConfig.maxPendingPerDb;
}

export function resetDeferredLogQueueConfigForTests(): void {
  deferredLogQueueConfig.batchSize = DEFAULT_BATCH_SIZE;
  deferredLogQueueConfig.batchMs = DEFAULT_BATCH_MS;
  deferredLogQueueConfig.maxPendingPerDb = DEFAULT_MAX_PENDING_PER_DB;
}

const stmtCache = new WeakMap<Database.Database, Statement>();
function getInsertStmt(db: Database.Database): Statement {
  let s = stmtCache.get(db);
  if (!s) {
    s = db.prepare(`
      INSERT INTO request_logs (
        client_key_id, account_id, model, requested_model, endpoint, format,
        prompt_tokens, completion_tokens, cache_creation_tokens, cache_read_tokens,
        total_tokens, cost_usd, latency_ms, ttft_ms, status_code, base_resp_code,
        stream, relay_path, proxy_path, rtk_bytes_saved, caveman_level, error_message,
        request_body, response_body, request_headers, response_headers, error, req_id
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    stmtCache.set(db, s);
  }
  return s;
}

export function insertRequestLog(db: Database.Database, entry: RequestLogInsert): number {
  const info = getInsertStmt(db).run(
    entry.client_key_id,
    entry.account_id,
    entry.model,
    entry.requested_model ?? null,
    entry.endpoint,
    entry.format,
    entry.prompt_tokens,
    entry.completion_tokens,
    entry.cache_creation_tokens,
    entry.cache_read_tokens,
    entry.total_tokens,
    entry.cost_usd,
    entry.latency_ms,
    entry.ttft_ms ?? null,
    entry.status_code,
    entry.base_resp_code ?? null,
    entry.stream ? 1 : 0,
    entry.relay_path ?? null,
    entry.proxy_path ?? null,
    entry.rtk_bytes_saved,
    entry.caveman_level ?? null,
    entry.error_message ?? null,
    entry.request_body ?? null,
    entry.response_body ?? null,
    entry.request_headers ?? null,
    entry.response_headers ?? null,
    entry.error ?? null,
    entry.req_id ?? null
  );
  return info.lastInsertRowid as number;
}

const pending = new Map<Database.Database, RequestLogInsert[]>();
const timers = new WeakMap<Database.Database, NodeJS.Timeout>();
const dropped = new WeakMap<Database.Database, number>();
const pendingPromises = new Set<Promise<void>>();

export interface DeferredLogQueueStats {
  pending: number;
  dropped: number;
}

export function getDeferredLogQueueStats(db: Database.Database): DeferredLogQueueStats {
  return {
    pending: pending.get(db)?.length ?? 0,
    dropped: dropped.get(db) ?? 0,
  };
}

function enqueueFlush(db: Database.Database): void {
  if (timers.has(db)) return;
  const t = setTimeout(() => flushDb(db), deferredLogQueueConfig.batchMs);
  if (t.unref) t.unref();
  timers.set(db, t);
}

function flushDb(db: Database.Database): void {
  const batch = pending.get(db);
  timers.delete(db);
  if (!batch || batch.length === 0) return;
  pending.delete(db);
  const p = new Promise<void>((resolve) => {
    try {
      const tx = db.transaction((rows: RequestLogInsert[]) => {
        const stmt = getInsertStmt(db);
        for (const r of rows)
          stmt.run(
            r.client_key_id,
            r.account_id,
            r.model,
            r.requested_model ?? null,
            r.endpoint,
            r.format,
            r.prompt_tokens,
            r.completion_tokens,
            r.cache_creation_tokens,
            r.cache_read_tokens,
            r.total_tokens,
            r.cost_usd,
            r.latency_ms,
            r.ttft_ms ?? null,
            r.status_code,
            r.base_resp_code ?? null,
            r.stream ? 1 : 0,
            r.relay_path ?? null,
            r.proxy_path ?? null,
            r.rtk_bytes_saved,
            r.caveman_level ?? null,
            r.error_message ?? null,
            r.request_body ?? null,
            r.response_body ?? null,
            r.request_headers ?? null,
            r.response_headers ?? null,
            r.error ?? null,
            r.req_id ?? null
          );
      });
      tx(batch);
      bumpAdminCacheVersion();
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'batched request-log insert failed');
    }
    resolve();
  });
  pendingPromises.add(p);
  void p.then(() => pendingPromises.delete(p));
}

/**
 * Queue a request-log insert to run after the current task, off the response
 * critical path. Inserts are batched (50ms window or 50 entries, whichever
 * first) so a single fsync amortizes many rows. Tests await flushDeferredLogs().
 */
export function insertRequestLogDeferred(db: Database.Database, entry: RequestLogInsert): void {
  let queue = pending.get(db);
  if (!queue) {
    queue = [];
    pending.set(db, queue);
  }
  if (queue.length >= deferredLogQueueConfig.maxPendingPerDb) {
    queue.shift();
    dropped.set(db, (dropped.get(db) ?? 0) + 1);
  }
  queue.push(entry);
  if (queue.length >= deferredLogQueueConfig.batchSize) {
    const t = timers.get(db);
    if (t) {
      clearTimeout(t);
      timers.delete(db);
    }
    flushDb(db);
  } else {
    enqueueFlush(db);
  }
}

/** Await all queued deferred inserts (test determinism / graceful shutdown). */
export async function flushDeferredLogs(): Promise<void> {
  for (const db of pending.keys()) flushDb(db);
  await Promise.all([...pendingPromises]);
}

export function getRequestLogById(db: Database.Database, id: number): RequestLog | null {
  const row = db.prepare('SELECT * FROM request_logs WHERE id = ?').get(id) as
    | RequestLog
    | undefined;
  return row ?? null;
}

/** Look up the most recent request log for a console flow req_id. */
export function getRequestLogByReqId(db: Database.Database, reqId: string): RequestLog | null {
  const row = db
    .prepare('SELECT * FROM request_logs WHERE req_id = ? ORDER BY id DESC LIMIT 1')
    .get(reqId) as RequestLog | undefined;
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
  accountId?: string;
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
  if (filter.accountId) {
    where.push('account_id = ?');
    params.push(filter.accountId);
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
  filter: {
    clientKeyId?: number;
    accountId?: string;
    model?: string;
    statusCode?: number;
    search?: string;
    fromIso?: string;
    toIso?: string;
    days: number;
  }
): UsageAggregate {
  const where: string[] = [];
  const params: (string | number)[] = [];
  // days <= 0 means all-time: skip the time-window clause entirely.
  if (filter.days > 0) {
    where.push('created_at > ?');
    params.push(new Date(Date.now() - filter.days * 86_400_000).toISOString());
  }
  if (filter.clientKeyId !== undefined) {
    where.push('client_key_id = ?');
    params.push(filter.clientKeyId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
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
