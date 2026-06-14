import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from './index.js';

let tmp: string;
let prevPath: string | undefined;
let prevKey: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'router-test-'));
  prevPath = process.env.ROUTER_DB_PATH;
  prevKey = process.env.ROUTER_DB_KEY;
  process.env.ROUTER_DB_PATH = join(tmp, 'test.db');
});

afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* Windows may hold a transient lock on the WAL file; temp dir is auto-cleaned */
  }
  if (prevPath === undefined) delete process.env.ROUTER_DB_PATH;
  else process.env.ROUTER_DB_PATH = prevPath;
  if (prevKey === undefined) delete process.env.ROUTER_DB_KEY;
  else process.env.ROUTER_DB_KEY = prevKey;
});

/** Plain SQLite files always start with this 16-byte magic. Encrypted files don't. */
const SQLITE_MAGIC = 'SQLite format 3\0';

function readFileHeader(path: string): string {
  if (!existsSync(path)) return '';
  const buf = readFileSync(path, { encoding: null });
  return buf.subarray(0, 16).toString('latin1');
}

describe('openDb', () => {
  it('creates expected tables after all migrations', () => {
    const db = openDb();
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('accounts');
    expect(names).toContain('account_model_locks');
    expect(names).toContain('client_keys');
    expect(names).toContain('request_logs');
    expect(names).toContain('quota_snapshots');
    expect(names).toContain('models');
    expect(names).toContain('settings');
  });

  it('seeds default settings rows', () => {
    const db = openDb();
    const rows = db.prepare(`SELECT key FROM settings ORDER BY key`).all() as { key: string }[];
    const keys = rows.map((r) => r.key);
    expect(keys).toContain('rtk');
    expect(keys).toContain('caveman');
    expect(keys).toContain('caching');
    expect(keys).toContain('transport');
    expect(keys).toContain('build');
  });

  it('seeds 9 default MiniMax models (no -thinking variants)', () => {
    const db = openDb();
    const rows = db.prepare(`SELECT name FROM models ORDER BY name`).all() as { name: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toContain('MiniMax-M3');
    expect(names).toContain('MiniMax-M2.7');
    expect(names).toContain('MiniMax-M2.7-highspeed');
    expect(names).toContain('MiniMax-M2.5');
    expect(names).toContain('MiniMax-M2.5-highspeed');
    expect(names).toContain('MiniMax-M2.1');
    expect(names).toContain('MiniMax-M2.1-highspeed');
    expect(names).toContain('MiniMax-M2');
    expect(names).toContain('MiniMax-M2-her');
    expect(names).not.toContain('MiniMax-M3-thinking');
    expect(names).not.toContain('MiniMax-M2.7-thinking');
    expect(rows.length).toBe(9);
  });
});

describe('openDb — SQLCipher encryption via ROUTER_DB_KEY', () => {
  it('produces a plain SQLite file when ROUTER_DB_KEY is unset', () => {
    const db = openDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('probe', ?)").run('plain');
    db.close();
    expect(readFileHeader(process.env.ROUTER_DB_PATH as string)).toBe(SQLITE_MAGIC);
  });

  it('encrypts the DB file when ROUTER_DB_KEY is set (header is NOT SQLite magic)', () => {
    process.env.ROUTER_DB_KEY = 'correct-horse-battery-staple';
    const db = openDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('probe', ?)").run('ciphered');
    db.close();
    const header = readFileHeader(process.env.ROUTER_DB_PATH as string);
    expect(header).not.toBe(SQLITE_MAGIC);
    expect(header.length).toBe(16);
  });

  it('round-trips data with the same key (write → close → reopen → read)', () => {
    process.env.ROUTER_DB_KEY = 'keyA';
    const w = openDb();
    w.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('rt', ?)").run('roundtrip-ok');
    w.close();

    const r = openDb();
    const row = r.prepare("SELECT value FROM settings WHERE key = 'rt'").get() as { value: string };
    r.close();
    expect(row.value).toBe('roundtrip-ok');
  });

  it('rejects a wrong key (write with keyA → reopen with keyB → throws)', () => {
    process.env.ROUTER_DB_KEY = 'keyA';
    const w = openDb();
    w.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('secret', ?)").run('hidden');
    w.close();

    process.env.ROUTER_DB_KEY = 'keyB';
    // Wrong key surfaces as SQLITE_NOTADB when the first PRAGMA or query runs.
    expect(() => openDb()).toThrow();
  });

  it('survives full schema migration under encryption (tables present)', () => {
    process.env.ROUTER_DB_KEY = 'migration-key';
    const db = openDb();
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('accounts');
    expect(names).toContain('client_keys');
    expect(names).toContain('settings');
    db.close();
  });
});
