import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../db/index.js';
import { flushDeferredLogs, insertRequestLogDeferred } from '../../db/repos/request-logs.js';
import { bumpAdminCacheVersion, getAdminCached, setAdminCached } from './cache.js';

describe('admin cache invalidation', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'cache-')), 't.db');
    bumpAdminCacheVersion(); // bump version to invalidate any entries left from previous tests
  });

  it('drops TTL to 250 ms', async () => {
    setAdminCached('k', { v: 1 });
    expect(getAdminCached<{ v: number }>('k')?.v).toBe(1);
    await new Promise((r) => setTimeout(r, 260));
    expect(getAdminCached<{ v: number }>('k')).toBeNull();
  });

  it('bumpAdminCacheVersion invalidates immediately', () => {
    setAdminCached('k', { v: 1 });
    expect(getAdminCached('k')).toBeDefined();
    bumpAdminCacheVersion();
    expect(getAdminCached('k')).toBeNull();
  });

  it('insertRequestLogDeferred + flushDeferredLogs bumps the cache version', async () => {
    const db = openDb();
    setAdminCached('k', { v: 1 });
    insertRequestLogDeferred(db, {
      client_key_id: null,
      account_id: null,
      model: 'm',
      requested_model: 'm',
      endpoint: '/v1/chat/completions',
      format: 'openai',
      prompt_tokens: 0,
      completion_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 0,
      cost_usd: 0,
      latency_ms: 0,
      status_code: 200,
      stream: 0,
      rtk_bytes_saved: 0,
    });
    await flushDeferredLogs();
    expect(getAdminCached('k')).toBeNull();
  });
});
