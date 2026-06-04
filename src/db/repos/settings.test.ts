import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../index.js';
import { getSetting, setSetting } from './settings.js';

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
