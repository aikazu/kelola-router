import type Database from 'better-sqlite3';
import type { Statement } from 'better-sqlite3';

/**
 * Audit log row. An audit event is a security-relevant admin action
 * (e.g. a raw client_key reveal). Never stores the secret value itself —
 * only metadata: what happened, which entity, from where, when.
 */
export interface AuditLogRow {
  id: number;
  event: string;
  client_key_id: number | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AuditEventInsert {
  /** Stable event name, e.g. `client_key.reveal`. */
  event: string;
  /** Optional: the affected client_key. Null for non-key events. */
  clientKeyId?: number | null;
  /** Caller IP (left-most x-forwarded-for, or 'unknown'). */
  ip?: string | null;
  /** Caller User-Agent, if provided. */
  userAgent?: string | null;
}

const stmtCache = new WeakMap<Database.Database, Statement>();

function getInsertStmt(db: Database.Database): Statement {
  let s = stmtCache.get(db);
  if (!s) {
    s = db.prepare(`
      INSERT INTO audit_log (event, client_key_id, ip, user_agent)
      VALUES (?, ?, ?, ?)
    `);
    stmtCache.set(db, s);
  }
  return s;
}

/**
 * Insert an audit event. Returns the new row id, or `null` if the insert
 * failed (callers that have already decided to tolerate audit failure —
 * e.g. the key-reveal handler — can ignore the return value).
 */
export function insertAuditEvent(db: Database.Database, evt: AuditEventInsert): number | null {
  const info = getInsertStmt(db).run(
    evt.event,
    evt.clientKeyId ?? null,
    evt.ip ?? null,
    evt.userAgent ?? null
  );
  return info.lastInsertRowid as number;
}

/** List audit events, newest first. Optional filter by event name or client_key. */
export function listAuditEvents(
  db: Database.Database,
  filter: { event?: string; clientKeyId?: number; limit?: number } = {}
): AuditLogRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.event) {
    where.push('event = ?');
    params.push(filter.event);
  }
  if (filter.clientKeyId !== undefined) {
    where.push('client_key_id = ?');
    params.push(filter.clientKeyId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(filter.limit ?? 100);
  return db
    .prepare(`SELECT * FROM audit_log ${whereSql} ORDER BY id DESC LIMIT ?`)
    .all(...params) as AuditLogRow[];
}
