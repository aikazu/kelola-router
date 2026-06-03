import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db/index.js';
import { hashPassword, isPasswordSet, verifyPassword } from './password.js';

describe('hashPassword / verifyPassword', () => {
  it('hashes + verifies a password', () => {
    const h = hashPassword('hunter2');
    expect(h).toMatch(/^scrypt:/);
    expect(verifyPassword('hunter2', h)).toBe(true);
    expect(verifyPassword('wrong', h)).toBe(false);
  });

  it('produces different hashes for the same password (salt)', () => {
    const a = hashPassword('same');
    const b = hashPassword('same');
    expect(a).not.toBe(b);
    expect(verifyPassword('same', a)).toBe(true);
    expect(verifyPassword('same', b)).toBe(true);
  });

  it('rejects malformed hash', () => {
    expect(verifyPassword('any', 'not-a-hash')).toBe(false);
    expect(verifyPassword('any', 'scrypt:bad')).toBe(false);
  });
});

describe('isPasswordSet', () => {
  it('returns false when no settings row', () => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'pwd-')), 't.db');
    const db = openDb();
    expect(isPasswordSet(db)).toBe(false);
  });

  it('returns true when password hash stored', () => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'pwd-')), 't.db');
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('admin_password', ?)`).run(
      JSON.stringify(hashPassword('x'))
    );
    expect(isPasswordSet(db)).toBe(true);
  });
});
