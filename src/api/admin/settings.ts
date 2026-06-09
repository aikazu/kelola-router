import type Database from 'better-sqlite3';
import { type Context, Hono } from 'hono';
import { setPassword } from '../../auth/password.js';
import { getSetting, setSetting } from '../../db/repos/settings.js';
import { handleApiError } from './middleware.js';

export const settingsRoutes = new Hono();

settingsRoutes.get('/', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const build = getSetting(db, 'build') as { version?: string } | null;
    return c.json({
      caveman: getSetting(db, 'caveman') ?? { level: 'off' },
      caching: getSetting(db, 'caching') ?? { autoBreakpoints: true },
      rtk: getSetting(db, 'rtk') ?? { enabled: true },
      minimax: getSetting(db, 'minimax') ?? {},
      selection: getSetting(db, 'selection') ?? { mode: 'lowest-backoff' },
      version: build?.version ?? null,
    });
  } catch (e) {
    return handleApiError(e);
  }
});

const post = (key: string) => async (c: Context) => {
  try {
    const db = c.get('db') as Database.Database;
    const body = await c.req.json();
    setSetting(db, key, body);
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
};

settingsRoutes.post('/caveman', post('caveman'));
settingsRoutes.post('/rtk', post('rtk'));
settingsRoutes.post('/caching', post('caching'));
settingsRoutes.post('/minimax', post('minimax'));
settingsRoutes.post('/selection', post('selection'));

settingsRoutes.post('/password', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const body = await c.req.json();
    if (body.action === 'set') {
      if (!body.password || String(body.password).length < 4) {
        return c.json({ error: 'invalid_input', message: 'password min 4 chars' }, 400);
      }
      setPassword(db, String(body.password));
    }
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
});
