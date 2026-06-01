import type Database from "better-sqlite3";

const cache = new Map<string, { value: unknown; expiry: number }>();
const TTL_MS = 1000;

export function getSetting<T = unknown>(db: Database.Database, key: string): T | null {
  const cached = cache.get(key);
  if (cached && cached.expiry > Date.now()) return cached.value as T;

  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  if (!row) return null;

  const value = JSON.parse(row.value);
  cache.set(key, { value, expiry: Date.now() + TTL_MS });
  return value as T;
}

export function setSetting(db: Database.Database, key: string, value: unknown): void {
  const json = JSON.stringify(value);
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, json);
  cache.delete(key);
}