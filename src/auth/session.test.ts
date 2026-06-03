import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/index.js';
import {
  cleanupExpiredSessions,
  createSession,
  destroySession,
  SESSION_TTL_MS,
  validateSession,
} from './session.js';

let db: ReturnType<typeof openDb>;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'sess-')), 't.db');
  db = openDb();
});

describe('session lifecycle', () => {
  it('create → validate returns session', () => {
    const s = createSession(db, { userAgent: 'ua', ip: '1.2.3.4' });
    expect(s.id).toMatch(/^sess_/);
    const v = validateSession(db, s.id);
    expect(v).toBeDefined();
    expect(v?.id).toBe(s.id);
  });

  it('validate returns undefined for unknown id', () => {
    expect(validateSession(db, 'sess_nope')).toBeUndefined();
  });

  it('destroy removes the session', () => {
    const s = createSession(db);
    expect(validateSession(db, s.id)).toBeDefined();
    destroySession(db, s.id);
    expect(validateSession(db, s.id)).toBeUndefined();
  });

  it('expired session is not validated', () => {
    const s = createSession(db);
    // Backdate expires_at to past
    db.prepare(`UPDATE sessions SET expires_at = ? WHERE id = ?`).run(
      new Date(Date.now() - 1000).toISOString(),
      s.id
    );
    expect(validateSession(db, s.id)).toBeUndefined();
  });

  it('validate bumps last_seen', async () => {
    const s = createSession(db);
    const first = db.prepare(`SELECT last_seen FROM sessions WHERE id = ?`).get(s.id) as {
      last_seen: string;
    };
    await new Promise((r) => setTimeout(r, 5));
    validateSession(db, s.id);
    const second = db.prepare(`SELECT last_seen FROM sessions WHERE id = ?`).get(s.id) as {
      last_seen: string;
    };
    expect(second.last_seen >= first.last_seen).toBe(true);
  });
});

describe('session expiry', () => {
  it('SESSION_TTL_MS is 7 days', () => {
    expect(SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('new session has expires_at ~7d in future', () => {
    const s = createSession(db);
    const exp = new Date(s.expires_at).getTime();
    const expected = Date.now() + SESSION_TTL_MS;
    expect(Math.abs(exp - expected)).toBeLessThan(5000);
  });
});

describe('cleanupExpiredSessions', () => {
  it('removes expired sessions and keeps fresh ones', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    db.prepare(
      `INSERT INTO sessions (id, user_agent, ip, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('sess_old', null, null, past, past, past);
    db.prepare(
      `INSERT INTO sessions (id, user_agent, ip, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('sess_new', null, null, future, future, future);
    const removed = cleanupExpiredSessions(db);
    expect(removed).toBe(1);
    expect(db.prepare(`SELECT id FROM sessions WHERE id = ?`).get('sess_old')).toBeUndefined();
    expect(db.prepare(`SELECT id FROM sessions WHERE id = ?`).get('sess_new')).toBeDefined();
  });
});
