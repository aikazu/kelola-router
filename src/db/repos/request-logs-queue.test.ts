import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../index.js';
import { createAccount } from './accounts.js';
import { createClientKey } from './client-keys.js';
import {
  configureDeferredLogQueueForTests,
  flushDeferredLogs,
  getDeferredLogQueueStats,
  insertRequestLogDeferred,
  type RequestLogInsert,
  resetDeferredLogQueueConfigForTests,
} from './request-logs.js';

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
  resetDeferredLogQueueConfigForTests();
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

  it('drops oldest entries once pending queue hits hard cap', async () => {
    configureDeferredLogQueueForTests({ batchSize: 2000, maxPendingPerDb: 1000 });

    const db = openDb();
    const clientKey = createClientKey(db, { label: 'u', key: 'rk_test' });
    createAccount(db, { id: 'acc_1', label: 'L', credit_type: 'payg', api_key: 'k' });

    for (let i = 0; i < 1101; i++) {
      insertRequestLogDeferred(db, entry(clientKey.id));
    }

    const stats = getDeferredLogQueueStats(db);
    expect(stats.pending).toBe(1000);
    expect(stats.dropped).toBeGreaterThan(0);

    await flushDeferredLogs();
  });
});
