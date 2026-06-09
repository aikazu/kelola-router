import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/index.js';
import { createAccount } from '../db/repos/accounts.js';
import { createClientKey } from '../db/repos/client_keys.js';
import { insertRequestLog, recentLogs } from '../db/repos/requestLogs.js';
import { tickQuotaOnce } from './quotaPull.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'qpl-')), 't.db');
  process.env.REQUEST_LOG_RETENTION_DAYS = '7';
});
afterEach(() => {
  delete process.env.REQUEST_LOG_RETENTION_DAYS;
});

describe('quotaPull tick retention', () => {
  it('deletes request_logs older than REQUEST_LOG_RETENTION_DAYS', async () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'u', key: 'rk_t' });
    createAccount(db, { id: 'a', label: 'L', credit_type: 'payg', api_key: 'k' });
    insertRequestLog(db, {
      client_key_id: ck.id,
      account_id: 'a',
      model: 'X',
      endpoint: '/v1/x',
      format: 'openai',
      prompt_tokens: 1,
      completion_tokens: 1,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 2,
      cost_usd: 0,
      latency_ms: 1,
      status_code: 200,
      stream: 0,
      rtk_bytes_saved: 0,
    });
    db.prepare(`UPDATE request_logs SET created_at = '2000-01-01 00:00:00' WHERE id = 1`).run();
    await tickQuotaOnce(db);
    expect(recentLogs(db, { limit: 100 }).length).toBe(0);
  });
});
