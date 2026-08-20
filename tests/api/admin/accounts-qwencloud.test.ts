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

let db: Database.Database;
let dir: string;
let app: Hono;
let cookie: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'acct-qc-api-'));
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

const postHeaders = () => ({
  cookie,
  origin: 'http://localhost:20137',
  host: 'localhost:20137',
  'content-type': 'application/json',
});

describe('POST /api/admin/accounts — qwencloud default credit_type', () => {
  it('defaults qwencloud accounts to credit_type=token-plan when body omits it', async () => {
    const res = await app.request('/api/admin/accounts', {
      method: 'POST',
      headers: postHeaders(),
      body: JSON.stringify({
        provider: 'qwencloud',
        label: 'qc-default',
        api_key: 'sk-sp-test',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; creditType: string };
    expect(body.creditType).toBe('token-plan');

    const row = db.prepare('SELECT credit_type FROM accounts WHERE id = ?').get(body.id) as {
      credit_type: string;
    };
    expect(row.credit_type).toBe('token-plan');
  });

  it('honors an explicit credit_type when provided for qwencloud', async () => {
    const res = await app.request('/api/admin/accounts', {
      method: 'POST',
      headers: postHeaders(),
      body: JSON.stringify({
        provider: 'qwencloud',
        label: 'qc-explicit',
        api_key: 'sk-sp-test-2',
        credit_type: 'payg',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; creditType: string };
    expect(body.creditType).toBe('payg');
  });

  it('accepts qwencloud in the provider allowlist', async () => {
    const res = await app.request('/api/admin/accounts', {
      method: 'POST',
      headers: postHeaders(),
      body: JSON.stringify({
        provider: 'qwencloud',
        label: 'qc-allowlist',
        api_key: 'sk-sp-test-3',
      }),
    });
    expect(res.status).toBe(201);
  });
});
