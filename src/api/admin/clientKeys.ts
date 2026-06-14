import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { isPasswordSet } from '../../auth/password.js';
import {
  createClientKey,
  deleteClientKey,
  disableClientKey,
  enableClientKey,
  genClientKey,
  getClientKey,
  listClientKeys,
  updateClientKeyLabel,
} from '../../db/repos/client_keys.js';
import { ApiError, handleApiError } from './middleware.js';
import { REAUTH_COOKIE, REAUTH_COOKIE_VALUE } from './reauth.js';

export const clientKeyRoutes = new Hono();

clientKeyRoutes.get('/', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    return c.json(
      listClientKeys(db).map((k) => ({
        id: k.id,
        label: k.label,
        enabled: !!k.enabled,
        createdAt: k.created_at,
        keyPreview: `${k.key.slice(0, 6)}••••${k.key.slice(-4)}`,
      }))
    );
  } catch (e) {
    return handleApiError(e);
  }
});

clientKeyRoutes.post('/', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    return c.req
      .json()
      .then((body: { label?: string }) => {
        if (!body.label || typeof body.label !== 'string') {
          throw new ApiError('invalid_input', 'label is required', 400);
        }
        const key = genClientKey();
        const created = createClientKey(db, { label: body.label, key });
        return c.json({ id: created.id, key, label: body.label }, 201);
      })
      .catch((e: unknown) => handleApiError(e));
  } catch (e) {
    return handleApiError(e);
  }
});

clientKeyRoutes.get('/:id/key', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    // Sensitive endpoint: when a dashboard password is configured, require a
    // fresh (≤60s old) re-auth cookie on top of the admin auth already enforced
    // by requireAdminJson. Open mode (no password set) stays zero-friction.
    if (isPasswordSet(db)) {
      const reauth = getCookie(c, REAUTH_COOKIE);
      if (reauth !== REAUTH_COOKIE_VALUE) {
        throw new ApiError('reauth_required', 're-authentication required', 401);
      }
    }
    const row = getClientKey(db, Number(c.req.param('id')));
    if (!row) throw new ApiError('not_found', 'client key not found', 404);
    return c.json({ id: row.id, label: row.label, key: row.key });
  } catch (e) {
    return handleApiError(e);
  }
});

clientKeyRoutes.post('/:id/disable', (c) => {
  try {
    disableClientKey(c.get('db') as Database.Database, Number(c.req.param('id')));
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
});

clientKeyRoutes.post('/:id/enable', (c) => {
  try {
    enableClientKey(c.get('db') as Database.Database, Number(c.req.param('id')));
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
});

clientKeyRoutes.patch('/:id', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const id = Number(c.req.param('id'));
    const { label } = await c.req.json<{ label: string }>();
    if (!label || typeof label !== 'string' || !label.trim()) {
      return c.json({ error: 'invalid_body', message: 'label required' }, 400);
    }
    updateClientKeyLabel(db, id, label.trim());
    const key = getClientKey(db, id);
    if (!key) return c.json({ error: 'not_found', message: 'Key not found' }, 404);
    return c.json({ id: key.id, label: key.label });
  } catch (e) {
    return handleApiError(e);
  }
});

clientKeyRoutes.delete('/:id', (c) => {
  try {
    deleteClientKey(c.get('db') as Database.Database, Number(c.req.param('id')));
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
});
