import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { getSecurityStatus } from '../../security/status.js';
import { handleApiError } from './middleware.js';

/**
 * Security-posture endpoint. Returns two boolean flags only — never the
 * password hash or the raw `ROUTER_DB_KEY` value. Consumed by the dashboard
 * SecurityBanner (Task 20) to decide whether to nag the user to set a
 * password / enable at-rest encryption.
 *
 * Auth + CSRF are enforced at the parent admin router
 * (`requireAdminJson` + `csrfGuard` in `src/api/admin/index.ts`), the same
 * chain that gates `/api/admin/client-keys`.
 */
export const securityRoutes = new Hono();

securityRoutes.get('/status', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    return c.json(getSecurityStatus(db, process.env));
  } catch (e) {
    return handleApiError(e);
  }
});
