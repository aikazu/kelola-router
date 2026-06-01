import type Database from "better-sqlite3";
import { randomBytes } from "crypto";

export interface ClientKey {
  id: number;
  label: string;
  key: string;
  enabled: number;
  created_at: string;
}

export type ClientKeyCreate = Pick<ClientKey, "label" | "key"> & { enabled?: boolean };

export function genClientKey(): string {
  return `rk_${randomBytes(18).toString("base64url")}`;
}

export function createClientKey(db: Database.Database, input: ClientKeyCreate): ClientKey {
  const info = db.prepare(
    `INSERT INTO client_keys (label, key, enabled) VALUES (?, ?, ?)`,
  ).run(input.label, input.key, input.enabled === false ? 0 : 1);
  return getClientKey(db, info.lastInsertRowid as number)!;
}

export function getClientKey(db: Database.Database, id: number): ClientKey | null {
  return (db.prepare(`SELECT * FROM client_keys WHERE id = ?`).get(id) as ClientKey | undefined) ?? null;
}

export function getClientKeyByKey(db: Database.Database, key: string): ClientKey | null {
  return (db.prepare(`SELECT * FROM client_keys WHERE key = ? AND enabled = 1`).get(key) as ClientKey | undefined) ?? null;
}

export function listClientKeys(db: Database.Database): ClientKey[] {
  return db.prepare(`SELECT * FROM client_keys ORDER BY id`).all() as ClientKey[];
}

export function disableClientKey(db: Database.Database, id: number): void {
  db.prepare(`UPDATE client_keys SET enabled = 0 WHERE id = ?`).run(id);
}

export function enableClientKey(db: Database.Database, id: number): void {
  db.prepare(`UPDATE client_keys SET enabled = 1 WHERE id = ?`).run(id);
}

export function deleteClientKey(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM client_keys WHERE id = ?`).run(id);
}
