import type Database from 'better-sqlite3';
import { type Context, Hono } from 'hono';
import { setPassword } from '../../auth/password.js';
import { getSettingT, setSetting } from '../../db/repos/settings.js';
import { handleApiError } from './middleware.js';

export const settingsRoutes = new Hono();

settingsRoutes.get('/', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const build = getSettingT(db, 'build');
    return c.json({
      caveman: getSettingT(db, 'caveman'),
      caching: getSettingT(db, 'caching'),
      rtk: getSettingT(db, 'rtk'),
      minimax: getSettingT(db, 'minimax'),
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

const SELECTION_PROVIDERS = ['minimax', 'kiro', 'codebuddy', 'pioneer', 'notion', 'zai'] as const;
type SelectionProvider = (typeof SELECTION_PROVIDERS)[number];
const SELECTION_MODES = ['lowest-backoff', 'round-robin', 'sticky'] as const;

function isSelectionProvider(p: string): p is SelectionProvider {
  return (SELECTION_PROVIDERS as readonly string[]).includes(p);
}

settingsRoutes.get('/selection/:provider', (c) => {
  try {
    const provider = c.req.param('provider');
    if (!isSelectionProvider(provider)) {
      return c.json(
        {
          error: 'invalid_provider',
          message: `Provider harus salah satu: ${SELECTION_PROVIDERS.join(', ')}`,
        },
        400
      );
    }
    const db = c.get('db') as Database.Database;
    const sel = getSettingT(db, `selection.${provider}`);
    return c.json({ mode: sel?.mode ?? 'lowest-backoff', step: sel?.step ?? 1 });
  } catch (e) {
    return handleApiError(e);
  }
});

settingsRoutes.post('/selection/:provider', async (c) => {
  try {
    const provider = c.req.param('provider');
    if (!isSelectionProvider(provider)) {
      return c.json(
        {
          error: 'invalid_provider',
          message: `Provider harus salah satu: ${SELECTION_PROVIDERS.join(', ')}`,
        },
        400
      );
    }
    const db = c.get('db') as Database.Database;
    const body = await c.req.json<{ mode?: string; step?: number }>();
    if (!body.mode || !(SELECTION_MODES as readonly string[]).includes(body.mode)) {
      return c.json(
        { error: 'invalid_mode', message: `Mode harus salah satu: ${SELECTION_MODES.join(', ')}` },
        400
      );
    }
    const step =
      Number.isInteger(body.step) && (body.step as number) >= 1 ? (body.step as number) : 1;
    setSetting(db, `selection.${provider}`, { mode: body.mode, step });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
});

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
