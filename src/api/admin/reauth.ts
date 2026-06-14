import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { isPasswordSet, verifyPassword } from '../../auth/password.js';
import { ApiError, handleApiError } from './middleware.js';

/**
 * Short-lived re-authentication cookie gating access to sensitive key-reveal
 * endpoints (e.g. `GET /api/admin/client-keys/:id/key`). The cookie is a pure
 * client-side marker — there is NO server-side store — so expiry is enforced
 * by the browser/cookie jar via Max-Age, not by our gate (which only checks
 * the cookie value === 'verified').
 */
export const REAUTH_COOKIE = 'kelola_reauth';
export const REAUTH_COOKIE_VALUE = 'verified';
export const REAUTH_MAX_AGE_SEC = 60;
const REAUTH_COOKIE_PATH = '/api/admin';

function isSecureRequest(c: { req: { header: (n: string) => string | undefined } }): boolean {
  return process.env.ROUTER_COOKIE_SECURE === '1' || c.req.header('x-forwarded-proto') === 'https';
}

/**
 * Build a Set-Cookie header string for the reauth cookie. We build it manually
 * (rather than using hono/cookie's setCookie) so we can attach it to a fresh
 * `new Response(...)` — setCookie mutates c.res, which is discarded when a
 * handler returns its own Response. Mirrors the pattern in src/auth.ts logout.
 */
function buildReauthCookie(
  c: { req: { header: (n: string) => string | undefined } },
  value: string,
  maxAge: number
): string {
  const secure = isSecureRequest(c) ? '; Secure' : '';
  return `${REAUTH_COOKIE}=${value}; Max-Age=${maxAge}; Path=${REAUTH_COOKIE_PATH}; HttpOnly; SameSite=Strict${secure}`;
}

export const reauthRoutes = new Hono();

reauthRoutes.post('/verify', async (c) => {
  try {
    const db = c.get('db') as Database.Database;

    // Cannot re-authenticate against a password that doesn't exist.
    if (!isPasswordSet(db)) {
      throw new ApiError('no_password_configured', 'no admin password set', 400);
    }

    const body = await c.req.json().catch(() => ({}));
    const password = typeof body?.password === 'string' ? body.password : '';

    const row = db.prepare(`SELECT value FROM settings WHERE key = 'admin_password'`).get() as
      | { value: string }
      | undefined;
    if (!row || !verifyPassword(password, JSON.parse(row.value))) {
      throw new ApiError('wrong_password', 'wrong password', 401);
    }

    setCookie(c, REAUTH_COOKIE, REAUTH_COOKIE_VALUE, {
      httpOnly: true,
      sameSite: 'Strict',
      path: REAUTH_COOKIE_PATH,
      maxAge: REAUTH_MAX_AGE_SEC,
      secure: isSecureRequest(c),
    });
    return c.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
});

reauthRoutes.post('/clear', (c) => {
  try {
    return new Response(null, {
      status: 204,
      headers: { 'set-cookie': buildReauthCookie(c, '', 0) },
    });
  } catch (e) {
    return handleApiError(e);
  }
});
