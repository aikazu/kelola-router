import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../index.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'maudit-')), 't.db');
});

describe('migration 007 — audit_log table', () => {
  it('creates the audit_log table on a fresh DB', () => {
    const db = openDb();
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'`)
      .get() as { name: string } | undefined;
    expect(row?.name).toBe('audit_log');
  });

  it('bumps user_version to 7', () => {
    const db = openDb();
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(7);
  });

  it('creates the event + key indexes', () => {
    const db = openDb();
    const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all() as {
      name: string;
    }[];
    const names = new Set(rows.map((r) => r.name));
    expect(names.has('idx_audit_log_event_created')).toBe(true);
    expect(names.has('idx_audit_log_key_created')).toBe(true);
  });

  it('accepts a row insert and survives client_key deletion (ON DELETE SET NULL)', () => {
    const db = openDb();
    db.prepare(
      `INSERT INTO client_keys (label, key, enabled, created_at) VALUES ('app', 'rk_x', 1, ?)`
    ).run(new Date().toISOString());
    const { id } = db.prepare(`SELECT id FROM client_keys WHERE label='app'`).get() as {
      id: number;
    };
    db.prepare(
      `INSERT INTO audit_log (event, client_key_id, ip, user_agent) VALUES (?, ?, ?, ?)`
    ).run('client_key.reveal', id, '203.0.113.7', 'curl/8');
    // Delete the referenced client_key → audit row must survive with NULL.
    db.prepare(`DELETE FROM client_keys WHERE id = ?`).run(id);
    const audit = db.prepare(`SELECT event, client_key_id, ip FROM audit_log`).get() as {
      event: string;
      client_key_id: number | null;
      ip: string;
    };
    expect(audit.event).toBe('client_key.reveal');
    expect(audit.client_key_id).toBeNull();
    expect(audit.ip).toBe('203.0.113.7');
  });
});
