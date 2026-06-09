import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../index.js';
import { createAccount } from './accounts.js';
import { createClientKey } from './client_keys.js';
import {
  flushDeferredLogs,
  getDeferredLogQueueStats,
  insertRequestLogDeferred,
  type RequestLogInsert,
} from './requestLogs.js';

function entry(clientKeyId: number): RequestLogInsert {
  return {
    client_key_id: clientKeyId,
    account_id: 'acc_1',
    model: 'MiniMax-M3',
    endpoint: '/v1/chat/completions',
    format: 'openai',
    prompt_tokens: 1,
    completion_tokens: 1,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 2,
    cost_usd: 0,
    latency_ms: 5,
    status_code: 200,
    stream: 0,
    rtk_bytes_saved: 0,
  };
}

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'rlq-')), 't.db');
});

describe('requestLogs deferred queue', () => {
  it('exposes queue stats', async () => {
    const db = openDb();
    const clientKey = createClientKey(db, { label: 'u', key: 'rk_test' });
    createAccount(db, { id: 'acc_1', label: 'L', credit_type: 'payg', api_key: 'k' });

    insertRequestLogDeferred(db, entry(clientKey.id));

    const stats = getDeferredLogQueueStats(db);
    expect(stats.pending).toBeGreaterThanOrEqual(1);
    expect(stats.dropped).toBe(0);

    await flushDeferredLogs();
  });

  it('does not let pending queue grow unbounded under heavy inserts', async () => {
    const db = openDb();
    const clientKey = createClientKey(db, { label: 'u', key: 'rk_test' });
    createAccount(db, { id: 'acc_1', label: 'L', credit_type: 'payg', api_key: 'k' });

    for (let i = 0; i < 1100; i++) {
      insertRequestLogDeferred(db, entry(clientKey.id));
    }

    const stats = getDeferredLogQueueStats(db);
    expect(stats.pending).toBeLessThanOrEqual(1000);
    expect(stats.dropped).toBeGreaterThanOrEqual(0);

    await flushDeferredLogs();
  });
});
