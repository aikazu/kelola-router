import type Database from "better-sqlite3";
import { getSetting } from "./settings.js";

/**
 * Resolve the admin key for /admin/* routes.
 * Resolution order: env ROUTER_ADMIN_KEY > settings.admin_key > null.
 * Returns null if no admin key is configured.
 */
export function getAdminKey(db: Database.Database): string | null {
  if (process.env.ROUTER_ADMIN_KEY) return process.env.ROUTER_ADMIN_KEY;
  const row = getSetting<{ key: string }>(db, "admin_key");
  return row?.key ?? null;
}
