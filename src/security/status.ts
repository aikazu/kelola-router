import type Database from 'better-sqlite3';
import { isPasswordSet } from '../auth/password.js';

export interface SecurityStatus {
  /** True when an admin password is configured (dashboard is locked). */
  adminPasswordSet: boolean;
  /** True when ROUTER_DB_KEY is set (SQLite file encrypted at rest). */
  dbEncrypted: boolean;
}

/**
 * Pure security posture check. No side effects, no logging.
 *
 * `adminPasswordSet` delegates to the existing `isPasswordSet(db)` helper.
 * `dbEncrypted` mirrors the `getDbKey()` logic from `src/util/env.ts` but
 * reads from the passed `env` (defaulting to `process.env`) so callers —
 * including the Task 19 status endpoint — can evaluate arbitrary env
 * snapshots without mutating global state.
 */
export function getSecurityStatus(
  db: Database.Database,
  env: typeof process.env = process.env
): SecurityStatus {
  const rawKey = env.ROUTER_DB_KEY?.trim();
  const dbEncrypted = rawKey !== undefined && rawKey.length > 0;
  return {
    adminPasswordSet: isPasswordSet(db),
    dbEncrypted,
  };
}
