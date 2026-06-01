import type Database from "better-sqlite3";
import type { ModelLock } from "./types.js";

export function setModelLock(db: Database.Database, accountId: string, model: string, cooldownMs: number): void {
  const lockedUntil = new Date(Date.now() + cooldownMs).toISOString();
  db.prepare(
    `INSERT INTO account_model_locks (account_id, model, locked_until) VALUES (?, ?, ?)
     ON CONFLICT(account_id, model) DO UPDATE SET locked_until = excluded.locked_until`,
  ).run(accountId, model, lockedUntil);
}

export function getModelLock(db: Database.Database, accountId: string, model: string): ModelLock | undefined {
  const row = db.prepare(
    `SELECT account_id, model, locked_until FROM account_model_locks WHERE account_id = ? AND model = ?`,
  ).get(accountId, model) as { account_id: string; model: string; locked_until: string } | undefined;
  if (!row) return undefined;
  return { accountId: row.account_id, model: row.model, lockedUntil: row.locked_until };
}

export function clearExpiredModelLocks(db: Database.Database): void {
  db.prepare(`DELETE FROM account_model_locks WHERE locked_until < ?`).run(new Date().toISOString());
}
