import type Database from "better-sqlite3";

export interface Account {
  id: string;
  user_id: number;
  label: string;
  provider: string;
  credit_type: string;
  api_key: string;
  base_url: string | null;
  enabled: boolean;
  rate_limited_until: string | null;
  backoff_level: number;
  last_error: string | null;
  status: string;
  position: number;
  created_at: string;
}

export type AccountCreate = Omit<Account, "provider" | "base_url" | "enabled" | "rate_limited_until" | "backoff_level" | "last_error" | "status" | "position" | "created_at"> & {
  base_url?: string | null;
  enabled?: boolean;
  position?: number;
};

export function createAccount(db: Database.Database, input: AccountCreate): Account {
  db.prepare(`
    INSERT INTO accounts (id, user_id, label, provider, credit_type, api_key, base_url, enabled, position)
    VALUES (?, ?, ?, 'minimax', ?, ?, ?, ?, ?)
  `).run(
    input.id, input.user_id, input.label, input.credit_type, input.api_key,
    input.base_url ?? null, input.enabled === false ? 0 : 1, input.position ?? 0,
  );
  return getAccount(db, input.id)!;
}

export function getAccount(db: Database.Database, id: string): Account | null {
  return db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as Account | null;
}

export function listAccountsByUser(db: Database.Database, userId: number): Account[] {
  return db.prepare(`SELECT * FROM accounts WHERE user_id = ? ORDER BY position`).all(userId) as Account[];
}

export function updateAccount(db: Database.Database, id: string, patch: Partial<Account>): void {
  const keys = Object.keys(patch).filter(k => k !== "id" && k !== "created_at");
  if (keys.length === 0) return;
  const set = keys.map(k => `${k} = ?`).join(", ");
  const values = keys.map(k => (patch as Record<string, unknown>)[k]);
  db.prepare(`UPDATE accounts SET ${set} WHERE id = ?`).run(...values, id);
}

export interface ModelLock {
  account_id: string;
  model: string;
  locked_until: string;
}

export function setModelLock(db: Database.Database, accountId: string, model: string, cooldownMs: number): void {
  const lockedUntil = new Date(Date.now() + cooldownMs).toISOString();
  db.prepare(`
    INSERT INTO account_model_locks (account_id, model, locked_until)
    VALUES (?, ?, ?)
    ON CONFLICT(account_id, model) DO UPDATE SET locked_until = excluded.locked_until
  `).run(accountId, model, lockedUntil);
}

export function getModelLock(db: Database.Database, accountId: string, model: string): ModelLock | undefined {
  return db.prepare(`SELECT * FROM account_model_locks WHERE account_id = ? AND model = ?`)
    .get(accountId, model) as ModelLock | undefined;
}

export function clearExpiredModelLocks(db: Database.Database): void {
  db.prepare(`DELETE FROM account_model_locks WHERE locked_until < datetime('now')`).run();
}
