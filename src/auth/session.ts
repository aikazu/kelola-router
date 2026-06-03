import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface Session {
  id: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  expires_at: string;
  last_seen: string;
}

const ISO = (d: Date) => d.toISOString();
const SQL_ISO = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

export function createSession(
  db: Database.Database,
  meta: { userAgent?: string; ip?: string } = {}
): Session {
  const id = `sess_${randomBytes(20).toString('base64url')}`;
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  const nowIso = ISO(now);
  db.prepare(`
    INSERT INTO sessions (id, user_agent, ip, created_at, expires_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, meta.userAgent ?? null, meta.ip ?? null, nowIso, ISO(expires), nowIso);
  return {
    id,
    user_agent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
    created_at: nowIso,
    expires_at: ISO(expires),
    last_seen: nowIso,
  };
}

export function validateSession(db: Database.Database, id: string): Session | undefined {
  if (!id || !id.startsWith('sess_')) return undefined;
  const row = db
    .prepare(`
    SELECT id, user_agent, ip, created_at, expires_at, last_seen FROM sessions WHERE id = ?
  `)
    .get(id) as Session | undefined;
  if (!row) return undefined;
  if (new Date(row.expires_at).getTime() <= Date.now()) return undefined;
  db.prepare(`UPDATE sessions SET last_seen = ${SQL_ISO} WHERE id = ?`).run(id);
  return row;
}

export function destroySession(db: Database.Database, id: string): void {
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
}

export function destroyAllSessions(db: Database.Database): void {
  db.prepare(`DELETE FROM sessions`).run();
}

export function cleanupExpiredSessions(db: Database.Database): number {
  const r = db.prepare(`DELETE FROM sessions WHERE expires_at < ${SQL_ISO}`).run();
  return r.changes;
}
