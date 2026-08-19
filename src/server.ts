import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import type Database from 'better-sqlite3';
import { type Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { ulid } from 'ulid';
import { adminApi } from './api/admin/index.js';
import {
  handleLogin,
  handleLogout,
  requireAdmin,
  requireApiKey,
  verifySameOrigin,
} from './auth/index.js';
import { setPassword } from './auth/password.js';
import { consoleBus } from './console/bus.js';
import { attachStdoutSink } from './console/sink.js';
import { openDb } from './db/index.js';
import {
  createAccount,
  deleteAccount,
  disableAccount,
  enableAccount,
  listEnabledAccountsByProvider,
} from './db/repos/accounts.js';
import {
  createClientKey,
  deleteClientKey,
  disableClientKey,
  enableClientKey,
  genClientKey,
} from './db/repos/client-keys.js';
import { disableModel, enableModel } from './db/repos/models.js';
import { flushDeferredLogs } from './db/repos/request-logs.js';
import { getSettingT, setSetting } from './db/repos/settings.js';
import { getUpstreamFormat } from './providers/format/negotiate.js';
import { fetchModels } from './providers/list-models.js';
import { PROVIDER, upstreamHeaders, upstreamUrl } from './providers/minimax/index.js';
import { upstreamFetch } from './providers/upstream-fetch.js';
import { statusCode } from './proxy/helpers.js';
import { handleProxy } from './proxy/minimax.js';
import { startQuotaPuller, stopQuotaPuller } from './scheduler/quota-pull.js';
import { getSecurityStatus } from './security/status.js';
import { resolveTransportForAccount } from './transport/resolve.js';
import { getHost, getPort } from './util/env.js';
import { log } from './util/log.js';

let _db: Database.Database | null = null;
function getDb(): Database.Database {
  if (!_db) _db = openDb();
  return _db;
}

let rrCursor = 0;
const stickyMap = new Map<number, string>();

/** Test-only: reset the shared round-robin cursor so step assertions are deterministic. */
export function _resetSelectionCursorForTests(): void {
  rrCursor = 0;
}

const app = new Hono();
app.use('*', async (c, next) => {
  c.set('db', getDb());
  c.set('startTime', Date.now());
  await next();
});
app.route('/api', adminApi());

app.use('/admin/*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    if (!verifySameOrigin(c)) {
      return c.json({ error: 'cross-origin request blocked' }, 403);
    }
  }
  await next();
});

app.get('/health', (c) => c.json({ ok: true }));

app.post('/login', handleLogin);
app.post('/logout', handleLogout);

async function handleProxyWrapper(
  c: Context,
  format: 'openai' | 'anthropic',
  upstreamPath: string
): Promise<Response> {
  const rrCursorRef = { value: rrCursor };
  const db = c.get('db');
  const resp = await handleProxy(c, format, upstreamPath, rrCursorRef, stickyMap, db);
  rrCursor = rrCursorRef.value;
  return resp;
}

app.post('/v1/chat/completions', requireApiKey, (c) =>
  handleProxyWrapper(c, 'openai', '/v1/chat/completions')
);
app.post('/v1/messages', requireApiKey, (c) => handleProxyWrapper(c, 'anthropic', '/v1/messages'));
app.post('/v1/messages/count_tokens', requireApiKey, (c) =>
  handleProxyWrapper(c, 'anthropic', '/v1/messages/count_tokens')
);
app.post('/v1/embeddings', requireApiKey, (c) =>
  c.json({ error: 'embeddings not supported by MiniMax' }, 501)
);

app.get('/api/admin/console/stream', requireAdmin, (c) =>
  streamSSE(c, async (stream) => {
    for (const ev of consoleBus.recent()) {
      await stream.writeSSE({ data: JSON.stringify(ev) });
    }
    let alive = true;
    const off = consoleBus.subscribe((ev) => {
      if (alive) void stream.writeSSE({ data: JSON.stringify(ev) });
    });
    stream.onAbort(() => {
      alive = false;
      off();
    });
    // Heartbeat until aborted.
    while (alive) {
      await stream.sleep(15000);
      if (alive) await stream.writeSSE({ data: '', event: 'ping' });
    }
  })
);
app.get('/v1/models', requireApiKey, async (c) => {
  const db = c.get('db');
  // /v1/models proxies MiniMax's model catalogue — use a MiniMax account,
  // not whatever provider happens to be first in the accounts table.
  const allAccounts = listEnabledAccountsByProvider(db, 'minimax');
  if (allAccounts.length === 0) return c.json({ error: 'no minimax accounts configured' }, 503);
  const acc = allAccounts[0]!;
  const overrideRaw = getSettingT(db, 'minimax')?.upstreamFormat ?? 'auto';
  const upstreamFormat = getUpstreamFormat('openai', overrideRaw);
  const url = upstreamUrl(
    { provider: PROVIDER, apiKey: acc.api_key, baseUrl: acc.base_url },
    upstreamFormat,
    '/v1/models'
  );
  const headers = upstreamHeaders(
    { provider: PROVIDER, apiKey: acc.api_key, baseUrl: acc.base_url },
    false,
    upstreamFormat
  );
  const transport = resolveTransportForAccount(db, acc);
  const resp = await upstreamFetch(url, {}, headers, transport);
  const text = await resp.text();
  return c.body(text, statusCode(resp.status), {
    'content-type': resp.headers.get('content-type') ?? 'application/json',
  });
});

app.post('/admin/models/fetch', requireAdmin, async (c) => {
  const db = c.get('db');
  // fetchModels pulls MiniMax's model catalogue — pick a MiniMax account.
  const firstActive = listEnabledAccountsByProvider(db, 'minimax')[0];
  if (!firstActive)
    return c.json({ error: 'no active account — add a MiniMax upstream key first' }, 400);
  const result = await fetchModels(db, firstActive.api_key);
  if (!result.ok) {
    return c.json({ error: result.error ?? 'fetch failed', status: result.status }, 502);
  }
  return c.redirect(`/admin/models?fetched=${result.added ?? 0}`);
});
app.post('/admin/models/:name/enable', requireAdmin, (c) => {
  enableModel(c.get('db'), c.req.param('name')!);
  return c.redirect('/admin/models');
});
app.post('/admin/models/:name/disable', requireAdmin, (c) => {
  disableModel(c.get('db'), c.req.param('name')!);
  return c.redirect('/admin/models');
});

app.get('/admin', requireAdmin, (c) => c.redirect('/'));
app.get('/admin/usage', requireAdmin, (c) => c.redirect('/'));
app.get('/admin/accounts', requireAdmin, (c) => c.redirect('/'));
app.get('/admin/models', requireAdmin, (c) => c.redirect('/'));
app.get('/admin/quota', requireAdmin, (c) => c.redirect('/'));
app.get('/admin/settings', requireAdmin, (c) => c.redirect('/'));
app.get('/admin/client-keys', requireAdmin, (c) => c.redirect('/'));

app.post('/admin/accounts', requireAdmin, async (c) => {
  const body = await c.req.parseBody();
  const id = `acc_${ulid()}`;
  createAccount(c.get('db'), {
    id,
    label: String(body.label),
    credit_type: String(body.credit_type) as 'payg' | 'token-plan',
    api_key: String(body.api_key),
  });
  return c.redirect('/admin/accounts');
});
app.post('/admin/accounts/:id/enable', requireAdmin, (c) => {
  enableAccount(c.get('db'), c.req.param('id')!);
  return c.redirect('/admin/accounts');
});
app.post('/admin/accounts/:id/disable', requireAdmin, (c) => {
  disableAccount(c.get('db'), c.req.param('id')!);
  return c.redirect('/admin/accounts');
});
app.post('/admin/accounts/:id/delete', requireAdmin, (c) => {
  deleteAccount(c.get('db'), c.req.param('id')!);
  return c.redirect('/admin/accounts');
});

app.post('/admin/client-keys', requireAdmin, async (c) => {
  const body = await c.req.parseBody();
  const label = String(body.label ?? '').trim();
  if (!label) return c.redirect('/admin/client-keys');
  createClientKey(c.get('db'), { label, key: genClientKey() });
  return c.redirect('/admin/client-keys');
});
app.post('/admin/client-keys/:id/enable', requireAdmin, (c) => {
  enableClientKey(c.get('db'), Number(c.req.param('id')));
  return c.redirect('/admin/client-keys');
});
app.post('/admin/client-keys/:id/disable', requireAdmin, (c) => {
  disableClientKey(c.get('db'), Number(c.req.param('id')));
  return c.redirect('/admin/client-keys');
});
app.post('/admin/client-keys/:id/delete', requireAdmin, (c) => {
  deleteClientKey(c.get('db'), Number(c.req.param('id')));
  return c.redirect('/admin/client-keys');
});

app.post('/admin/settings/password', requireAdmin, async (c) => {
  const body = await c.req.parseBody();
  const action = String(body.action ?? '');
  if (action === 'clear') {
    setSetting(c.get('db'), 'admin_password', null);
  } else {
    const pw = String(body.password ?? '');
    if (pw.length >= 4) setPassword(c.get('db'), pw);
  }
  return c.redirect('/admin/settings');
});

app.post('/admin/settings/minimax', requireAdmin, async (c) => {
  const body = await c.req.parseBody();
  const current = getSettingT(c.get('db'), 'minimax') ?? {};
  const next = {
    ...current,
    upstreamFormat: String((body as Record<string, string>).upstreamFormat ?? 'auto'),
    m3DefaultMaxCompletionTokens: Number(
      (body as Record<string, string>).m3DefaultMaxCompletionTokens ?? 131072
    ),
  };
  setSetting(c.get('db'), 'minimax', next);
  return c.redirect('/admin/settings');
});

app.post('/admin/settings/caveman', requireAdmin, async (c) => {
  const body = await c.req.parseBody();
  setSetting(c.get('db'), 'caveman', { level: String(body.level) });
  return c.redirect('/admin/settings');
});
app.post('/admin/settings/rtk', requireAdmin, async (c) => {
  const body = await c.req.parseBody();
  setSetting(c.get('db'), 'rtk', { enabled: body.enabled === 'on' || body.enabled === 'true' });
  return c.redirect('/admin/settings');
});
app.post('/admin/settings/caching', requireAdmin, async (c) => {
  const body = await c.req.parseBody();
  setSetting(c.get('db'), 'caching', { autoBreakpoints: body.autoBreakpoints === 'on' });
  return c.redirect('/admin/settings');
});

export { handleCodeBuddyProxy } from './proxy/codebuddy.js';
export { handleComboProxy } from './proxy/combo.js';
export { handleKiroProxy } from './proxy/kiro.js';
export { handleProxy } from './proxy/minimax.js';
export { handleNotionProxy } from './proxy/notion.js';
export { handlePioneerProxy } from './proxy/pioneer.js';
export { handleTabiProxy } from './proxy/tabi.js';
export { app };

export function resetDb(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      /* already closed */
    }
  }
  _db = null;
}

/**
 * Emit pino warnings for insecure boot conditions. Called once after
 * migrations complete and before the HTTP listener starts. Both conditions
 * emit independently — open mode (no admin password) and/or unencrypted DB
 * (ROUTER_DB_KEY unset). Exported so tests can drive it with a controlled db.
 */
export function emitSecurityWarnings(db: Database.Database): void {
  const status = getSecurityStatus(db);
  if (!status.adminPasswordSet) {
    log.warn(
      { event: 'security.open_mode' },
      'Open mode: no admin password set. Anyone with network access can use this router.'
    );
  }
  if (!status.dbEncrypted) {
    log.warn(
      { event: 'security.db_unencrypted' },
      'ROUTER_DB_KEY not set: SQLite file is unencrypted at rest.'
    );
  }
}

// Serve built SPA if client/dist exists. In dev with `npm run dev`, Vite serves on
// :5173 with HMR; users should browse there. Visiting :20137 in dev will also serve
// the built SPA (no HMR) so URLs stay consistent.
if (existsSync('./client/dist/index.html')) {
  try {
    const { serveStatic } = await import('@hono/node-server/serve-static');
    const distRoot = './client/dist';
    app.use('/assets/*', serveStatic({ root: distRoot }));
    app.get('*', serveStatic({ path: './index.html', root: distRoot }));
    log.info({ root: distRoot }, 'serving SPA from client/dist');
  } catch (e) {
    log.warn({ err: (e as Error).message }, 'serveStatic unavailable; SPA not served');
  }
}

// patched for Windows: import.meta.url guard doesn't work with backslash paths.
// Skip the listen under vitest, otherwise every test file that imports this
// module races to bind the same port and floods the run with EADDRINUSE.
if (!process.env.VITEST) {
  const port = getPort();
  const hostname = getHost();
  // getDb() triggers openDb() (runs migrations); evaluate security posture
  // after the schema is ready but before the HTTP listener accepts traffic.
  emitSecurityWarnings(getDb());
  serve({ fetch: app.fetch, port, hostname }, (info) => {
    log.info({ address: info.address, port: info.port }, 'router listening');
    startQuotaPuller(getDb(), 5 * 60_000);
    attachStdoutSink(consoleBus);
  });

  async function gracefulShutdown(signal: string): Promise<void> {
    log.info({ signal }, 'shutting down');
    stopQuotaPuller();
    await flushDeferredLogs();
    if (_db) {
      try {
        _db.close();
      } catch {
        /* ignore */
      }
      _db = null;
    }
    process.exit(0);
  }
  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
}
