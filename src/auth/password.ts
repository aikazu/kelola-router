import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { clearCacheForDb } from '../db/repos/settings.js';

/**
 * Password hashing using scrypt (Node built-in, no extra deps).
 * Format: "scrypt:N:saltHex:hashHex" where N = scrypt N cost param.
 */
const N = 16384; // scrypt cost
const KEYLEN = 64;
const SALT_BYTES = 16;

export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(plain, salt, KEYLEN, { N });
  return `scrypt:${N}:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  if (!Number.isInteger(n) || n < 1024) return false;
  const saltHex = parts[2];
  const hashHex = parts[3];
  if (!saltHex || !hashHex) return false;
  let salt: Buffer, expected: Buffer;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== KEYLEN) return false;
  let actual: Buffer;
  try {
    actual = scryptSync(plain, salt, expected.length, { N: n });
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function isPasswordSet(db: Database.Database): boolean {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'admin_password'`).get() as
    | { value: string }
    | undefined;
  if (!row) return false;
  try {
    const parsed = JSON.parse(row.value);
    return typeof parsed === 'string' && parsed.startsWith('scrypt:');
  } catch {
    return false;
  }
}

export function setPassword(db: Database.Database, plain: string): void {
  const hash = hashPassword(plain);
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('admin_password', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(JSON.stringify(hash));
  clearCacheForDb(db);
}
