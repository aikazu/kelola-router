import type { Context, Next } from "hono";
import { getClientKeyByKey, type ClientKey } from "./db/repos/client_keys.js";
import { getAdminKey } from "./db/repos/users.js";
import { openDb } from "./db/index.js";

type Db = ReturnType<typeof openDb>;

declare module "hono" {
  interface ContextVariableMap {
    db: Db;
    clientKey: ClientKey;
    isAdmin: boolean;
    startTime: number;
  }
}

function extractBearer(c: Context): string | null {
  const auth = c.req.header("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return c.req.header("x-api-key") ?? null;
}

function extractAdmin(c: Context): string | null {
  return c.req.header("x-admin-key")
    ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "").trim()
    ?? null;
}

export async function requireApiKey(c: Context, next: Next): Promise<Response | void> {
  const key = extractBearer(c);
  if (!key) return c.json({ error: "missing API key" }, 401);
  const db = c.get("db");
  const clientKey = getClientKeyByKey(db, key);
  if (!clientKey) return c.json({ error: "invalid API key" }, 401);
  c.set("clientKey", clientKey);
  await next();
}

export async function requireAdmin(c: Context, next: Next): Promise<Response | void> {
  const db = c.get("db");
  const expected = getAdminKey(db);
  if (!expected) return c.json({ error: "admin key not configured (set ROUTER_ADMIN_KEY env or settings.admin_key)" }, 503);
  const key = extractAdmin(c);
  if (!key) return c.json({ error: "missing admin key" }, 401);
  if (key !== expected) return c.json({ error: "invalid admin key" }, 401);
  c.set("isAdmin", true);
  await next();
}
