import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { createAccount } from '../../src/db/repos/accounts.js';
import { createClientKey } from '../../src/db/repos/client_keys.js';
import { upsertModel } from '../../src/db/repos/models.js';
import { clearCache, setSetting } from '../../src/db/repos/settings.js';
import { app, resetDb } from '../../src/server.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('transport config plumbed to upstreamFetch', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'tx-')), 't.db');
    resetDb();
    clearCache();
  });

  it('routes request through relay URL when transport.relay.url is set', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 't', key: 'rk_tx' });
    createAccount(db, { id: 'acc_tx', label: 'a1', credit_type: 'payg', api_key: 'mm_test' });
    upsertModel(db, { name: 'MiniMax-M2.7', upstream_model: 'MiniMax-M2.7' });

    setSetting(db, 'transport', { relay: { url: 'https://relay.example.com/relay' }, proxy: null });
    clearCache();

    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
      );

    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mx/MiniMax-M2.7',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    await app.request(req);

    expect(spy).toHaveBeenCalledTimes(1);
    const calledUrl = spy.mock.calls[0][0] as string;
    const init = spy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    // Relay was set: request was sent to relay URL with x-relay-target header
    expect(calledUrl).toBe('https://relay.example.com/relay');
    expect(headers['x-relay-target']).toBeTruthy();
  });

  it('calls upstream directly when transport is empty (no relay/proxy)', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 't', key: 'rk_tx2' });
    createAccount(db, { id: 'acc_tx2', label: 'a1', credit_type: 'payg', api_key: 'mm_real' });
    upsertModel(db, { name: 'MiniMax-M2.7', upstream_model: 'MiniMax-M2.7' });
    setSetting(db, 'transport', { relay: null, proxy: null });
    clearCache();

    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
      );

    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ck.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mx/MiniMax-M2.7',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    await app.request(req);

    expect(spy).toHaveBeenCalledTimes(1);
    const calledUrl = spy.mock.calls[0][0] as string;
    const init = spy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    // No relay: URL is the upstream MiniMax API, no x-relay-target header
    expect(calledUrl).toMatch(/minimax|minimaxi/);
    expect(headers['x-relay-target']).toBeUndefined();
    expect(headers.Authorization).toBe('Bearer mm_real');
  });
});
