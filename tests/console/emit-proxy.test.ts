// tests/console/emit-proxy.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('handleProxy emits flow events', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'kr-')), 't.db');
  });
  afterEach(async () => {
    const { resetDb } = await import('../../src/server.js');
    resetDb();
    vi.restoreAllMocks();
    delete process.env.ROUTER_DB_PATH;
  });

  it('emits start and done for a proxied request', async () => {
    const { app, resetDb } = await import('../../src/server.js');
    resetDb();
    const { openDb } = await import('../../src/db/index.js');
    const { createAccount } = await import('../../src/db/repos/accounts.js');
    const { createClientKey, genClientKey } = await import('../../src/db/repos/client_keys.js');
    const db = openDb();
    const key = genClientKey();
    createClientKey(db, { label: 'test', key });
    createAccount(db, { label: 'acct1', api_key: 'mm_x', credit_type: 'payg' });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    );

    const { consoleBus } = await import('../../src/console/bus.js');
    const seen: string[] = [];
    const off = consoleBus.subscribe((e) => seen.push(e.phase));

    await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
      body: JSON.stringify({ model: 'MiniMax-M2', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const { flushDeferredLogs } = await import('../../src/db/repos/requestLogs.js');
    await flushDeferredLogs();
    off();
    expect(seen).toContain('start');
    expect(seen).toContain('done');
  });
});
