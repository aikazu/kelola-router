import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { checkFallbackError } from './accounts/errorRules.js';
import { clearExpiredModelLocks, getModelLock, setModelLock } from './accounts/locks.js';
import { selectAccount } from './accounts/selection.js';
import { isModelLockActive } from './accounts/state.js';
import type { AccountState } from './accounts/types.js';
import { adminApi } from './api/admin/index.js';
import { setPassword } from './auth/password.js';
import {
  handleLogin,
  handleLogout,
  requireAdmin,
  requireApiKey,
  verifySameOrigin,
} from './auth.js';
import { augmentRequest } from './cache-injection.js';
import { openDb } from './db/index.js';
import {
  createAccount,
  deleteAccount,
  disableAccount,
  enableAccount,
  listEnabledAccounts,
  updateAccount,
} from './db/repos/accounts.js';
import {
  createClientKey,
  deleteClientKey,
  disableClientKey,
  enableClientKey,
  genClientKey,
} from './db/repos/client_keys.js';
import { disableModel, enableModel } from './db/repos/models.js';
import { insertRequestLogDeferred } from './db/repos/requestLogs.js';
import { getAllSettings, getSetting, setSetting } from './db/repos/settings.js';
import { resolveModel } from './providers/alias.js';
import { getUpstreamFormat } from './providers/format/negotiate.js';
import {
  bodyAddsOpenAIStreamUsage,
  bodyAnthropicToOpenAI,
  bodyOpenAIToAnthropic,
  responseAnthropicToOpenAI,
  responseOpenAIToAnthropic,
} from './providers/format/transform.js';
import { fetchModels } from './providers/listModels.js';
import { PROVIDER, upstreamHeaders, upstreamUrl } from './providers/minimax.js';
import { parseError } from './providers/parseError.js';
import { calculateCost } from './providers/pricing.js';
import { upstreamFetch } from './providers/upstreamFetch.js';
import { headersToJson, truncateBody } from './proxy/capture.js';
import { compressMessages, formatRtkLog } from './rtk/index.js';
import { startQuotaPuller, stopQuotaPuller } from './scheduler/quotaPull.js';
import { pipeWithUsage } from './streaming/pipeWithUsage.js';
import { getHost, getPort } from './util/env.js';
import { log } from './util/log.js';

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

let _db: Database.Database | null = null;
function getDb(): Database.Database {
  if (!_db) _db = openDb();
  return _db;
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

async function handleProxy(
  c: any,
  format: 'openai' | 'anthropic',
  upstreamPath: string
): Promise<Response> {
  const clientKey = c.get('clientKey');
  const text = await c.req.text();
  if (text.length > 10 * 1024 * 1024) {
    return c.json({ error: 'request body exceeds 10MB limit' }, 413);
  }
  let body: any = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (e: any) {
      return c.json({ error: `invalid JSON: ${e.message}` }, 400);
    }
  }
  const db = c.get('db');
  getAllSettings(db); // warm per-db settings cache: one query instead of many lookups

  const settings = {
    caveman: (getSetting(db, 'caveman') as { level: string } | null) ?? undefined,
    caching:
      (getSetting(db, 'caching') as {
        autoBreakpoints: boolean;
        respectCallerMarkers: boolean;
      } | null) ?? undefined,
  };
  await augmentRequest(body, settings);

  const rtkSetting = getSetting(db, 'rtk') as { enabled: boolean } | null;
  if (rtkSetting?.enabled) {
    const stats = compressMessages(body, true);
    const rtkLog = formatRtkLog(stats);
    if (rtkLog) console.log(rtkLog);
  }

  // Determine upstream format. Default = same as client. Override via
  // settings.minimax.upstreamFormat or ROUTER_UPSTREAM_FORMAT env.
  const overrideRaw =
    (getSetting(db, 'minimax') as { upstreamFormat?: string } | null)?.upstreamFormat ??
    process.env.ROUTER_UPSTREAM_FORMAT ??
    'auto';
  const upstreamFormat = getUpstreamFormat(format, overrideRaw as 'auto' | 'openai' | 'anthropic');

  // OpenAI streaming: ensure include_usage so the final chunk carries usage.
  if (upstreamFormat === 'openai') {
    bodyAddsOpenAIStreamUsage(body);
  }

  // Cross-format body conversion (only when client != upstream).
  if (format !== upstreamFormat) {
    if (format === 'openai' && upstreamFormat === 'anthropic') {
      Object.assign(body, bodyOpenAIToAnthropic(body));
    } else if (format === 'anthropic' && upstreamFormat === 'openai') {
      Object.assign(body, bodyAnthropicToOpenAI(body));
    }
  }

  // Pool: ALL enabled MiniMax accounts (shared across all client keys).
  const allAccounts = listEnabledAccounts(db);
  if (allAccounts.length === 0) {
    return c.json({ error: 'no upstream accounts configured' }, 503);
  }
  const accountStates: AccountState[] = allAccounts.map((a) => ({
    id: a.id,
    backoffLevel: a.backoff_level,
    rateLimitedUntil: a.rate_limited_until,
    lastError: a.last_error ? (safeJsonParse(a.last_error) as AccountState['lastError']) : null,
    status: a.status as AccountState['status'],
    enabled: !!a.enabled,
  }));
  const account = selectAccount(accountStates);
  if (!account) return c.json({ error: 'all accounts unavailable' }, 503);
  const acc = allAccounts.find((a) => a.id === account.id)!;

  let resolved;
  try {
    resolved = resolveModel(db, body.model ?? '', body);
    body.model = resolved.upstreamModel;
    resolved.bodyTransform(body);
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
  const requestedModel = resolved.requestedModel;

  clearExpiredModelLocks(db);
  if (isModelLockActive(getModelLock(db, account.id, resolved.upstreamModel))) {
    return c.json({ error: `model ${resolved.upstreamModel} temporarily locked` }, 429);
  }

  const url = upstreamUrl(
    { provider: PROVIDER, apiKey: acc.api_key, baseUrl: acc.base_url },
    upstreamFormat,
    upstreamPath
  );
  const headers = upstreamHeaders(
    { provider: PROVIDER, apiKey: acc.api_key, baseUrl: acc.base_url },
    body.stream === true,
    upstreamFormat
  );
  const transport = getSetting<{
    relay: { kind: 'vercel' | 'cloudflare'; url: string } | null;
    proxy: { kind: 'http' | 'socks5'; url: string } | null;
  } | null>(db, 'transport');

  try {
    const resp = await upstreamFetch(url, body, headers, transport);
    if (!resp.ok) {
      const errBody = await resp.text();
      const parsed = parseError(resp, errBody);
      const decision = checkFallbackError(
        resp.status,
        parsed.message,
        parsed.baseRespCode,
        acc.backoff_level,
        parsed.windowResetMs,
        parsed.retryAfterSec ? parsed.retryAfterSec * 1000 : undefined
      );
      const rateLimitedUntil =
        decision.cooldownMs > 0 ? new Date(Date.now() + decision.cooldownMs).toISOString() : null;
      updateAccount(db, account.id, {
        rate_limited_until: rateLimitedUntil,
        backoff_level: decision.newBackoffLevel ?? 0,
        last_error: JSON.stringify({
          status: resp.status,
          message: errBody.slice(0, 500),
          timestamp: new Date().toISOString(),
          baseRespCode: parsed.baseRespCode,
        }),
        status: resp.status === 401 ? 'error' : 'active',
      });
      if (decision.cooldownMs > 0) {
        setModelLock(db, account.id, resolved.upstreamModel, decision.cooldownMs);
      }
      if (decision.source === 'balance') {
        disableAccount(db, account.id);
      }
      return c.body(errBody, resp.status as any, {
        'content-type': resp.headers.get('content-type') ?? 'application/json',
      });
    }
    if (
      acc.backoff_level !== 0 ||
      acc.status !== 'active' ||
      acc.rate_limited_until !== null ||
      acc.last_error !== null
    ) {
      updateAccount(db, account.id, {
        rate_limited_until: null,
        backoff_level: 0,
        last_error: null,
        status: 'active',
      });
    }

    if (body.stream === true) {
      const startMs = c.get('startTime');
      const clientKeyId = clientKey.id;
      const accountId = account.id;
      const modelName = body.model;
      const piped = await pipeWithUsage(resp, format, (usage, raw) => {
        const prompt = usage?.prompt_tokens ?? 0;
        const completion = usage?.completion_tokens ?? 0;
        const cacheCreate = usage?.cache_creation_tokens ?? 0;
        const cacheRead = usage?.cache_read_tokens ?? 0;
        const total = usage?.total_tokens ?? prompt + completion;
        const cost = calculateCost(db, modelName, {
          prompt_tokens: prompt,
          completion_tokens: completion,
          cache_creation_tokens: cacheCreate,
          cache_read_tokens: cacheRead,
        });
        insertRequestLogDeferred(db, {
          client_key_id: clientKeyId,
          account_id: accountId,
          model: modelName,
          requested_model: requestedModel,
          endpoint: upstreamPath,
          format: upstreamFormat,
          prompt_tokens: prompt,
          completion_tokens: completion,
          cache_creation_tokens: cacheCreate,
          cache_read_tokens: cacheRead,
          total_tokens: total,
          cost_usd: cost,
          latency_ms: Date.now() - startMs,
          status_code: resp.status,
          base_resp_code: undefined,
          stream: 1,
          rtk_bytes_saved: 0,
          request_body: truncateBody(text),
          response_body: truncateBody(raw),
          request_headers: headersToJson(c.req.raw.headers),
          response_headers: headersToJson(resp.headers),
        });
      });
      return piped;
    }

    let respBody = await resp.text();
    // Cross-format response conversion (non-stream only). Stream responses
    // pass through with upstream shape — stream-shape re-emit is deferred.
    if (format !== upstreamFormat) {
      try {
        const parsed = JSON.parse(respBody);
        // The response is in upstreamFormat. Convert to client format.
        const converted =
          upstreamFormat === 'anthropic'
            ? responseAnthropicToOpenAI(parsed)
            : responseOpenAIToAnthropic(parsed);
        respBody = JSON.stringify(converted);
      } catch {
        /* non-JSON or malformed; pass through */
      }
    }
    let usage: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cache_creation_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    } = {};
    try {
      usage = JSON.parse(respBody).usage ?? {};
    } catch {}
    const cost = calculateCost(db, body.model, {
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      cache_creation_tokens: usage.cache_creation_tokens ?? 0,
      cache_read_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    });
    insertRequestLogDeferred(db, {
      client_key_id: clientKey.id,
      account_id: account.id,
      model: body.model,
      requested_model: requestedModel,
      endpoint: upstreamPath,
      format: upstreamFormat,
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      cache_creation_tokens: usage.cache_creation_tokens ?? 0,
      cache_read_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
      cost_usd: cost,
      latency_ms: Date.now() - c.get('startTime'),
      status_code: resp.status,
      base_resp_code: undefined,
      stream: 0,
      rtk_bytes_saved: 0,
      request_body: truncateBody(text),
      response_body: truncateBody(respBody),
      request_headers: headersToJson(c.req.raw.headers),
      response_headers: headersToJson(resp.headers),
    });
    return c.body(respBody, resp.status as any, {
      'content-type': resp.headers.get('content-type') ?? 'application/json',
    });
  } catch (e: any) {
    log.error({ err: e.message }, 'upstream unreachable');
    return c.json({ error: `upstream unreachable: ${e.message}` }, 502);
  }
}

app.post('/v1/chat/completions', requireApiKey, (c) =>
  handleProxy(c, 'openai', '/v1/chat/completions')
);
app.post('/v1/messages', requireApiKey, (c) => handleProxy(c, 'anthropic', '/v1/messages'));
app.post('/v1/messages/count_tokens', requireApiKey, (c) =>
  handleProxy(c, 'anthropic', '/v1/messages/count_tokens')
);
app.post('/v1/embeddings', requireApiKey, (c) =>
  c.json({ error: 'embeddings not supported by MiniMax' }, 501)
);
app.get('/v1/models', requireApiKey, async (c) => {
  const db = c.get('db');
  const allAccounts = listEnabledAccounts(db);
  if (allAccounts.length === 0) return c.json({ error: 'no upstream accounts configured' }, 503);
  const acc = allAccounts[0]!;
  const overrideRaw =
    (getSetting(db, 'minimax') as { upstreamFormat?: string } | null)?.upstreamFormat ?? 'auto';
  const upstreamFormat = getUpstreamFormat(
    'openai',
    overrideRaw as 'auto' | 'openai' | 'anthropic'
  );
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
  const transport = getSetting<{
    relay: { kind: 'vercel' | 'cloudflare'; url: string } | null;
    proxy: { kind: 'http' | 'socks5'; url: string } | null;
  } | null>(db, 'transport');
  const resp = await upstreamFetch(url, {}, headers, transport);
  const text = await resp.text();
  return c.body(text, resp.status as any, {
    'content-type': resp.headers.get('content-type') ?? 'application/json',
  });
});

app.post('/admin/models/fetch', requireAdmin, async (c) => {
  const db = c.get('db');
  const firstActive = listEnabledAccounts(db)[0];
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
  const current = (getSetting(c.get('db'), 'minimax') as Record<string, unknown> | null) ?? {};
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = getPort();
  const hostname = getHost();
  serve({ fetch: app.fetch, port, hostname }, (info) => {
    log.info({ address: info.address, port: info.port }, 'router listening');
    startQuotaPuller(getDb(), 5 * 60_000);
  });

  function gracefulShutdown(signal: string): void {
    log.info({ signal }, 'shutting down');
    stopQuotaPuller();
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
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}
