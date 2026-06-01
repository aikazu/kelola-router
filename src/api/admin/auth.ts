import { Hono } from "hono";
import { generateCookie, getCookie } from "hono/cookie";
import type Database from "better-sqlite3";
import { isPasswordSet, verifyPassword } from "../../auth/password.js";
import { createSession, destroySession, validateSession } from "../../auth/session.js";
import { SESSION_COOKIE } from "../../auth.js";
import { handleApiError, ApiError } from "./middleware.js";

export const authRoutes = new Hono();

authRoutes.get("/me", (c) => {
  const db = c.get("db") as Database.Database;
  const passwordSet = isPasswordSet(db);
  if (!passwordSet) return c.json({ authed: true, passwordSet: false });
  const sessionId = getCookie(c, SESSION_COOKIE);
  const authed = sessionId ? !!validateSession(db, sessionId) : false;
  return c.json({ authed, passwordSet: true });
});

authRoutes.post("/login", async (c) => {
  try {
    const db = c.get("db") as Database.Database;
    const body = await c.req.json().catch(() => ({}));
    if (!isPasswordSet(db)) throw new ApiError("no_password", "no password set", 400);
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'admin_password'`).get() as { value: string } | undefined;
    if (!row || !verifyPassword(body.password ?? "", JSON.parse(row.value))) {
      throw new ApiError("invalid_password", "wrong password", 401);
    }
    const session = createSession(db, {});
    const cookie = generateCookie(SESSION_COOKIE, session.id, {
      httpOnly: true, sameSite: "Lax", path: "/", maxAge: 7 * 24 * 60 * 60,
    });
    return new Response(null, { status: 204, headers: { "set-cookie": cookie } });
  } catch (e) { return handleApiError(e); }
});

authRoutes.post("/logout", (c) => {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (sessionId) {
    const db = c.get("db") as Database.Database;
    destroySession(db, sessionId);
  }
  return new Response(null, {
    status: 204,
    headers: { "set-cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` },
  });
});
