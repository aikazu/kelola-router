import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setModelLock } from '../../src/accounts/locks.js';
import { _resetRateLimitForTests as resetRateLimit } from '../../src/auth/rateLimit.js';
import { openDb } from '../../src/db/index.js';
import { createAccount } from '../../src/db/repos/accounts.js';
import { upsertAlias } from '../../src/db/repos/aliases.js';
import { createClientKey } from '../../src/db/repos/client_keys.js';
import { enableModel, upsertModel } from '../../src/db/repos/models.js';
import { flushDeferredLogs, recentLogs } from '../../src/db/repos/requestLogs.js';
import { clearCache, setSetting } from '../../src/db/repos/settings.js';
import { clearAliasCache } from '../../src/providers/aliasCache.js';
import { app, resetDb } from '../../src/server.js';

let dir: string;
let clientKey: string;

beforeEach(() => {
  resetRateLimit();
  dir = mkdtempSync(join(tmpdir(), 'proxy-alias-'));
  process.env.ROUTER_DB_PATH = join(dir, 't.db');
  resetDb();
  clearCache();
  const db = openDb();
  upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3' });
  enableModel(db, 'MiniMax-M3');
  createAccount(db, { id: 'acc1', label: 't', credit_type: 'payg', api_key: 'mm_test' });
  const ck = createClientKey(db, { label: 't', key: 'ck_test_123' });
  clientKey = ck.key;
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
    /* Windows may hold a transient lock on the WAL file; temp dir is auto-cleaned */
  }
  delete process.env.ROUTER_DB_PATH;
});

const chatBody = (model: string) => ({
  model,
  messages: [{ role: 'user', content: 'hi' }],
  stream: false,
});

const okUpstream = () =>
  new Response(
    JSON.stringify({
      id: 'x',
      model: 'MiniMax-M3',
      choices: [{ message: { role: 'assistant', content: 'ok' }, index: 0, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { headers: { 'content-type': 'application/json' } }
  );

describe('proxy with alias', () => {
  it('resolves alias → upstream and logs both names', async () => {
    const db = openDb();
    upsertAlias(db, { aliasName: 'claude-opus-4-8', upstreamModel: 'MiniMax-M3' });
    clearAliasCache();

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okUpstream());

    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${clientKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(chatBody('claude-opus-4-8')),
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await flushDeferredLogs();
    const logs = recentLogs(db, { limit: 1 });
    expect(logs[0]?.model).toBe('MiniMax-M3');
    expect((logs[0] as any)?.requested_model).toBe('claude-opus-4-8');
  });

  it('returns 400 for unknown alias target', async () => {
    const db = openDb();
    // FK on model_aliases.upstream_model requires the value to exist in models(upstream_model).
    // Insert a phantom model with that upstream_model so the FK passes, but the proxy will
    // still 400 because getModel(db, 'does-not-exist') looks up by models.name, not upstream_model.
    upsertModel(db, { name: 'phantom', upstream_model: 'does-not-exist', enabled: 0 });
    upsertAlias(db, { aliasName: 'broken', upstreamModel: 'does-not-exist' });
    clearAliasCache();
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${clientKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(chatBody('broken')),
    });
    const res = await app.request(req);
    expect(res.status).toBe(400);
  });

  it('lock on upstream model blocks requests sent via alias', async () => {
    const db = openDb();
    upsertAlias(db, { aliasName: 'opus', upstreamModel: 'MiniMax-M3' });
    clearAliasCache();
    setModelLock(db, 'acc1', 'MiniMax-M3', 60_000);
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${clientKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(chatBody('opus')),
    });
    const res = await app.request(req);
    expect(res.status).toBe(429);
  });

  it('cache invalidation: new alias works immediately after POST', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okUpstream());

    // First request: no alias yet, fails with 400
    const r1 = await app.request(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${clientKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(chatBody('new-alias')),
      })
    );
    expect(r1.status).toBe(400);

    // Create alias via API (which calls clearAliasCache)
    await app.request(
      new Request('http://localhost/api/admin/aliases', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${clientKey}`,
          'content-type': 'application/json',
          origin: 'http://localhost:20137',
          host: 'localhost:20137',
        },
        body: JSON.stringify({ aliasName: 'new-alias', upstreamModel: 'MiniMax-M3' }),
      })
    );

    // Second request: should now work without TTL wait
    const r2 = await app.request(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${clientKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(chatBody('new-alias')),
      })
    );
    expect(r2.status).toBe(200);
  });
});
