import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../index.js';
import { getSetting, getSettingT, setSetting } from './settings.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 's-')), 't.db');
});

describe('settings repo', () => {
  it('getSetting returns null for missing key', () => {
    const db = openDb();
    expect(getSetting(db, 'nope')).toBeNull();
  });

  it('setSetting + getSetting roundtrip', () => {
    const db = openDb();
    setSetting(db, 'caveman', { level: 'terse' });
    expect(getSetting(db, 'caveman')).toEqual({ level: 'terse' });
  });

  it('setSetting overwrites existing', () => {
    const db = openDb();
    setSetting(db, 'caveman', { level: 'terse' });
    setSetting(db, 'caveman', { level: 'ultra' });
    expect(getSetting(db, 'caveman')).toEqual({ level: 'ultra' });
  });

  it('cache returns fresh value within 1s', () => {
    const db = openDb();
    setSetting(db, 'caveman', { level: 'off' });
    expect(getSetting(db, 'caveman')).toEqual({ level: 'off' });
    setSetting(db, 'caveman', { level: 'terse' });
    expect(getSetting(db, 'caveman')).toEqual({ level: 'terse' });
  });
});

describe('getSettingT (typed wrapper)', () => {
  it('returns null for a missing row', () => {
    const db = openDb();
    // All known SettingKeys are seeded by migration 001, so delete one to
    // exercise the no-row branch. (A user could also drop rows manually or
    // deploy with a stripped seed.)
    db.prepare(`DELETE FROM settings WHERE key = ?`).run('caveman');
    const value = getSettingT(db, 'caveman');
    expect(value).toBeNull();
  });

  it('parses caveman (object schema) into typed CavemanSettings', () => {
    const db = openDb();
    setSetting(db, 'caveman', { level: 'terse' });
    const value = getSettingT(db, 'caveman');
    expect(value).toEqual({ level: 'terse' });
    // Compile-time narrowing: value.level is the picklist union.
    if (value !== null) {
      expect(['off', 'terse', 'ultra']).toContain(value.level);
    }
  });

  it('parses admin_password (nullable string schema)', () => {
    const db = openDb();
    setSetting(db, 'admin_password', 'scrypt:16384:deadbeef:cafebabe');
    const value = getSettingT(db, 'admin_password');
    expect(value).toBe('scrypt:16384:deadbeef:cafebabe');

    setSetting(db, 'admin_password', null);
    const cleared = getSettingT(db, 'admin_password');
    expect(cleared).toBeNull();
  });

  it('parses selection.minimax (object with required mode + optional step)', () => {
    const db = openDb();
    setSetting(db, 'selection.minimax', { mode: 'round-robin', step: 3 });
    const value = getSettingT(db, 'selection.minimax');
    expect(value).toEqual({ mode: 'round-robin', step: 3 });
  });

  it('parses transport (nested nullable relay/proxy)', () => {
    const db = openDb();
    setSetting(db, 'transport', {
      relay: { kind: 'vercel', url: 'https://r.example.app/api/relay' },
      proxy: null,
      proxyFailureMode: 'direct',
    });
    const value = getSettingT(db, 'transport');
    expect(value?.relay?.kind).toBe('vercel');
    expect(value?.proxy).toBeNull();
    expect(value?.proxyFailureMode).toBe('direct');
  });

  it('throws ValiError when stored value does not match the schema (loud parse)', () => {
    const db = openDb();
    // Bypass setSetting (which would JSON.stringify fine) — overwrite the row
    // with a raw invalid shape. caveman schema requires {level: ...}; a bare
    // string fails the parse.
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run('caveman', JSON.stringify('not-an-object'));
    expect(() => getSettingT(db, 'caveman')).toThrow();
  });
});
