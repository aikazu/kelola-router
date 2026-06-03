import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../index.js';
import { createAccount } from './accounts.js';
import { createClientKey } from './client_keys.js';
import { aggregateUsage, cleanupOldLogs, insertRequestLog, recentLogs } from './requestLogs.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'rl-')), 't.db');
});

describe('requestLogs repo', () => {
  it('insertRequestLog + recentLogs', () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'u', key: 'rk_test' });
    createAccount(db, { id: 'a', label: 'L', credit_type: 'payg', api_key: 'k' });
    insertRequestLog(db, {
      client_key_id: ck.id,
      account_id: 'a',
      model: 'MiniMax-M3',
      endpoint: '/v1/messages',
      format: 'anthropic',
      prompt_tokens: 100,
      completion_tokens: 50,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 150,
      cost_usd: 0.0003,
      latency_ms: 500,
      status_code: 200,
      stream: 0,
      rtk_bytes_saved: 0,
    });
    const logs = recentLogs(db, { limit: 10 });
    expect(logs.length).toBe(1);
    expect(logs[0].model).toBe('MiniMax-M3');
    expect(logs[0].client_key_id).toBe(ck.id);
  });

  it('recentLogs filter by client_key_id', () => {
    const db = openDb();
    const ck1 = createClientKey(db, { label: 'u1', key: 'rk_t1' });
    const ck2 = createClientKey(db, { label: 'u2', key: 'rk_t2' });
    createAccount(db, { id: 'a', label: 'L', credit_type: 'payg', api_key: 'k' });
    insertRequestLog(db, {
      client_key_id: ck1.id,
      account_id: 'a',
      model: 'X',
      endpoint: '/v1/x',
      format: 'openai',
      prompt_tokens: 1,
      completion_tokens: 1,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 2,
      cost_usd: 1,
      latency_ms: 1,
      status_code: 200,
      stream: 0,
      rtk_bytes_saved: 0,
    });
    insertRequestLog(db, {
      client_key_id: ck2.id,
      account_id: 'a',
      model: 'Y',
      endpoint: '/v1/x',
      format: 'openai',
      prompt_tokens: 1,
      completion_tokens: 1,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 2,
      cost_usd: 5,
      latency_ms: 1,
      status_code: 200,
      stream: 0,
      rtk_bytes_saved: 0,
    });
    const ck1Logs = recentLogs(db, { clientKeyId: ck1.id, limit: 10 });
    expect(ck1Logs.length).toBe(1);
    expect(ck1Logs[0].model).toBe('X');
  });

  it('aggregateUsage sums cost + tokens by model', () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'u', key: 'rk_test' });
    createAccount(db, { id: 'a', label: 'L', credit_type: 'payg', api_key: 'k' });
    insertRequestLog(db, {
      client_key_id: ck.id,
      account_id: 'a',
      model: 'MiniMax-M3',
      endpoint: '/v1/messages',
      format: 'anthropic',
      prompt_tokens: 100,
      completion_tokens: 50,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 150,
      cost_usd: 0.5,
      latency_ms: 500,
      status_code: 200,
      stream: 0,
      rtk_bytes_saved: 0,
    });
    insertRequestLog(db, {
      client_key_id: ck.id,
      account_id: 'a',
      model: 'MiniMax-M3',
      endpoint: '/v1/messages',
      format: 'anthropic',
      prompt_tokens: 100,
      completion_tokens: 50,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 150,
      cost_usd: 0.7,
      latency_ms: 500,
      status_code: 200,
      stream: 0,
      rtk_bytes_saved: 0,
    });
    insertRequestLog(db, {
      client_key_id: ck.id,
      account_id: 'a',
      model: 'MiniMax-M2.7',
      endpoint: '/v1/messages',
      format: 'anthropic',
      prompt_tokens: 100,
      completion_tokens: 50,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 150,
      cost_usd: 0.2,
      latency_ms: 500,
      status_code: 200,
      stream: 0,
      rtk_bytes_saved: 0,
    });
    const agg = aggregateUsage(db, { days: 7 });
    expect(agg.total_cost).toBe(1.4);
    expect(agg.total_requests).toBe(3);
    expect(agg.by_model.length).toBe(2);
    expect(agg.by_model.find((m) => m.model === 'MiniMax-M3')?.cost).toBe(1.2);
  });

  it('aggregateUsage filters by client_key_id', () => {
    const db = openDb();
    const ck1 = createClientKey(db, { label: 'u1', key: 'rk_t1' });
    const ck2 = createClientKey(db, { label: 'u2', key: 'rk_t2' });
    createAccount(db, { id: 'a', label: 'L', credit_type: 'payg', api_key: 'k' });
    insertRequestLog(db, {
      client_key_id: ck1.id,
      account_id: 'a',
      model: 'X',
      endpoint: '/v1/x',
      format: 'openai',
      prompt_tokens: 1,
      completion_tokens: 1,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 2,
      cost_usd: 1,
      latency_ms: 1,
      status_code: 200,
      stream: 0,
      rtk_bytes_saved: 0,
    });
    insertRequestLog(db, {
      client_key_id: ck2.id,
      account_id: 'a',
      model: 'Y',
      endpoint: '/v1/x',
      format: 'openai',
      prompt_tokens: 1,
      completion_tokens: 1,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 2,
      cost_usd: 5,
      latency_ms: 1,
      status_code: 200,
      stream: 0,
      rtk_bytes_saved: 0,
    });
    const agg1 = aggregateUsage(db, { clientKeyId: ck1.id, days: 7 });
    expect(agg1.total_cost).toBe(1);
    expect(agg1.total_requests).toBe(1);
  });

  it('cleanupOldLogs deletes > 90 days', () => {
    const db = openDb();
    const ck = createClientKey(db, { label: 'u', key: 'rk_test' });
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
    cleanupOldLogs(db, 90);
    expect(recentLogs(db, { limit: 100 }).length).toBe(0);
  });
});
