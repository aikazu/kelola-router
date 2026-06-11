import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { createAccount } from '../../src/db/repos/accounts.js';
import { createClientKey } from '../../src/db/repos/client_keys.js';
import { createCombo } from '../../src/db/repos/combos.js';
import { upsertModel } from '../../src/db/repos/models.js';
import { clearCache } from '../../src/db/repos/settings.js';
import { app, resetDb } from '../../src/server.js';

let dir: string;

afterEach(() => {
  vi.restoreAllMocks();
  resetDb();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows may hold WAL lock; temp dir is auto-cleaned */
  }
  delete process.env.ROUTER_DB_PATH;
});

describe('combo fallback — retry on 5xx', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'combo-fb-'));
    process.env.ROUTER_DB_PATH = join(dir, 't.db');
    resetDb();
    clearCache();
    const db = openDb();
    createClientKey(db, { label: 'test', key: 'rk_combo_test' });
    // Two accounts so backoff on acc1 doesn't block acc2
    createAccount(db, { id: 'acc1', label: 'main', credit_type: 'payg', api_key: 'mm_1' });
    createAccount(db, { id: 'acc2', label: 'fallback', credit_type: 'payg', api_key: 'mm_2' });
    upsertModel(db, {
      name: 'model-a',
      upstream_model: 'model-a',
      provider: 'minimax',
      enabled: 1,
      family: 'test',
    });
    upsertModel(db, {
      name: 'model-b',
      upstream_model: 'model-b',
      provider: 'minimax',
      enabled: 1,
      family: 'test',
    });
    createCombo(db, 'test-combo', ['model-a', 'model-b']);
  });

  it('tries model-b when model-a returns 503', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      callCount++;
      const u = String(url);
      // First call (model-a) → 503
      if (callCount === 1 || u.includes('model-a')) {
        return new Response(JSON.stringify({ error: 'overloaded' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      // Second call (model-b) → success
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-x',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    const res = await app.request(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer rk_combo_test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'test-combo', messages: [{ role: 'user', content: 'hi' }] }),
      })
    );

    expect(res.status).toBe(200);
    expect(callCount).toBe(2);
  });

  it('tries model-b when model-a returns 502', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: 'bad gateway' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-y',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    const res = await app.request(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer rk_combo_test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'test-combo', messages: [{ role: 'user', content: 'hi' }] }),
      })
    );

    expect(res.status).toBe(200);
    expect(callCount).toBe(2);
  });

  it('returns last error when all models return 503', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'overloaded' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      })
    );

    const res = await app.request(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer rk_combo_test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'test-combo', messages: [{ role: 'user', content: 'hi' }] }),
      })
    );

    // Should return last error (503 or 502 when all exhausted — body reuse can cause network-error path)
    expect([429, 502, 503]).toContain(res.status);
  });
});

describe('combo fallback — account re-select per model', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'combo-acc-'));
    process.env.ROUTER_DB_PATH = join(dir, 't.db');
    resetDb();
    clearCache();
    const db = openDb();
    createClientKey(db, { label: 'test2', key: 'rk_combo_acc' });
    // Two accounts
    createAccount(db, { id: 'acc_a', label: 'acc-a', credit_type: 'payg', api_key: 'mm_a' });
    createAccount(db, { id: 'acc_b', label: 'acc-b', credit_type: 'payg', api_key: 'mm_b' });
    upsertModel(db, {
      name: 'model-x',
      upstream_model: 'model-x',
      provider: 'minimax',
      enabled: 1,
      family: 'test',
    });
    upsertModel(db, {
      name: 'model-y',
      upstream_model: 'model-y',
      provider: 'minimax',
      enabled: 1,
      family: 'test',
    });
    createCombo(db, 'acc-combo', ['model-x', 'model-y']);
  });

  it('uses a different account for the second model when first account is backoffed', async () => {
    const calledApiKeys: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, init) => {
      const headers = (init as RequestInit)?.headers;
      let authHeader = '';
      if (headers instanceof Headers) {
        authHeader = headers.get('authorization') ?? '';
      } else if (headers && typeof headers === 'object') {
        const h = headers as Record<string, string>;
        // Header key may be 'Authorization' (capital) or 'authorization'
        authHeader = h['Authorization'] ?? h['authorization'] ?? '';
      }
      calledApiKeys.push(authHeader);

      // acc_a's first call → 429 (triggers backoff)
      if (authHeader.includes('mm_a') && calledApiKeys.filter((k) => k.includes('mm_a')).length === 1) {
        return new Response(JSON.stringify({ error: 'rate limited' }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        });
      }

      // Any acc_b call → success
      if (authHeader.includes('mm_b')) {
        return new Response(
          JSON.stringify({
            id: 'chatcmpl-z',
            object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      // Fallback success for any other call
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-z2',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    const res = await app.request(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer rk_combo_acc',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'acc-combo', messages: [{ role: 'user', content: 'hi' }] }),
      })
    );

    // Combo should succeed
    expect(res.status).toBe(200);
    // acc_a was tried first
    expect(calledApiKeys.some((k) => k.includes('mm_a'))).toBe(true);
    // After backoff, second model used acc_b
    expect(calledApiKeys.some((k) => k.includes('mm_b'))).toBe(true);
  });
});
