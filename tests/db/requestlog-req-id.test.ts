// tests/db/requestlog-reqid.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('request log req_id round-trip', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'kr-')), 't.db');
  });
  afterEach(() => {
    delete process.env.ROUTER_DB_PATH;
  });

  it('stores and reads back req_id', async () => {
    const { openDb } = await import('../../src/db/index.js');
    const { insertRequestLog, getRequestLogById } = await import(
      '../../src/db/repos/request-logs.js'
    );
    const db = openDb();
    const id = insertRequestLog(db, {
      client_key_id: null,
      account_id: null,
      model: 'm',
      endpoint: '/v1/messages',
      format: 'openai',
      prompt_tokens: 1,
      completion_tokens: 2,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 3,
      cost_usd: 0.1,
      latency_ms: 10,
      status_code: 200,
      stream: 0,
      rtk_bytes_saved: 0,
      req_id: 'a3f2',
    });
    expect(getRequestLogById(db, id)?.req_id).toBe('a3f2');
    db.close();
  });
});
