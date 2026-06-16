import type Database from 'better-sqlite3';
import * as v from 'valibot';
import { SETTINGS_SCHEMAS, type SettingKey, type SettingsMap } from './settings.types.js';

const DEFAULT_TTL_MS = 1000;
const TTL_OVERRIDES: Record<string, number> = {
  // Global transport changes rarely; bump TTL to reduce hot-path DB reads
  // for accounts that fall back to the global proxy/relay.
  transport: 5000,
};
function ttlFor(key: string): number {
  return TTL_OVERRIDES[key] ?? DEFAULT_TTL_MS;
}
const caches = new WeakMap<Database.Database, Map<string, { value: unknown; expiry: number }>>();

function getCache(db: Database.Database): Map<string, { value: unknown; expiry: number }> {
  let c = caches.get(db);
  if (!c) {
    c = new Map();
    caches.set(db, c);
  }
  return c;
}

export function clearCache(): void {
  // No-op: cache is now per-db via WeakMap. Kept for backward compat with
  // existing test suites that call it. New code should use a fresh db handle
  // for a clean cache (matches AGENTS.md test pattern).
}

export function clearCacheForDb(db: Database.Database): void {
  caches.delete(db);
}

export function getSetting<T = unknown>(db: Database.Database, key: string): T | null {
  const c = getCache(db);
  const cached = c.get(key);
  if (cached && cached.expiry > Date.now()) return cached.value as T;

  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  if (!row) return null;

  const value = JSON.parse(row.value);
  c.set(key, { value, expiry: Date.now() + ttlFor(key) });
  return value as T;
}

/**
 * Typed settings getter — the H4 (Task 21) replacement for the untyped
 * `getSetting<T>(db, 'key') as ...` pattern.
 *
 * Reads the row via the existing `getSetting` (preserving the per-db 1s cache,
 * 5s for `transport`), then runs the value through the Valibot schema declared
 * for `key` in `SETTINGS_SCHEMAS`. The schema is keyed by the literal `K`, so
 * TypeScript narrows the return to `SettingsMap[K] | null` — no casts needed
 * at call sites.
 *
 * Parse strategy: **`v.parse` (loud)**. Stored settings are written by our own
 * seed / dashboard code against the same schemas, so a parse failure is a
 * programming error (schema drift, manual DB tampering) — we'd rather crash
 * the request loudly than silently return `null` and mask the bug. Callers
 * that want graceful degradation can wrap in try/catch and log.
 *
 * The existing `getSetting` is kept as-is so Tasks 22-25 can migrate call sites
 * one at a time without a flag day. Once all call sites are migrated, the
 * untyped helper can be removed.
 *
 * Migration path (Tasks 22-25):
 *   // before
 *   const caveman = getSetting<CavemanSettings>(db, 'caveman') ?? { level: 'off' };
 *   // after
 *   const caveman = getSettingT(db, 'caveman') ?? { level: 'off' };
 */
export function getSettingT<K extends SettingKey>(
  db: Database.Database,
  key: K
): SettingsMap[K] | null {
  const raw = getSetting<unknown>(db, key);
  if (raw === null) return null;
  // Loud parse — see docblock above for rationale.
  const schema = SETTINGS_SCHEMAS[key] as v.GenericSchema;
  return v.parse(schema, raw) as SettingsMap[K];
}

export function getAllSettings(db: Database.Database): Record<string, unknown> {
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as {
    key: string;
    value: string;
  }[];
  const c = getCache(db);
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    const value = JSON.parse(row.value);
    c.set(row.key, { value, expiry: Date.now() + ttlFor(row.key) });
    out[row.key] = value;
  }
  return out;
}

export function setSetting(db: Database.Database, key: string, value: unknown): void {
  const json = JSON.stringify(value);
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, json);
  getCache(db).delete(key);
}
