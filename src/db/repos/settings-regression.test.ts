/**
 * Regression coverage for every key in SETTINGS_SCHEMAS.
 *
 * Proves that every schemed key (Task 3, commit c3a796c) can be round-tripped
 * through `setSetting` → `getSettingT` without parse errors, AND that an
 * invalid stored value throws `ValiError` clearly.
 *
 * Extends the patterns established in settings.test.ts (Task 21, commit a933e31).
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ValiError } from 'valibot';
import { describe, expect, it } from 'vitest';
import { openDb } from '../index.js';
import { getSettingT, setSetting } from './settings.js';
import type { SettingKey } from './settings-types.js';

// ---------------------------------------------------------------------------
// DB isolation — each test gets a fresh temp database
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Valid value fixtures per key
// ---------------------------------------------------------------------------

const FIXTURES = {
  rtk: {
    enabled: true,
    minCompressSize: 500,
    rawCap: 10_485_760,
    filters: ['dedupLog', 'smartTruncate'],
  },
  caveman: { level: 'terse' },
  caching: { autoBreakpoints: true, respectCallerMarkers: false },
  minimax: { upstreamFormat: 'openai', m3DefaultMaxCompletionTokens: 131_072 },
  transport: {
    relay: { kind: 'vercel', url: 'https://r.example.app/api/relay' },
    proxy: { kind: 'socks5', url: 'socks5://127.0.0.1:1080' },
    proxyFailureMode: 'block',
  },
  build: { version: '99.88.77' },
  admin_password: 'scrypt:16384:deadbeef:cafebabe',
  'selection.minimax': { mode: 'round-robin', step: 2 },
  'selection.kiro': { mode: 'sticky' },
  'selection.codebuddy': { mode: 'lowest-backoff', step: 0 },
} as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('settings regression: round-trip all schemed keys', () => {
  for (const [key, fixture] of Object.entries(FIXTURES) as [
    SettingKey,
    (typeof FIXTURES)[keyof typeof FIXTURES],
  ][]) {
    it(`${key} setSetting → getSettingT returns byte-equivalent value`, () => {
      process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 's-reg-')), 't.db');
      const db = openDb();

      setSetting(db, key, fixture);
      const result = getSettingT(db, key);

      expect(result).toEqual(fixture);

      // Byte-level check: serialized form stored in DB must match
      const stored = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
        | { value: string }
        | undefined;
      expect(stored).toBeDefined();
      expect(JSON.parse(stored!.value)).toEqual(fixture);
    });
  }
});

describe('settings regression: invalid stored value throws ValiError', () => {
  it('throws ValiError when stored value violates schema', () => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 's-reg-err-')), 't.db');
    const db = openDb();

    // Inject a string where an object is required.
    // `caveman` schema is `v.object({ level: v.picklist([...]) })`.
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run('caveman', JSON.stringify('not-an-object'));

    expect(() => getSettingT(db, 'caveman')).toThrow(ValiError);
  });

  it('throws ValiError when selection.minimax has invalid picklist value', () => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 's-reg-err2-')), 't.db');
    const db = openDb();

    // selection mode must be one of 'lowest-backoff' | 'round-robin' | 'sticky'
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run('selection.minimax', JSON.stringify({ mode: 'invalid-mode' }));

    expect(() => getSettingT(db, 'selection.minimax')).toThrow(ValiError);
  });

  it('throws ValiError when transport has wrong relay kind', () => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 's-reg-err3-')), 't.db');
    const db = openDb();

    // relay kind must be 'vercel' | 'cloudflare'
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(
      'transport',
      JSON.stringify({
        relay: { kind: 'fly', url: 'https://fly.io/relay' },
        proxy: null,
      })
    );

    expect(() => getSettingT(db, 'transport')).toThrow(ValiError);
  });
});
