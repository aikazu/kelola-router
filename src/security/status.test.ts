import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setPassword } from '../auth/password.js';
import { openDb } from '../db/index.js';
import { getSecurityStatus } from './status.js';

const origKey = process.env.ROUTER_DB_KEY;

afterEach(() => {
  // Restore env so tests don't bleed into each other.
  if (origKey === undefined) delete process.env.ROUTER_DB_KEY;
  else process.env.ROUTER_DB_KEY = origKey;
});

function freshDb() {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'sec-')), 't.db');
  return openDb();
}

describe('getSecurityStatus', () => {
  beforeEach(() => {
    delete process.env.ROUTER_DB_KEY;
  });

  it('open mode + unencrypted DB when no password and no ROUTER_DB_KEY', () => {
    const db = freshDb();
    const status = getSecurityStatus(db);
    expect(status).toEqual({ adminPasswordSet: false, dbEncrypted: false });
  });

  it('open mode + encrypted DB when ROUTER_DB_KEY is set but no password', () => {
    process.env.ROUTER_DB_KEY = 'a-real-key-from-env';
    const db = freshDb();
    const status = getSecurityStatus(db);
    expect(status).toEqual({ adminPasswordSet: false, dbEncrypted: true });
  });

  it('password set + unencrypted DB when password configured but no ROUTER_DB_KEY', () => {
    const db = freshDb();
    setPassword(db, 'a-real-password');
    const status = getSecurityStatus(db);
    expect(status).toEqual({ adminPasswordSet: true, dbEncrypted: false });
  });

  it('password set + encrypted DB when both password and ROUTER_DB_KEY configured', () => {
    process.env.ROUTER_DB_KEY = 'a-real-key-from-env';
    const db = freshDb();
    setPassword(db, 'a-real-password');
    const status = getSecurityStatus(db);
    expect(status).toEqual({ adminPasswordSet: true, dbEncrypted: true });
  });

  it('treats whitespace-only ROUTER_DB_KEY as unset (unencrypted)', () => {
    process.env.ROUTER_DB_KEY = '   ';
    const db = freshDb();
    const status = getSecurityStatus(db);
    expect(status.dbEncrypted).toBe(false);
  });

  it('accepts an explicit env override (does not read process.env directly)', () => {
    // process.env.ROUTER_DB_KEY is unset (beforeEach deletes it).
    const db = freshDb();
    const status = getSecurityStatus(db, { ROUTER_DB_KEY: 'injected' });
    expect(status.dbEncrypted).toBe(true);
  });
});
