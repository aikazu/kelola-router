import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { listAccounts } from '../../db/repos/accounts.js';
import { getSetting, setSetting } from '../../db/repos/settings.js';
import {
  createTransport,
  deleteTransport,
  deleteTransports,
  getTransport,
  listTransports,
  setTransportCountry,
  type TransportKind,
  type TransportType,
  updateTransport,
} from '../../db/repos/transports.js';
import { checkTransportGeo } from '../../transport/geoip.js';
import { proxyAwareFetch } from '../../transport/proxy-fetch.js';
import type { TransportConfig } from '../../transport/types.js';
import { ApiError, handleApiError } from './middleware.js';

export const transportRoutes = new Hono();

interface TransportSetting {
  relay?: unknown;
  proxy?: unknown;
  proxyFailureMode?: 'direct' | 'block';
}

// Global proxy-failure policy lives inside the `transport` setting JSON
// alongside the legacy global relay/proxy keys. GET/PUT here merge only the
// proxyFailureMode field so the global relay/proxy config is never clobbered.
transportRoutes.get('/failure-mode', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const s = getSetting<TransportSetting>(db, 'transport');
    return c.json({ mode: s?.proxyFailureMode === 'block' ? 'block' : 'direct' });
  } catch (e) {
    return handleApiError(e);
  }
});

transportRoutes.put('/failure-mode', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const body = await c.req.json<{ mode?: string }>();
    if (body.mode !== 'direct' && body.mode !== 'block') {
      throw new ApiError('invalid_input', 'mode harus direct atau block', 400);
    }
    const current = getSetting<TransportSetting>(db, 'transport') ?? { relay: null, proxy: null };
    setSetting(db, 'transport', { ...current, proxyFailureMode: body.mode });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
});

const PROXY_KINDS: TransportKind[] = ['http', 'socks5'];
const RELAY_KINDS: TransportKind[] = ['vercel', 'cloudflare'];

function validateKindForType(type: TransportType, kind: string): TransportKind {
  const allowed = type === 'proxy' ? PROXY_KINDS : RELAY_KINDS;
  if (!allowed.includes(kind as TransportKind)) {
    throw new ApiError(
      'invalid_input',
      `kind must be one of ${allowed.join(', ')} for type=${type}`,
      400
    );
  }
  return kind as TransportKind;
}

function assertUrl(url: string): void {
  try {
    new URL(url);
  } catch {
    // proxies are commonly written host:port — accept if it parses with a scheme
    try {
      new URL(`http://${url}`);
    } catch {
      throw new ApiError('invalid_input', 'url is not a valid URL', 400);
    }
  }
}

transportRoutes.get('/', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const transports = listTransports(db);
    const accounts = listAccounts(db);
    const countMap = new Map<string, number>();
    for (const t of transports) {
      let count = 0;
      for (const a of accounts) {
        if (a.proxy_id === t.id || a.relay_id === t.id) {
          count++;
          continue;
        }
        const pool: string[] = a.proxy_pool ? JSON.parse(a.proxy_pool) : [];
        if (pool.includes(t.id)) count++;
      }
      countMap.set(t.id, count);
    }
    return c.json(
      transports.map((t) => ({
        id: t.id,
        label: t.label,
        type: t.type,
        kind: t.kind,
        url: t.url,
        enabled: t.enabled,
        country: t.country,
        createdAt: t.created_at,
        usageCount: countMap.get(t.id) ?? 0,
      }))
    );
  } catch (e) {
    return handleApiError(e);
  }
});

transportRoutes.post('/', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    return c.req
      .json()
      .then(async (body: { label?: string; type?: string; kind?: string; url?: string }) => {
        if (!body.label || !body.type || !body.kind || !body.url) {
          throw new ApiError('invalid_input', 'label, type, kind, url required', 400);
        }
        if (body.type !== 'proxy' && body.type !== 'relay') {
          throw new ApiError('invalid_input', "type must be 'proxy' or 'relay'", 400);
        }
        const kind = validateKindForType(body.type, body.kind);
        assertUrl(body.url);
        const t = createTransport(db, {
          id: ulid(),
          label: body.label,
          type: body.type,
          kind,
          url: body.url,
        });
        // Probe connectivity + egress country through the new transport and
        // persist the country code (e.g. 'SG'). Best-effort: a failed probe
        // leaves country NULL and still returns the created row.
        const cfg: TransportConfig =
          t.type === 'relay'
            ? { relay: { kind: t.kind as 'vercel' | 'cloudflare', url: t.url }, proxy: null }
            : { relay: null, proxy: { kind: t.kind as 'http' | 'socks5', url: t.url } };
        const geo = await checkTransportGeo(cfg);
        if (geo.country) setTransportCountry(db, t.id, geo.country);
        return c.json(
          {
            id: t.id,
            label: t.label,
            type: t.type,
            kind: t.kind,
            url: t.url,
            enabled: t.enabled,
            country: geo.country,
            active: geo.active,
          },
          201
        );
      })
      .catch((e: unknown) => handleApiError(e));
  } catch (e) {
    return handleApiError(e);
  }
});

transportRoutes.patch('/:id', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const id = c.req.param('id');
    return c.req
      .json()
      .then((body: { label?: string; kind?: string; url?: string; enabled?: boolean }) => {
        const existing = getTransport(db, id);
        if (!existing) throw new ApiError('not_found', 'transport not found', 404);
        const patch: { label?: string; kind?: TransportKind; url?: string; enabled?: boolean } = {};
        if (body.label !== undefined) patch.label = body.label;
        if (body.kind !== undefined) patch.kind = validateKindForType(existing.type, body.kind);
        if (body.url !== undefined) {
          assertUrl(body.url);
          patch.url = body.url;
        }
        if (body.enabled !== undefined) patch.enabled = body.enabled;
        if (Object.keys(patch).length === 0) {
          throw new ApiError('invalid_input', 'Nothing to update', 400);
        }
        updateTransport(db, id, patch);
        return new Response(null, { status: 204 });
      })
      .catch((e: unknown) => handleApiError(e));
  } catch (e) {
    return handleApiError(e);
  }
});

transportRoutes.post('/bulk-delete', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    return c.req
      .json()
      .then((body: { ids?: unknown }) => {
        if (!Array.isArray(body.ids) || body.ids.length === 0) {
          throw new ApiError('invalid_input', 'ids must be a non-empty array', 400);
        }
        const ids = body.ids.filter((x): x is string => typeof x === 'string');
        const deleted = deleteTransports(db, ids);
        return c.json({ deleted });
      })
      .catch((e: unknown) => handleApiError(e));
  } catch (e) {
    return handleApiError(e);
  }
});

transportRoutes.delete('/:id', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const id = c.req.param('id');
    if (!getTransport(db, id)) throw new ApiError('not_found', 'transport not found', 404);
    deleteTransport(db, id);
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
});

/**
 * Connectivity check. Sends a lightweight GET through the transport and reports
 * success + round-trip latency. A non-2xx upstream still counts as "reachable"
 * (the proxy/relay forwarded the request); only network/transport failures fail.
 */
transportRoutes.post('/:id/test', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const t = getTransport(db, c.req.param('id'));
    if (!t) throw new ApiError('not_found', 'transport not found', 404);

    const cfg: TransportConfig =
      t.type === 'relay'
        ? { relay: { kind: t.kind as 'vercel' | 'cloudflare', url: t.url }, proxy: null }
        : { relay: null, proxy: { kind: t.kind as 'http' | 'socks5', url: t.url } };

    const target = 'https://api.minimax.io/v1/models';
    const started = Date.now();
    try {
      const res = await proxyAwareFetch(
        target,
        { method: 'GET', signal: AbortSignal.timeout(8000) },
        cfg
      );
      const latencyMs = Date.now() - started;
      return c.json({ ok: true, status: res.status, latencyMs });
    } catch (err) {
      const latencyMs = Date.now() - started;
      return c.json(
        { ok: false, error: (err as Error).message || 'connection failed', latencyMs },
        200
      );
    }
  } catch (e) {
    return handleApiError(e);
  }
});
