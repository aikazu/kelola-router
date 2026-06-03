import type Database from 'better-sqlite3';
import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { isPasswordSet } from '../../auth/password.js';
import { validateSession } from '../../auth/session.js';
import { SESSION_COOKIE } from '../../auth.js';

export async function requireAdminJson(c: Context, next: Next): Promise<Response | void> {
  const db = c.get('db') as Database.Database;
  if (!isPasswordSet(db)) return next();
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (!sessionId) {
    return c.json({ error: 'unauthorized', message: 'login required' }, 401);
  }
  const session = validateSession(db, sessionId);
  if (!session) {
    return c.json({ error: 'unauthorized', message: 'session expired' }, 401);
  }
  return next();
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 400
  ) {
    super(message);
  }
}

export function handleApiError(err: unknown): Response {
  if (err instanceof ApiError) {
    return Response.json({ error: err.code, message: err.message }, { status: err.status });
  }
  if (err instanceof Error) {
    return Response.json({ error: 'internal', message: err.message }, { status: 500 });
  }
  return Response.json({ error: 'internal', message: 'unknown error' }, { status: 500 });
}
