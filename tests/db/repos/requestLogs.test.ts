import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../../src/db/migrations/index.js';
import { getRequestLogById, insertRequestLog } from '../../../src/db/repos/requestLogs.js';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rl-test-'));
  db = new Database(join(dir, 't.db'));
  db.pragma('foreign_keys = ON');
  migrate(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true });
});

describe('requestLogs repo', () => {
  it('inserts and reads body fields', () => {
    const id = insertRequestLog(db, {
      model: 'm1',
      endpoint: '/v1/x',
      format: 'openai',
      prompt_tokens: 5,
      completion_tokens: 10,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 15,
      cost_usd: 0.0001,
      latency_ms: 100,
      status_code: 200,
      stream: false,
      rtk_bytes_saved: 0,
      request_body: '{"x":1}',
      response_body: '{"y":2}',
      request_headers: '{"a":"b"}',
      response_headers: '{"c":"d"}',
    });
    const row = getRequestLogById(db, id);
    expect(row?.request_body).toBe('{"x":1}');
    expect(row?.response_body).toBe('{"y":2}');
    expect(row?.error).toBeNull();
  });

  it('getRequestLogById returns null for missing', () => {
    expect(getRequestLogById(db, 999999)).toBeNull();
  });

  it('stores error when set', () => {
    const id = insertRequestLog(db, {
      model: 'm1',
      endpoint: '/v1/x',
      format: 'openai',
      prompt_tokens: 0,
      completion_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 0,
      cost_usd: 0,
      latency_ms: 50,
      status_code: 500,
      stream: false,
      rtk_bytes_saved: 0,
      error: 'upstream timeout',
    });
    expect(getRequestLogById(db, id)?.error).toBe('upstream timeout');
  });
});
