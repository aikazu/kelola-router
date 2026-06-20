import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { createAccount, updateAccount } from '../../src/db/repos/accounts.js';
import { createClientKey, genClientKey } from '../../src/db/repos/client_keys.js';
import { enableModel, upsertModel } from '../../src/db/repos/models.js';
import { flushDeferredLogs } from '../../src/db/repos/requestLogs.js';
import { setSetting } from '../../src/db/repos/settings.js';
import { app, resetDb } from '../../src/server.js';

let key: string;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aug-'));
  process.env.ROUTER_DB_PATH = join(dir, 't.db');
  resetDb();
  const db = openDb();
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
  // Notion: seed model + account with the full NOTION_AI_COOKIE_NAMES set
  // (11 cookies, see src/providers/notion/constants.ts). Without all 11 the
  // handler short-circuits to a 401 'notion_reauth_required' before augment.
  // Model name is namespaced as `notion/notion` so resolveModel's namespaced
  // fallback finds it when the client requests `nt/notion`.
  upsertModel(db, {
    name: 'notion/notion',
    upstream_model: 'notion',
    provider: 'notion',
  });
  enableModel(db, 'notion/notion');
  createAccount(db, {
    id: 'notion1',
    label: 'notion',
    credit_type: 'payg',
    api_key: 'notion_key',
    provider: 'notion',
    provider_data: JSON.stringify({
      cookies: Object.fromEntries(
        [
          'device_id',
          'notion_browser_id',
          'notion_check_cookie_consent',
          'notion_user_id',
          'notion_sync_user_id',
          'NEXT_LOCALE',
          'p_sync_session',
          '_cioid',
          'notion_locale',
          'notion_users',
          'token_v2',
        ].map((n) => [n, 'val'])
      ),
      spaceId: 'sp1',
    }),
  });
  key = genClientKey();
  createClientKey(db, { label: 'app', key });
  db.close();
});
afterEach(async () => {
  await flushDeferredLogs();
  vi.restoreAllMocks();
  resetDb();
  if (dir) rmSync(dir, { recursive: true, force: true });
  delete process.env.ROUTER_DB_PATH;
});

describe('augment/RTK parity (codebuddy)', () => {
  it('applies caveman augment before calling the codebuddy upstream', async () => {
    const db = openDb();
    // 'terse' level injects the recognizable string "Be concise." via augmentRequest.
    // 'lite' is not a valid CavemanLevel — the proxy would treat it like 'off'.
    setSetting(db, 'caveman', { level: 'terse' });
    setSetting(db, 'caching', { autoBreakpoints: false });
    setSetting(db, 'rtk', { enabled: false });
    db.close();
    let sentBody = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, opts) => {
      sentBody = (opts?.body as string) ?? '';
      return Promise.resolve(
        new Response(
          JSON.stringify({
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'cb/claude-opus',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    expect(res.status).toBe(200);
    // Caveman 'terse' injects "Be concise." — the augmentation must have run
    // in the codebuddy handler (otherwise the body only has codebuddy's default
    // "You are a helpful assistant." preamble).
    const parsed = JSON.parse(sentBody);
    const messages = parsed.messages as Array<{ role: string; content: string }>;
    const systemMsg = messages.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('Be concise.');
  });
});

describe('augment/RTK parity (pioneer)', () => {
  it('applies caveman augment before calling the pioneer upstream', async () => {
    const db = openDb();
    setSetting(db, 'caveman', { level: 'terse' });
    setSetting(db, 'caching', { autoBreakpoints: false });
    setSetting(db, 'rtk', { enabled: false });
    db.close();
    let sentBody = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, opts) => {
      sentBody = (opts?.body as string) ?? '';
      return Promise.resolve(
        new Response(
          JSON.stringify({
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'pio/claude-opus',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    expect(res.status).toBe(200);
    expect(sentBody).toContain('Be concise.');
  });
});

describe('augment/RTK parity (zai)', () => {
  it('applies caveman augment before calling the zai upstream', async () => {
    const db = openDb();
    setSetting(db, 'caveman', { level: 'terse' });
    setSetting(db, 'caching', { autoBreakpoints: false });
    setSetting(db, 'rtk', { enabled: false });
    db.close();
    let sentBody = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, opts) => {
      sentBody = (opts?.body as string) ?? '';
      return Promise.resolve(
        new Response(
          JSON.stringify({
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'zai/glm-5.2',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    expect(res.status).toBe(200);
    expect(sentBody).toContain('Be concise.');
  });
});

describe('augment/RTK parity (kiro)', () => {
  it('applies caveman augment before calling the kiro upstream', async () => {
    const db = openDb();
    setSetting(db, 'caveman', { level: 'terse' });
    setSetting(db, 'caching', { autoBreakpoints: false });
    setSetting(db, 'rtk', { enabled: false });
    db.close();
    let sentBody = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, opts) => {
      sentBody = opts.body as string;
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
        model: 'kr/claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    expect(res.status).toBe(200);
    await res.text();
    expect(sentBody).toContain('Be concise.');
  });
});

describe('augment/RTK parity (notion)', () => {
  it('runs caveman augment on the notion-bound messages', async () => {
    const db = openDb();
    setSetting(db, 'caveman', { level: 'terse' });
    setSetting(db, 'caching', { autoBreakpoints: false });
    setSetting(db, 'rtk', { enabled: false });
    db.close();
    // Spy BEFORE the request so the call is observed. Notion's wire payload
    // shape is opaque NDJSON, so we cannot assert on body strings here —
    // augmentRequest being called is the canonical signal.
    const cacheMod = await import('../../src/cache-injection.js');
    const augSpy = vi.spyOn(cacheMod, 'augmentRequest');
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response('data: {"text":"hi"}\n', {
          status: 200,
          headers: { 'content-type': 'application/x-ndjson' },
        })
    );
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'nt/notion',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    expect(res.status).toBe(200);
    await res.text();
    expect(augSpy).toHaveBeenCalled();
  });
});
