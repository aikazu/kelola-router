import type Database from 'better-sqlite3';

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
  // for a clean cache (matches CLAUDE.md test pattern).
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
