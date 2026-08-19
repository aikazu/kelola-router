import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { createAccount } from '../../src/db/repos/accounts.js';
import { createClientKey, genClientKey } from '../../src/db/repos/client-keys.js';
import { upsertModel } from '../../src/db/repos/models.js';
import { flushDeferredLogs } from '../../src/db/repos/request-logs.js';
import { setSetting } from '../../src/db/repos/settings.js';
import { app, resetDb } from '../../src/server.js';

let key: string;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'fp-')), 't.db');
  resetDb();
  const db = openDb();
  upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3' });
  setSetting(db, 'caveman', { level: 'off' });
  setSetting(db, 'caching', { autoBreakpoints: false });
  setSetting(db, 'rtk', { enabled: false });
  setSetting(db, 'minimax', { upstreamFormat: 'openai' });
  createAccount(db, { id: 'acc_1', label: 'a', credit_type: 'payg', api_key: 'mm_x' });
  key = genClientKey();
  createClientKey(db, { label: 'app', key });
  db.close();
});

afterEach(async () => {
  await flushDeferredLogs();
  vi.restoreAllMocks();
  delete process.env.ROUTER_DB_PATH;
});

describe('fast-path passthrough', () => {
  it('forwards a body equivalent to the client request when no transform applies', async () => {
    let sentBody = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, opts) => {
      sentBody = opts.body as string;
      return Promise.resolve(
        new Response(
          JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    });
    // Pre-set the fields bodyTransform would inject for M3, so the transform is a no-op
    // and the fast path engages. stream is unset, so bodyAddsOpenAIStreamUsage injects nothing and the body
    // stays clean → fast path forwards the raw text unchanged.
    // The upstream receives the model WITHOUT the prefix (mx/ is stripped).
    const clientBody = {
      model: 'mx/MiniMax-M3',
      messages: [{ role: 'user', content: 'hello world' }],
      temperature: 0.5,
      thinking: { type: 'adaptive' },
      max_completion_tokens: 131072,
      reasoning_split: true,
    };
    const upstreamBody = {
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: 'hello world' }],
      temperature: 0.5,
      thinking: { type: 'adaptive' },
      max_completion_tokens: 131072,
      reasoning_split: true,
    };
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(clientBody),
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(sentBody)).toEqual(upstreamBody);
  });

  it('injects stream_options.include_usage for OpenAI streaming and tracks usage', async () => {
    let sentBody = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, opts) => {
      sentBody = opts.body as string;
      const sse =
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
        'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8}}\n\n' +
        'data: [DONE]\n\n';
      return Promise.resolve(
        new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
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
    // consume the stream so pipeWithUsage flush + deferred log run
    await res.text();
    await flushDeferredLogs();
    const sent = JSON.parse(sentBody);
    expect(sent.stream_options).toEqual({ include_usage: true });
  });

  it('still forwards a correct (transformed) body when a transform IS active', async () => {
    // caveman ON → body augmented → dirty path (re-stringify). Must still 200 and include injected content.
    const db = openDb();
    setSetting(db, 'caveman', { level: 'full' });
    db.close();
    let sentBody = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, opts) => {
      sentBody = opts.body as string;
      return Promise.resolve(
        new Response(
          JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
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
    expect(res.status).toBe(200);
    // Body was processed (valid JSON sent upstream). We don't assert exact caveman content,
    // only that the request succeeded and a body was sent.
    expect(sentBody.length).toBeGreaterThan(0);
    expect(() => JSON.parse(sentBody)).not.toThrow();
  });
});
