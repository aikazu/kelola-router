import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { createAccount } from '../../src/db/repos/accounts.js';
import { createClientKey } from '../../src/db/repos/client-keys.js';
import { upsertModel } from '../../src/db/repos/models.js';
import { flushDeferredLogs, recentLogs } from '../../src/db/repos/request-logs.js';
import { clearCache, setSetting } from '../../src/db/repos/settings.js';
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

describe('rtk_bytes_saved is persisted from real compression stats', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rtk-saved-'));
    process.env.ROUTER_DB_PATH = join(dir, 't.db');
    resetDb();
    clearCache();
    const db = openDb();
    createClientKey(db, { label: 'test', key: 'rk_rtk_test' });
    createAccount(db, { id: 'acc1', label: 'main', credit_type: 'payg', api_key: 'mm_1' });
    upsertModel(db, {
      name: 'model-a',
      upstream_model: 'model-a',
      provider: 'minimax',
      enabled: 1,
      family: 'test',
    });
    // RTK on, caveman/caching off so only RTK touches the body.
    setSetting(db, 'rtk', { enabled: true, minCompressSize: 500, filters: ['smart-truncate'] });
    setSetting(db, 'caveman', { level: 'off' });
    setSetting(db, 'caching', { autoBreakpoints: false });
    clearCache();
  });

  it('logs non-zero rtk_bytes_saved for a buffered request with a large tool_result', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            id: 'chatcmpl-x',
            object: 'chat.completion',
            choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    );

    const bigToolOutput = Array(400).fill('result output line of text').join('\n');
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: 'Bearer rk_rtk_test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'mx/model-a',
        stream: false,
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'tool', content: bigToolOutput },
        ],
      }),
    });

    expect(res.status).toBe(200);
    await flushDeferredLogs();
    const db = openDb();
    const logs = recentLogs(db, {});
    expect(logs.length).toBe(1);
    expect(logs[0].rtk_bytes_saved).toBeGreaterThan(0);
  });
});
