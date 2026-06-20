import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { createAccount, updateAccount } from '../../src/db/repos/accounts.js';
import { createClientKey, genClientKey } from '../../src/db/repos/client_keys.js';
import { enableModel, upsertModel } from '../../src/db/repos/models.js';
import { flushDeferredLogs, recentLogs } from '../../src/db/repos/requestLogs.js';
import { setSetting } from '../../src/db/repos/settings.js';
import { app, resetDb } from '../../src/server.js';

// Shared per-test scratch state. Per-provider describes (e.g. A2-A5 for kiro/zai/etc.)
// may append additional `beforeEach` blocks scoped to their own describe to add provider-specific
// accounts/models without fighting over `key` / `dir`.
let key: string;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tt-mm-'));
  process.env.ROUTER_DB_PATH = join(dir, 't.db');
  resetDb();
  const db = openDb();
  upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3' });
  setSetting(db, 'caveman', { level: 'off' });
  setSetting(db, 'caching', { autoBreakpoints: false });
  setSetting(db, 'rtk', { enabled: false });
  setSetting(db, 'minimax', { upstreamFormat: 'openai' });
  setSetting(db, 'transport', { relay: null, proxy: null });
  createAccount(db, { id: 'acc_1', label: 'a', credit_type: 'payg', api_key: 'mm_x' });
  key = genClientKey();
  createClientKey(db, { label: 'app', key });
  upsertModel(db, {
    name: 'claude-sonnet-4-5',
    upstream_model: 'claude-sonnet-4-5',
    provider: 'kiro',
  });
  enableModel(db, 'claude-sonnet-4-5');
  createAccount(db, {
    id: 'kiro1',
    label: 'k',
    credit_type: 'payg',
    api_key: 'refresh_tok',
    provider: 'kiro',
    provider_data: JSON.stringify({ authMethod: 'social' }),
  });
  updateAccount(db, 'kiro1', {
    access_token: 'at_fresh',
    token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
  });
  upsertModel(db, {
    name: 'codebuddy/claude-opus',
    upstream_model: 'codebuddy/claude-opus',
    provider: 'codebuddy',
  });
  enableModel(db, 'codebuddy/claude-opus');
  createAccount(db, {
    id: 'cb1',
    label: 'cb',
    credit_type: 'payg',
    api_key: 'cb_key',
    provider: 'codebuddy',
  });
  upsertModel(db, {
    name: 'pioneer/claude-opus',
    upstream_model: 'pioneer/claude-opus',
    provider: 'pioneer',
  });
  enableModel(db, 'pioneer/claude-opus');
  createAccount(db, {
    id: 'pio1',
    label: 'pio',
    credit_type: 'payg',
    api_key: 'pio_key',
    provider: 'pioneer',
  });
  upsertModel(db, {
    name: 'zai/glm-5.2',
    upstream_model: 'zai/glm-5.2',
    provider: 'zai',
  });
  enableModel(db, 'zai/glm-5.2');
  createAccount(db, {
    id: 'zai1',
    label: 'zai',
    credit_type: 'payg',
    api_key: 'zai_key',
    provider: 'zai',
  });
  db.close();
});
afterEach(async () => {
  await flushDeferredLogs();
  vi.restoreAllMocks();
  resetDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.ROUTER_DB_PATH;
});

describe('transport-throw logging (minimax)', () => {
  it('writes a 502 request_log row when upstream fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('getaddrinfo ENOTFOUND upstream.example');
    });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'mx/MiniMax-M3',
        messages: [{ role: 'user', content: 'hi' }],
        thinking: { type: 'adaptive' },
        max_completion_tokens: 131072,
        reasoning_split: true,
      }),
    });
    expect(res.status).toBe(502);
    await flushDeferredLogs();
    const db = openDb();
    const logs = recentLogs(db, { limit: 1 });
    db.close();
    expect(logs[0]?.status_code).toBe(502);
    expect(logs[0]?.model).toBe('MiniMax-M3');
    expect(logs[0]?.prompt_tokens).toBe(0);
  });
});

describe('transport-throw logging (kiro)', () => {
  it('writes a 502 request_log row when kiro fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('ECONNREFUSED kiro-upstream');
    });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'kr/claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect(res.status).toBe(502);
    await flushDeferredLogs();
    const db = openDb();
    const logs = recentLogs(db, { limit: 5 });
    db.close();
    const row = logs.find((l) => l.account_id === 'kiro1');
    expect(row?.status_code).toBe(502);
    expect(row?.model).toBe('claude-sonnet-4-5');
  });
});

describe('transport-throw logging (codebuddy)', () => {
  it('writes a 502 request_log row when codebuddy fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('ECONNRESET codebuddy-upstream');
    });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'cb/claude-opus',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect(res.status).toBe(502);
    await flushDeferredLogs();
    const db = openDb();
    const logs = recentLogs(db, { limit: 10 });
    db.close();
    const row = logs.find((l) => l.account_id === 'cb1');
    expect(row?.status_code).toBe(502);
    expect(row?.model).toBe('codebuddy/claude-opus');
  });
});

describe('transport-throw logging (pioneer)', () => {
  it('writes a 502 request_log row when pioneer fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('ETIMEDOUT pioneer-upstream');
    });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'pio/claude-opus',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect(res.status).toBe(502);
    await flushDeferredLogs();
    const db = openDb();
    const logs = recentLogs(db, { limit: 10 });
    db.close();
    const row = logs.find((l) => l.account_id === 'pio1');
    expect(row?.status_code).toBe(502);
  });
});

describe('transport-throw logging (zai)', () => {
  it('writes a 502 request_log row when zai fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('ENOTFOUND zai-upstream');
    });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'zai/glm-5.2',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect(res.status).toBe(502);
    await flushDeferredLogs();
    const db = openDb();
    const logs = recentLogs(db, { limit: 10 });
    db.close();
    const row = logs.find((l) => l.account_id === 'zai1');
    expect(row?.status_code).toBe(502);
  });
});

describe('AbortSignal threading (minimax stream)', () => {
  it('forwards c.req.raw.signal to the upstream fetch on a streaming request', async () => {
    const seen: { signal?: AbortSignal } = {};
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, opts) => {
      seen.signal = (opts as RequestInit).signal;
      return Promise.resolve(
        new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      );
    });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'mx/MiniMax-M3',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
        thinking: { type: 'adaptive' },
        max_completion_tokens: 131072,
        reasoning_split: true,
      }),
    });
    expect(res.status).toBe(200);
    await res.text();
    expect(seen.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('AbortSignal threading (kiro stream)', () => {
  it('forwards c.req.raw.signal to the kiro upstream fetch on stream', async () => {
    const seen: { signal?: AbortSignal } = {};
    const HELLO = vi.fn(() =>
      Promise.resolve(
        new Response('data: [DONE]\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      )
    );
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, opts) => {
      seen.signal = (opts as RequestInit).signal;
      return HELLO();
    });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'kr/claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    await res.text();
    expect(seen.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('AbortSignal threading (codebuddy openai stream)', () => {
  it('forwards c.req.raw.signal to pipeWithUsage upstream', async () => {
    const seen: { signal?: AbortSignal } = {};
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, opts) => {
      seen.signal = (opts as RequestInit).signal;
      return Promise.resolve(
        new Response('data: [DONE]\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      );
    });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'cb/claude-opus',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    await res.text();
    expect(seen.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('AbortSignal threading (pioneer openai stream)', () => {
  it('forwards c.req.raw.signal to pipeWithUsage upstream', async () => {
    const seen: { signal?: AbortSignal } = {};
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, opts) => {
      seen.signal = (opts as RequestInit).signal;
      return Promise.resolve(
        new Response('data: [DONE]\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      );
    });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'pio/claude-opus',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    await res.text();
    expect(seen.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('AbortSignal threading (zai openai stream)', () => {
  it('forwards c.req.raw.signal to pipeWithUsage upstream', async () => {
    const seen: { signal?: AbortSignal } = {};
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, opts) => {
      seen.signal = (opts as RequestInit).signal;
      return Promise.resolve(
        new Response('data: [DONE]\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      );
    });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'zai/glm-5.2',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    await res.text();
    expect(seen.signal).toBeInstanceOf(AbortSignal);
  });
});
