import { Hono } from "hono";
import type Database from "better-sqlite3";
import { listAccounts } from "../../db/repos/accounts.js";
import { handleApiError } from "./middleware.js";

export const quotaRoutes = new Hono();

quotaRoutes.get("/quota", (c) => {
  try {
    const db = c.get("db") as Database.Database;
    const accounts = listAccounts(db);
    return c.json(accounts.map(a => ({
      accountId: a.id, label: a.label, creditType: a.credit_type, windows: [],
    })));
  } catch (e) { return handleApiError(e); }
});
