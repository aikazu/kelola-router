import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminApi } from '../../../src/api/admin/index.js';
import { setPassword } from '../../../src/auth/password.js';
import { createSession } from '../../../src/auth/session.js';
import { SESSION_COOKIE } from '../../../src/auth.js';
import { migrate } from '../../../src/db/migrations/index.js';

let db: Database.Database;
let dir: string;
let app: Hono;
let cookie: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'transport-api-'));
  db = new Database(join(dir, 't.db'));
  db.pragma('foreign_keys = ON');
  migrate(db);
  setPassword(db, 'testpass');
  const sess = createSession(db);
  cookie = `${SESSION_COOKIE}=${sess.id}`;
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.route('/api', adminApi());
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true });
  vi.restoreAllMocks();
});

const baseHeaders = () => ({
  cookie,
  origin: 'http://localhost:20137',
  host: 'localhost:20137',
  'content-type': 'application/json',
});

async function createProxy(body: Record<string, unknown>) {
  return app.request('/api/admin/transports', {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify(body),
  });
}

describe('GET /api/admin/transports', () => {
  it('returns empty list initially', async () => {
    const res = await app.request('/api/admin/transports', { headers: baseHeaders() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe('POST /api/admin/transports', () => {
  it('creates a proxy (201)', async () => {
    const res = await createProxy({
      label: 'home',
      type: 'proxy',
      kind: 'socks5',
      url: 'socks5://127.0.0.1:1080',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.type).toBe('proxy');
    expect(body.kind).toBe('socks5');
    expect(body.enabled).toBe(true);
  });

  it('creates a relay (201)', async () => {
    const res = await createProxy({
      label: 'vercel',
      type: 'relay',
      kind: 'vercel',
      url: 'https://relay.vercel.app',
    });
    expect(res.status).toBe(201);
    expect((await res.json()).type).toBe('relay');
  });

  it('rejects missing fields (400)', async () => {
    const res = await createProxy({ label: 'x', type: 'proxy' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid type (400)', async () => {
    const res = await createProxy({ label: 'x', type: 'tunnel', kind: 'http', url: 'http://x' });
    expect(res.status).toBe(400);
  });

  it('rejects kind that does not match type (400)', async () => {
    const res = await createProxy({ label: 'x', type: 'proxy', kind: 'vercel', url: 'http://x' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid url (400)', async () => {
    const res = await createProxy({ label: 'x', type: 'proxy', kind: 'http', url: 'not a url !!' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/admin/transports/:id', () => {
  it('updates label and enabled', async () => {
    const created = await (
      await createProxy({ label: 'a', type: 'proxy', kind: 'http', url: 'http://a' })
    ).json();
    const res = await app.request(`/api/admin/transports/${created.id}`, {
      method: 'PATCH',
      headers: baseHeaders(),
      body: JSON.stringify({ label: 'b', enabled: false }),
    });
    expect(res.status).toBe(204);
    const list = await (
      await app.request('/api/admin/transports', { headers: baseHeaders() })
    ).json();
    expect(list[0].label).toBe('b');
    expect(list[0].enabled).toBe(false);
  });

  it('returns 404 for missing transport', async () => {
    const res = await app.request('/api/admin/transports/ghost', {
      method: 'PATCH',
      headers: baseHeaders(),
      body: JSON.stringify({ label: 'x' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/transports/:id', () => {
  it('returns 204 and removes the row', async () => {
    const created = await (
      await createProxy({ label: 'a', type: 'proxy', kind: 'http', url: 'http://a' })
    ).json();
    const del = await app.request(`/api/admin/transports/${created.id}`, {
      method: 'DELETE',
      headers: baseHeaders(),
    });
    expect(del.status).toBe(204);
    const list = await (
      await app.request('/api/admin/transports', { headers: baseHeaders() })
    ).json();
    expect(list).toHaveLength(0);
  });

  it('returns 404 for missing transport', async () => {
    const res = await app.request('/api/admin/transports/ghost', {
      method: 'DELETE',
      headers: baseHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/transports/:id/test', () => {
  it('reports ok + latency when fetch succeeds', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const created = await (
      await createProxy({ label: 'r', type: 'relay', kind: 'vercel', url: 'https://relay.app' })
    ).json();
    const res = await app.request(`/api/admin/transports/${created.id}/test`, {
      method: 'POST',
      headers: baseHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe(200);
    expect(typeof body.latencyMs).toBe('number');
  });

  it('reports ok:false when fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const created = await (
      await createProxy({ label: 'r', type: 'relay', kind: 'vercel', url: 'https://relay.app' })
    ).json();
    const res = await app.request(`/api/admin/transports/${created.id}/test`, {
      method: 'POST',
      headers: baseHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('ECONNREFUSED');
  });

  it('returns 404 for missing transport', async () => {
    const res = await app.request('/api/admin/transports/ghost/test', {
      method: 'POST',
      headers: baseHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

describe('CSRF on /api/admin/transports', () => {
  it('rejects cross-origin POST (403)', async () => {
    const res = await app.request('/api/admin/transports', {
      method: 'POST',
      headers: { ...baseHeaders(), origin: 'https://evil.example' },
      body: JSON.stringify({ label: 'x', type: 'proxy', kind: 'http', url: 'http://x' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('proxy failure mode', () => {
  it("defaults to 'direct'", async () => {
    const res = await app.request('/api/admin/transports/failure-mode', {
      headers: baseHeaders(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: 'direct' });
  });

  it("persists 'block' and reads it back without clobbering proxy/relay config", async () => {
    // seed an existing transport setting (migration sets {relay:null,proxy:null})
    const put = await app.request('/api/admin/transports/failure-mode', {
      method: 'PUT',
      headers: baseHeaders(),
      body: JSON.stringify({ mode: 'block' }),
    });
    expect(put.status).toBe(204);

    const res = await app.request('/api/admin/transports/failure-mode', {
      headers: baseHeaders(),
    });
    expect(await res.json()).toEqual({ mode: 'block' });

    // global relay/proxy keys preserved
    const raw = db.prepare(`SELECT value FROM settings WHERE key = 'transport'`).get() as {
      value: string;
    };
    const parsed = JSON.parse(raw.value);
    expect(parsed.proxyFailureMode).toBe('block');
    expect('relay' in parsed).toBe(true);
    expect('proxy' in parsed).toBe(true);
  });

  it('rejects invalid mode (400)', async () => {
    const res = await app.request('/api/admin/transports/failure-mode', {
      method: 'PUT',
      headers: baseHeaders(),
      body: JSON.stringify({ mode: 'nonsense' }),
    });
    expect(res.status).toBe(400);
  });
});
