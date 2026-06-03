import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import {
  createClientKey,
  deleteClientKey,
  disableClientKey,
  enableClientKey,
  genClientKey,
  listClientKeys,
} from '../../db/repos/client_keys.js';
import { ApiError, handleApiError } from './middleware.js';

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
        keyPreview: k.key.slice(0, 6) + '••••' + k.key.slice(-4),
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

clientKeyRoutes.delete('/:id', (c) => {
  try {
    deleteClientKey(c.get('db') as Database.Database, Number(c.req.param('id')));
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
});
