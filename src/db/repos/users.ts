import type Database from "better-sqlite3";
import { randomBytes } from "crypto";

export interface User {
  id: number;
  name: string;
  api_key: string;
  admin_key: string | null;
  enabled: boolean;
  created_at: string;
}

export interface UserWithAccounts extends User {
  accounts: AccountLite[];
}

interface AccountLite {
  id: string;
  label: string;
  provider: string;
  credit_type: string;
  enabled: boolean;
  rate_limited_until: string | null;
  backoff_level: number;
  status: string;
  position: number;
}

function genKey(prefix: string): string {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}

export function createUser(db: Database.Database, name: string): User {
  const apiKey = genKey("rk");
  const adminKey = genKey("ak");
  const info = db.prepare(
    `INSERT INTO users (name, api_key, admin_key) VALUES (?, ?, ?)`
  ).run(name, apiKey, adminKey);
  return {
    id: info.lastInsertRowid as number,
    name,
    api_key: apiKey,
    admin_key: adminKey,
    enabled: true,
    created_at: new Date().toISOString(),
  };
}

function loadAccountsFor(db: Database.Database, userId: number): AccountLite[] {
  return db.prepare(
    `SELECT id, label, provider, credit_type, enabled, rate_limited_until, backoff_level, status, position
     FROM accounts WHERE user_id = ? ORDER BY position`
  ).all(userId) as AccountLite[];
}

export function getUserByApiKey(db: Database.Database, apiKey: string): UserWithAccounts | null {
  const row = db.prepare(`SELECT * FROM users WHERE api_key = ? AND enabled = 1`).get(apiKey) as User | undefined;
  if (!row) return null;
  return { ...row, accounts: loadAccountsFor(db, row.id) };
}

export function getUserByAdminKey(db: Database.Database, adminKey: string): UserWithAccounts | null {
  const row = db.prepare(`SELECT * FROM users WHERE admin_key = ? AND enabled = 1`).get(adminKey) as User | undefined;
  if (!row) return null;
  return { ...row, accounts: loadAccountsFor(db, row.id) };
}

export function listUsers(db: Database.Database): User[] {
  return db.prepare(`SELECT * FROM users ORDER BY id`).all() as User[];
}
