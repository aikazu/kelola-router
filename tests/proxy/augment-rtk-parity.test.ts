import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { createAccount } from '../../src/db/repos/accounts.js';
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
