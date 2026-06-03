import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface ClientKey {
  id: number;
  label: string;
  key: string;
  enabled: number;
  created_at: string;
}

const CK_TTL_MS = 5_000;
const ckCaches = new WeakMap<
  Database.Database,
  Map<string, { value: ClientKey | null; expiry: number }>
>();

function ckCache(db: Database.Database): Map<string, { value: ClientKey | null; expiry: number }> {
  let c = ckCaches.get(db);
  if (!c) {
    c = new Map();
    ckCaches.set(db, c);
  }
  return c;
}

export function clearClientKeyCache(db: Database.Database): void {
  ckCaches.delete(db);
}

export type ClientKeyCreate = Pick<ClientKey, 'label' | 'key'> & { enabled?: boolean };

export function genClientKey(): string {
  return `rk_${randomBytes(18).toString('base64url')}`;
}

export function createClientKey(db: Database.Database, input: ClientKeyCreate): ClientKey {
  const info = db
    .prepare(`INSERT INTO client_keys (label, key, enabled) VALUES (?, ?, ?)`)
    .run(input.label, input.key, input.enabled === false ? 0 : 1);
  return getClientKey(db, info.lastInsertRowid as number)!;
}

export function getClientKey(db: Database.Database, id: number): ClientKey | null {
  return (
    (db.prepare(`SELECT * FROM client_keys WHERE id = ?`).get(id) as ClientKey | undefined) ?? null
  );
}

export function getClientKeyByKey(db: Database.Database, key: string): ClientKey | null {
  const c = ckCache(db);
  const hit = c.get(key);
  if (hit && hit.expiry > Date.now()) return hit.value;
  const row =
    (db.prepare(`SELECT * FROM client_keys WHERE key = ? AND enabled = 1`).get(key) as
      | ClientKey
      | undefined) ?? null;
  c.set(key, { value: row, expiry: Date.now() + CK_TTL_MS });
  return row;
}

export function listClientKeys(db: Database.Database): ClientKey[] {
  return db.prepare(`SELECT * FROM client_keys ORDER BY id`).all() as ClientKey[];
}

export function disableClientKey(db: Database.Database, id: number): void {
  db.prepare(`UPDATE client_keys SET enabled = 0 WHERE id = ?`).run(id);
  clearClientKeyCache(db);
}

export function enableClientKey(db: Database.Database, id: number): void {
  db.prepare(`UPDATE client_keys SET enabled = 1 WHERE id = ?`).run(id);
  clearClientKeyCache(db);
}

export function deleteClientKey(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM client_keys WHERE id = ?`).run(id);
  clearClientKeyCache(db);
}
