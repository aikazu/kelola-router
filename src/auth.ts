import type { Context, Next } from "hono";
import { getUserByApiKey, getUserByAdminKey } from "./db/repos/users.js";
import type { UserWithAccounts } from "./db/repos/users.js";
import { openDb } from "./db/index.js";

type Db = ReturnType<typeof openDb>;

declare module "hono" {
  interface ContextVariableMap {
    db: Db;
    user: UserWithAccounts;
    startTime: number;
  }
}

function extractKey(c: Context): string | null {
  const auth = c.req.header("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return c.req.header("x-api-key") ?? c.req.header("x-admin-key") ?? null;
}

export async function requireApiKey(c: Context, next: Next): Promise<Response | void> {
  const key = extractKey(c);
  if (!key) return c.json({ error: "missing API key" }, 401);
  const db = c.get("db");
  const user = getUserByApiKey(db, key);
  if (!user) return c.json({ error: "invalid API key" }, 401);
  c.set("user", user);
  await next();
}

export async function requireAdmin(c: Context, next: Next): Promise<Response | void> {
  const key = extractKey(c);
  if (!key) return c.json({ error: "missing admin key" }, 401);
  const db = c.get("db");
  const userByAdmin = getUserByAdminKey(db, key);
  if (userByAdmin) {
    c.set("user", userByAdmin);
    await next();
    return;
  }
  const userByApi = getUserByApiKey(db, key);
  if (userByApi) {
    return c.json({ error: "admin endpoint requires admin key" }, 403);
  }
  return c.json({ error: "invalid key" }, 401);
}