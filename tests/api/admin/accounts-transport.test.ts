import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminApi } from '../../../src/api/admin/index.js';
import { SESSION_COOKIE } from '../../../src/auth/index.js';
import { setPassword } from '../../../src/auth/password.js';
import { createSession } from '../../../src/auth/session.js';
import { migrate } from '../../../src/db/migrations/index.js';
import { createAccount } from '../../../src/db/repos/accounts.js';
import { createTransport } from '../../../src/db/repos/transports.js';

let db: Database.Database;
let dir: string;
let app: Hono;
let cookie: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'acct-tp-api-'));
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
  createAccount(db, { id: 'acc1', label: 'main', credit_type: 'payg', api_key: 'mm_1' });
  createTransport(db, { id: 'p1', label: 'p1', type: 'proxy', kind: 'http', url: 'http://p1' });
  createTransport(db, { id: 'p2', label: 'p2', type: 'proxy', kind: 'http', url: 'http://p2' });
  createTransport(db, { id: 'r1', label: 'r1', type: 'relay', kind: 'vercel', url: 'https://r1' });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true });
  vi.restoreAllMocks();
});

const headers = () => ({
  cookie,
  origin: 'http://localhost:20137',
  host: 'localhost:20137',
  'content-type': 'application/json',
});

function patch(body: Record<string, unknown>) {
  return app.request('/api/admin/accounts/acc1', {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body),
  });
}

async function getAccount() {
  const list = await (await app.request('/api/admin/accounts', { headers: headers() })).json();
  return list.find((a: { id: string }) => a.id === 'acc1');
}

describe('PATCH /api/admin/accounts/:id transport assignment', () => {
  it('assigns a single proxy', async () => {
    expect((await patch({ proxyId: 'p1' })).status).toBe(204);
    expect((await getAccount()).proxyId).toBe('p1');
  });

  it('assigns a proxy pool with rotate-every', async () => {
    expect((await patch({ proxyPool: ['p1', 'p2'], proxyRotateEvery: 10 })).status).toBe(204);
    const acc = await getAccount();
    expect(acc.proxyPool).toEqual(['p1', 'p2']);
    expect(acc.proxyRotateEvery).toBe(10);
  });

  it('assigns a relay', async () => {
    expect((await patch({ relayId: 'r1' })).status).toBe(204);
    expect((await getAccount()).relayId).toBe('r1');
  });

  it('clears assignment with empty string / empty array', async () => {
    await patch({ proxyId: 'p1' });
    expect((await patch({ proxyId: '' })).status).toBe(204);
    expect((await getAccount()).proxyId).toBeNull();
    await patch({ proxyPool: ['p1'] });
    await patch({ proxyPool: [] });
    expect((await getAccount()).proxyPool).toEqual([]);
  });

  it('rejects relay + proxy in the same request (400)', async () => {
    expect((await patch({ relayId: 'r1', proxyId: 'p1' })).status).toBe(400);
  });

  it('rejects rotateEvery < 1 (400)', async () => {
    expect((await patch({ proxyPool: ['p1'], proxyRotateEvery: 0 })).status).toBe(400);
  });
});
