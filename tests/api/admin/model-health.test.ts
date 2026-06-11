import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminApi } from '../../../src/api/admin/index.js';
import { SESSION_COOKIE } from '../../../src/auth.js';
import { setPassword } from '../../../src/auth/password.js';
import { createSession } from '../../../src/auth/session.js';
import { migrate } from '../../../src/db/migrations/index.js';
import { createAccount, updateAccount } from '../../../src/db/repos/accounts.js';
import { upsertModel } from '../../../src/db/repos/models.js';

let db: Database.Database;
let dir: string;
let app: Hono;
let cookie: string;

/** AWS event-stream frame with zeroed CRCs — mirrors tests/integration/proxy-kiro.test.ts. */
function frame(eventType: string, payload: unknown): Uint8Array {
  const enc = new TextEncoder();
  const name = enc.encode(':event-type');
  const value = enc.encode(eventType);
  const headerLen = 1 + name.length + 1 + 2 + value.length;
  const header = new Uint8Array(headerLen);
  const hv = new DataView(header.buffer);
  let o = 0;
  header[o++] = name.length;
  header.set(name, o);
  o += name.length;
  header[o++] = 7; // value type 7 = string
  hv.setUint16(o, value.length);
  o += 2;
  header.set(value, o);
  const body = enc.encode(JSON.stringify(payload));
  const total = 12 + headerLen + body.length + 4;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, total);
  dv.setUint32(4, headerLen);
  buf.set(header, 12);
  buf.set(body, 12 + headerLen);
  return buf;
}

function kiroStream(frames: Uint8Array[]): Uint8Array {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const f of frames) {
    out.set(f, off);
    off += f.length;
  }
  return out;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'model-health-'));
  db = new Database(join(dir, 't.db'));
  db.pragma('foreign_keys = ON');
  migrate(db);
  upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3', provider: 'minimax' });
  upsertModel(db, { name: 'claude-sonnet-4-5', upstream_model: 'claude-sonnet-4-5', provider: 'kiro' });
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

const authed = () => ({ cookie, host: 'localhost:20137' });
const postHeaders = () => ({ ...authed(), origin: 'http://localhost:20137' });

const addMinimaxAccount = () =>
  createAccount(db, { id: 'mm1', label: 'mm', credit_type: 'payg', api_key: 'mm_key' });

const addKiroAccount = () => {
  createAccount(db, {
    id: 'k1',
    label: 'kiro',
    credit_type: 'payg',
    api_key: 'refresh_tok',
    provider: 'kiro',
    provider_data: JSON.stringify({ authMethod: 'social' }),
  });
  // Fresh access token so ensureAccessToken skips the refresh call.
  updateAccount(db, 'k1', {
    access_token: 'at_fresh',
    token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
  });
};

const testModel = (name: string) =>
  app.request(`/api/admin/models/${encodeURIComponent(name)}/test`, {
    method: 'POST',
    headers: postHeaders(),
  });

describe('POST /api/admin/models/:name/test', () => {
  it('minimax: ok on healthy upstream', async () => {
    addMinimaxAccount();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'pong' } }],
            base_resp: { status_code: 0, status_msg: 'ok' },
          }),
          { headers: { 'content-type': 'application/json' } }
        )
    );
    const res = await testModel('MiniMax-M3');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; latencyMs: number };
    expect(json.ok).toBe(true);
    expect(json.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('minimax: base_resp error inside HTTP 200 reports failure', async () => {
    addMinimaxAccount();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ base_resp: { status_code: 1008, status_msg: 'insufficient balance' } }), {
          headers: { 'content-type': 'application/json' },
        })
    );
    const res = await testModel('MiniMax-M3');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; error?: string };
    expect(json.ok).toBe(false);
    expect(json.error).toContain('1008');
  });

  it('minimax: HTTP error reports failure', async () => {
    addMinimaxAccount();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('upstream boom', { status: 500 })
    );
    const res = await testModel('MiniMax-M3');
    const json = (await res.json()) as { ok: boolean; error?: string };
    expect(json.ok).toBe(false);
    expect(json.error).toBeTruthy();
  });

  it('kiro: ok on healthy binary stream', async () => {
    addKiroAccount();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          kiroStream([
            frame('assistantResponseEvent', { content: 'pong' }),
            frame('messageStopEvent', {}),
          ]),
          { headers: { 'content-type': 'application/vnd.amazon.eventstream' } }
        )
    );
    const res = await testModel('claude-sonnet-4-5');
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it('fails cleanly when provider has no enabled account', async () => {
    // No accounts created.
    const res = await testModel('MiniMax-M3');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; error?: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/account/i);
  });

  it('404 for unknown model', async () => {
    const res = await testModel('nope');
    expect(res.status).toBe(404);
  });
});
