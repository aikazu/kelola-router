import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { createAccount } from '../../src/db/repos/accounts.js';
import { createClientKey } from '../../src/db/repos/client_keys.js';
import { upsertModel } from '../../src/db/repos/models.js';
import { clearCache, setSetting } from '../../src/db/repos/settings.js';
import { clearAliasCache } from '../../src/providers/aliasCache.js';
import { _resetSelectionCursorForTests, app, resetDb } from '../../src/server.js';

/**
 * Regression: cross-provider account leak.
 *
 * Previously `handleProxy` (the MiniMax path) called `listEnabledAccounts`,
 * which returns rows from EVERY provider. Under sticky selection a client key
 * that had just been pinned to a Pioneer account would then see that same
 * Pioneer account picked for a MiniMax model — sending a MiniMax request
 * upstream with a Pioneer api_key.
 *
 * The fix filters the MiniMax pool to `provider='minimax'` only.
 */
let dir: string;
let clientKey: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xprovider-'));
  process.env.ROUTER_DB_PATH = join(dir, 't.db');
  resetDb();
  clearCache();
  _resetSelectionCursorForTests();
  const db = openDb();
  // One MiniMax account + one Pioneer account. Sticky selection will pin the
  // first-requested account; if the leak existed, a MiniMax request after a
  // Pioneer request reuses the Pioneer account.
  createAccount(db, { id: 'mm1', label: 'minimax-a', credit_type: 'payg', api_key: 'mm_KEY' });
  createAccount(db, {
    id: 'pio1',
    label: 'pioneer-a',
    credit_type: 'payg',
    api_key: 'pio_KEY',
    provider: 'pioneer',
    base_url: 'https://api.pioneer.ai',
  });
  // MiniMax model + namespaced Pioneer model.
  upsertModel(db, {
    name: 'MiniMax-M3',
    upstream_model: 'MiniMax-M3',
    provider: 'minimax',
    family: 'm3',
    enabled: 1,
  });
  upsertModel(db, {
    name: 'pioneer/claude-opus-4-8',
    upstream_model: 'claude-opus-4-8',
    provider: 'pioneer',
    family: 'pioneer',
    enabled: 1,
  });
  const ck = createClientKey(db, { label: 't', key: 'ck_xp_1' });
  clientKey = ck.key;
  // Sticky so the leak is deterministic: first request pins an account.
  setSetting(db, 'selection.minimax', { mode: 'sticky', step: 1 });
  setSetting(db, 'selection.pioneer', { mode: 'sticky', step: 1 });
  setSetting(db, 'transport', { relay: null, proxy: null });
  clearCache();
  clearAliasCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetDb();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows WAL lock; temp dir auto-cleaned */
  }
  delete process.env.ROUTER_DB_PATH;
});

const okOpenAI = () =>
  new Response(
    JSON.stringify({
      id: 'x',
      model: 'm',
      choices: [{ message: { role: 'assistant', content: 'ok' }, index: 0, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { headers: { 'content-type': 'application/json' } }
  );

describe('cross-provider account leak (sticky)', () => {
  it('uses the minimax account for a minimax model after a pioneer request', async () => {
    const seenKeys: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      // Capture the Authorization header (MiniMax) or X-API-Key (Pioneer).
      const headers =
        init?.headers instanceof Headers
          ? init.headers
          : new Headers((init?.headers ?? {}) as Record<string, string>);
      const auth = headers.get('authorization') ?? '';
      const apiKey = headers.get('x-api-key') ?? '';
      seenKeys.push(auth || apiKey);
      return okOpenAI();
    });

    // 1) Pioneer request — pins account 'pio1' under this client key.
    let res = await app.request(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${clientKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'pio/claude-opus-4-8',
          messages: [{ role: 'user', content: 'hi' }],
          stream: false,
        }),
      })
    );
    expect(res.status).toBe(200);

    // 2) Switch to a MiniMax model — MUST use the minimax account, not pio1.
    res = await app.request(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${clientKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'mx/MiniMax-M3',
          messages: [{ role: 'user', content: 'hi' }],
          stream: false,
        }),
      })
    );
    expect(res.status).toBe(200);

    // First call = pioneer (X-API-Key: pio_KEY), second = minimax (Bearer mm_KEY).
    expect(seenKeys).toHaveLength(2);
    expect(seenKeys[1]).toContain('mm_KEY');
    expect(seenKeys[1]).not.toContain('pio_KEY');
  });

  it('uses the pioneer account for a pioneer model after a minimax request', async () => {
    const seenKeys: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const headers =
        init?.headers instanceof Headers
          ? init.headers
          : new Headers((init?.headers ?? {}) as Record<string, string>);
      seenKeys.push(headers.get('authorization') ?? headers.get('x-api-key') ?? '');
      return okOpenAI();
    });

    // 1) MiniMax first — pins 'mm1'.
    let res = await app.request(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${clientKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'mx/MiniMax-M3',
          messages: [{ role: 'user', content: 'hi' }],
          stream: false,
        }),
      })
    );
    expect(res.status).toBe(200);

    // 2) Switch to Pioneer — MUST use the pioneer account, not mm1.
    res = await app.request(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${clientKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'pio/claude-opus-4-8',
          messages: [{ role: 'user', content: 'hi' }],
          stream: false,
        }),
      })
    );
    expect(res.status).toBe(200);

    expect(seenKeys).toHaveLength(2);
    expect(seenKeys[1]).toContain('pio_KEY');
    expect(seenKeys[1]).not.toContain('mm_KEY');
  });
});
