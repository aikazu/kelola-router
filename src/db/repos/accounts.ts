import type Database from "better-sqlite3";

export interface Account {
  id: string;
  label: string;
  credit_type: "payg" | "token-plan";
  api_key: string;
  base_url: string | null;
  enabled: boolean;
  rate_limited_until: string | null;
  backoff_level: number;
  last_error: string | null;
  status: "active" | "error" | "disabled";
  created_at: string;
}

export type AccountCreate = Pick<Account, "id" | "label" | "credit_type" | "api_key"> & {
  base_url?: string | null;
  enabled?: boolean;
};

export function createAccount(db: Database.Database, input: AccountCreate): Account {
  db.prepare(`
    INSERT INTO accounts (id, label, credit_type, api_key, base_url, enabled)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    input.id, input.label, input.credit_type, input.api_key,
    input.base_url ?? null, input.enabled === false ? 0 : 1,
  );
  return getAccount(db, input.id)!;
}

export function getAccount(db: Database.Database, id: string): Account | null {
  return (db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as Account | undefined) ?? null;
}

export function getAccountByApiKey(db: Database.Database, apiKey: string): Account | null {
  return (db.prepare(`SELECT * FROM accounts WHERE api_key = ?`).get(apiKey) as Account | undefined) ?? null;
}

export function listAccounts(db: Database.Database): Account[] {
  return db.prepare(`SELECT * FROM accounts ORDER BY created_at`).all() as Account[];
}

export function listEnabledAccounts(db: Database.Database): Account[] {
  return db.prepare(`SELECT * FROM accounts WHERE enabled = 1 ORDER BY created_at`).all() as Account[];
}

export function updateAccount(db: Database.Database, id: string, patch: Partial<Account>): void {
  const keys = Object.keys(patch).filter(k => k !== "id" && k !== "created_at");
  if (keys.length === 0) return;
  const set = keys.map(k => `${k} = ?`).join(", ");
  const values = keys.map(k => (patch as Record<string, unknown>)[k]);
  db.prepare(`UPDATE accounts SET ${set} WHERE id = ?`).run(...values, id);
}

export function enableAccount(db: Database.Database, id: string): void {
  db.prepare(`UPDATE accounts SET enabled = 1 WHERE id = ?`).run(id);
}

export function disableAccount(db: Database.Database, id: string): void {
  db.prepare(`UPDATE accounts SET enabled = 0 WHERE id = ?`).run(id);
}

export function deleteAccount(db: Database.Database, id: string): void {
  db.prepare(`DELETE FROM accounts WHERE id = ?`).run(id);
}
