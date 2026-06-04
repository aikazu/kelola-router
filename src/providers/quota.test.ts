import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../db/index.js';
import { createAccount } from '../db/repos/accounts.js';
import { latestQuotaByAccount } from '../db/repos/quotaSnapshots.js';
import { pullQuota } from './quota.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'q-')), 't.db');
});

// Real MiniMax shape: nested model_remains[], each model carries interval + weekly fields.
function modelRemainsBody() {
  return {
    model_remains: [
      {
        model_name: 'general',
        start_time: 1780567200000,
        end_time: 1780585200000,
        remains_time: 7503899,
        current_interval_total_count: 0,
        current_interval_usage_count: 0,
        current_interval_remaining_percent: 99,
        current_interval_status: 1,
        current_weekly_total_count: 0,
        current_weekly_usage_count: 0,
        current_weekly_remaining_percent: 87,
        weekly_start_time: 1780272000000,
        weekly_end_time: 1780876800000,
        weekly_remains_time: 299103899,
      },
      {
        model_name: 'video',
        start_time: 1780531200000,
        end_time: 1780617600000,
        remains_time: 39903899,
        current_interval_total_count: 3,
        current_interval_usage_count: 0,
        current_interval_remaining_percent: 100,
        current_interval_status: 1,
        current_weekly_total_count: 21,
        current_weekly_usage_count: 0,
        current_weekly_remaining_percent: 100,
        weekly_start_time: 1780272000000,
        weekly_end_time: 1780876800000,
        weekly_remains_time: 299103899,
      },
    ],
    base_resp: { status_code: 0, status_msg: 'success' },
  };
}

describe('pullQuota', () => {
  it('skips PAYG accounts', async () => {
    const db = openDb();
    createAccount(db, { id: 'a1', label: 'L', credit_type: 'payg', api_key: 'k' });
    const a = createAccount(db, { id: 'a1b', label: 'L', credit_type: 'payg', api_key: 'k2' });
    const r = await pullQuota(db, a);
    expect(r.ok).toBe(true);
    expect(latestQuotaByAccount(db, 'a1b').length).toBe(0);
  });

  it('parses nested model_remains: 2 windows per model', async () => {
    const db = openDb();
    const a = createAccount(db, { id: 'a2', label: 'L', credit_type: 'token-plan', api_key: 'k' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(modelRemainsBody()), { status: 200 })
    );
    const r = await pullQuota(db, a);
    expect(r.ok).toBe(true);
    const snaps = latestQuotaByAccount(db, 'a2', 50);
    // 2 models * 2 windows = 4 snapshots
    expect(snaps.length).toBe(4);
  });

  it('stores remaining_percent + correct used/remaining (no swap) for general 5h', async () => {
    const db = openDb();
    const a = createAccount(db, { id: 'a3', label: 'L', credit_type: 'token-plan', api_key: 'k' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(modelRemainsBody()), { status: 200 })
    );
    await pullQuota(db, a);
    const snaps = latestQuotaByAccount(db, 'a3', 50);
    const g5 = snaps.find((s) => s.model_name === 'general' && s.window_type === '5h')!;
    expect(g5.remaining_percent).toBe(99);
    expect(g5.total_count).toBe(0);
    expect(g5.used_count).toBe(0); // usage_count = USED
    expect(g5.remaining_count).toBe(0); // total - usage, clamped >= 0
    expect(g5.remains_time).toBe(7503899);
  });

  it('computes used=usage and remaining=total-usage for metered model (video)', async () => {
    const db = openDb();
    const a = createAccount(db, { id: 'a4', label: 'L', credit_type: 'token-plan', api_key: 'k' });
    const body = modelRemainsBody();
    body.model_remains[1].current_interval_usage_count = 1; // 1 of 3 used
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 })
    );
    await pullQuota(db, a);
    const snaps = latestQuotaByAccount(db, 'a4', 50);
    const v5 = snaps.find((s) => s.model_name === 'video' && s.window_type === '5h')!;
    expect(v5.total_count).toBe(3);
    expect(v5.used_count).toBe(1);
    expect(v5.remaining_count).toBe(2);
  });

  it('captures weekly window with weekly percent', async () => {
    const db = openDb();
    const a = createAccount(db, { id: 'a5', label: 'L', credit_type: 'token-plan', api_key: 'k' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(modelRemainsBody()), { status: 200 })
    );
    await pullQuota(db, a);
    const snaps = latestQuotaByAccount(db, 'a5', 50);
    const gWk = snaps.find((s) => s.model_name === 'general' && s.window_type === 'weekly')!;
    expect(gWk.remaining_percent).toBe(87);
  });

  it('skips model_remains items with no model_name (never inserts NULL-model rows)', async () => {
    const db = openDb();
    const a = createAccount(db, { id: 'a7', label: 'L', credit_type: 'token-plan', api_key: 'k' });
    const body = modelRemainsBody();
    // Upstream sometimes returns an item without model_name — it cannot be grouped, drop it.
    (body.model_remains as Array<Record<string, unknown>>).push({
      current_interval_total_count: 0,
      current_interval_usage_count: 0,
      current_weekly_total_count: 0,
      current_weekly_usage_count: 0,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 })
    );
    await pullQuota(db, a);
    const snaps = latestQuotaByAccount(db, 'a7', 50);
    // Still 4 (general + video), the nameless item produced nothing.
    expect(snaps.length).toBe(4);
    expect(snaps.every((s) => s.model_name != null)).toBe(true);
  });

  it('falls back to coding_plan when token_plan fails', async () => {
    const db = openDb();
    const a = createAccount(db, { id: 'a6', label: 'L', credit_type: 'token-plan', api_key: 'k' });
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(new Response('err', { status: 500 }));
    spy.mockResolvedValueOnce(new Response(JSON.stringify(modelRemainsBody()), { status: 200 }));
    const r = await pullQuota(db, a);
    expect(r.ok).toBe(true);
    expect((spy.mock.calls as unknown as Array<[string]>)[1][0]).toContain('coding_plan/remains');
    expect(latestQuotaByAccount(db, 'a6', 50).length).toBe(4);
  });
});
