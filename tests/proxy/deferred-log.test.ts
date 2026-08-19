import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { flushDeferredLogs, insertRequestLogDeferred } from '../../src/db/repos/request-logs.js';

it('writes the log row after a flush', async () => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'dlog-')), 't.db');
  const db = openDb();
  insertRequestLogDeferred(db, {
    client_key_id: null,
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
  });
  const before = db.prepare('SELECT COUNT(*) n FROM request_logs').get() as { n: number };
  await flushDeferredLogs();
  const after = db.prepare('SELECT COUNT(*) n FROM request_logs').get() as { n: number };
  expect(after.n).toBe(before.n + 1);
});
