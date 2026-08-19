import type { Context, Next } from 'hono';
import type { openDb } from '../db/index.js';
import { type ClientKey, getClientKeyByKey } from '../db/repos/client_keys.js';
import { isPasswordSet, setPassword, verifyPassword } from './password.js';
import { clearLoginFailures, isLoginLocked, recordLoginFailure } from './rateLimit.js';
import { createSession, destroySession, validateSession } from './session.js';

// Re-exports for use by routes/handlers
export { isPasswordSet, setPassword, verifyPassword };

export function readCookie(c: Context, name: string): string | null {
  const raw = c.req.header('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function isSecureRequest(c: Context): boolean {
  return process.env.ROUTER_COOKIE_SECURE === '1' || c.req.header('x-forwarded-proto') === 'https';
}

export function setCookie(c: Context, name: string, value: string, maxAgeSec: number) {
  const secure = isSecureRequest(c) ? '; Secure' : '';
  c.header(
    'set-cookie',
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`
  );
}

export function clearCookie(c: Context, name: string) {
  const secure = isSecureRequest(c) ? '; Secure' : '';
  c.header('set-cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

export function verifySameOrigin(c: Context): boolean {
  const origin = c.req.header('origin');
  if (!origin) return true; // permissive: no Origin header (curl, server-to-server)
  const host = c.req.header('host');
  if (!host) return true; // no Host header — nothing to compare
  try {
    const o = new URL(origin);
    return o.host === host;
  } catch {
    return false;
  }
}

export async function csrfGuard(c: Context, next: Next): Promise<Response | undefined> {
  if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') {
    await next();
    return;
  }
  if (!verifySameOrigin(c)) {
    return c.json({ error: 'cross-origin request blocked' }, 403);
  }
  await next();
}

type Db = ReturnType<typeof openDb>;

declare module 'hono' {
  interface ContextVariableMap {
    db: Db;
    clientKey: ClientKey;
    isAdmin: boolean;
    startTime: number;
  }
}

export const SESSION_COOKIE = 'kelola_session';

function extractBearer(c: Context): string | null {
  const auth = c.req.header('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  return c.req.header('x-api-key') ?? null;
}

function clientIp(c: Context): string | null {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

export async function requireApiKey(c: Context, next: Next): Promise<Response | undefined> {
  const key = extractBearer(c);
  if (!key) return c.json({ error: 'missing API key' }, 401);
  const db = c.get('db');
  const clientKey = getClientKeyByKey(db, key);
  if (!clientKey) return c.json({ error: 'invalid API key' }, 401);
  c.set('clientKey', clientKey);
  await next();
}

/**
 * Admin auth with cascading checks:
 *   1. Session cookie (if password has been set)
 *   2. x-admin-key header (legacy / for scripts)
 *   3. ROUTER_ADMIN_KEY env (legacy / for scripts)
 *   4. If no password is set at all → allow (open mode for local dev)
 *   5. If password IS set and none of 1-3 matched → 401 (with login hint)
 */
export async function requireAdmin(c: Context, next: Next): Promise<Response | undefined> {
  const db = c.get('db');
  const passwordSet = isPasswordSet(db);

  // Try session cookie first
  if (passwordSet) {
    const sid = readCookie(c, SESSION_COOKIE);
    if (sid) {
      const s = validateSession(db, sid);
      if (s) {
        c.set('isAdmin', true);
        await next();
        return;
      }
    }
  }

  // Legacy: env / x-admin-key (works regardless of password state — for scripts)
  const envKey = process.env.ROUTER_ADMIN_KEY;
  const headerKey = c.req.header('x-admin-key');
  const authKey = c.req
    .header('authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim();
  const candidate = headerKey ?? authKey;
  if (envKey && candidate && candidate === envKey) {
    c.set('isAdmin', true);
    await next();
    return;
  }

  // No password configured → open access (local dev mode)
  if (!passwordSet) {
    c.set('isAdmin', true);
    await next();
    return;
  }

  // Password set but no valid session + no valid key
  if (c.req.method === 'GET' && !c.req.header('accept')?.includes('application/json')) {
    return c.redirect('/login');
  }
  return c.json({ error: 'admin login required (POST /login with password)' }, 401);
}

/**
 * Login handler: POST /login with `password` form field.
 * Sets session cookie on success.
 */
export async function handleLogin(c: Context): Promise<Response> {
  const db = c.get('db');
  if (!isPasswordSet(db)) {
    return c.redirect('/admin'); // open mode → no login needed
  }
  const ip = clientIp(c) ?? 'unknown';
  const lock = isLoginLocked(ip);
  if (lock.locked) {
    return c.html(
      renderLoginPage(
        `Too many attempts. Try again in ${Math.ceil(lock.retryAfterMs / 1000)}s.`,
        db
      ),
      429
    );
  }
  const body = await c.req.parseBody();
  const password = typeof body.password === 'string' ? body.password : '';
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'admin_password'`).get() as
    | { value: string }
    | undefined;
  if (!row || !verifyPassword(password, JSON.parse(row.value))) {
    recordLoginFailure(ip);
    return c.html(renderLoginPage('Wrong password.', db), 401);
  }
  clearLoginFailures(ip);
  const session = createSession(db, {
    userAgent: c.req.header('user-agent') ?? undefined,
    ip,
  });
  setCookie(c, SESSION_COOKIE, session.id, 7 * 24 * 60 * 60);
  return c.redirect('/admin');
}

export function handleLogout(c: Context): Response {
  const db = c.get('db');
  const sid = readCookie(c, SESSION_COOKIE);
  if (sid) destroySession(db, sid);
  clearCookie(c, SESSION_COOKIE);
  return c.redirect('/');
}

export function renderLoginPage(error: string, _db: Db): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Sign in — kelola-router</title>
<style>
  :root{--ink-0:#0a0908;--ink-1:#14110f;--ink-2:#1c1814;--ink-3:#2a2520;--gold-1:#d4af37;--gold-2:#f4d03f;--text-1:#f5f0e6;--text-2:#a8a098;--danger:#c0392b}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Manrope,-apple-system,sans-serif;background:radial-gradient(ellipse at top,#1c1814 0%,var(--ink-1) 60%,var(--ink-0) 100%);color:var(--text-1);min-height:100vh;display:grid;place-items:center;padding:24px}
  .card{background:var(--ink-2);border:1px solid rgba(212,175,55,0.15);border-radius:6px;padding:40px;width:100%;max-width:400px;box-shadow:0 0 60px rgba(0,0,0,0.5)}
  h1{font-family:'Cormorant Garamond',Georgia,serif;font-size:32px;font-weight:500;letter-spacing:0.5px;margin-bottom:6px}
  h1::first-letter{color:var(--gold-1)}
  .sub{color:var(--text-2);font-size:13px;letter-spacing:0.5px;margin-bottom:28px}
  label{display:block;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:var(--gold-1);margin-bottom:8px}
  input[type=password]{width:100%;background:var(--ink-1);border:1px solid var(--ink-3);color:var(--text-1);padding:12px 14px;border-radius:3px;font:inherit;font-size:14px;outline:none;transition:border 0.15s}
  input[type=password]:focus{border-color:var(--gold-1);box-shadow:0 0 0 3px rgba(212,175,55,0.1)}
  button{width:100%;background:linear-gradient(180deg,var(--gold-2) 0%,var(--gold-1) 100%);color:var(--ink-0);border:0;padding:12px;border-radius:3px;font:inherit;font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;cursor:pointer;margin-top:20px;transition:transform 0.1s}
  button:hover{transform:translateY(-1px)}
  .err{background:rgba(192,57,43,0.1);border:1px solid rgba(192,57,43,0.3);color:#e08a7e;padding:10px 14px;border-radius:3px;font-size:13px;margin-bottom:18px}
  .rule{display:flex;align-items:center;gap:12px;margin:24px 0;color:var(--text-2);font-size:11px;letter-spacing:1.5px;text-transform:uppercase}
  .rule::before,.rule::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,transparent,var(--gold-1),transparent);opacity:0.3}
  a{color:var(--gold-1);text-decoration:none}
  a:hover{color:var(--gold-2)}
</style>
</head><body>
<form method="POST" action="/login" class="card">
  <h1>kelola-router</h1>
  <p class="sub">Sign in to the dashboard</p>
  ${error ? `<div class="err">${error}</div>` : ''}
  <label for="password">Password</label>
  <input type="password" id="password" name="password" required autofocus autocomplete="current-password">
  <button type="submit">Enter</button>
  <div class="rule">or</div>
  <p style="text-align:center;font-size:13px"><a href="/">Back to home</a></p>
</form>
</body></html>`;
}
