import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../index.js';
import { createAccount } from './accounts.js';
import { cleanupOldQuota, insertQuotaSnapshot, latestQuotaByAccount } from './quota-snapshots.js';

let db: ReturnType<typeof openDb>;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'quota-')), 'test.db');
  db = openDb();
});

describe('quotaSnapshots repo', () => {
  // 1. insertQuotaSnapshot returns numeric lastInsertRowid
  it('insertQuotaSnapshot returns numeric lastInsertRowid', () => {
    createAccount(db, { id: 'acc_1', label: 'T', credit_type: 'payg', api_key: 'k1' });
    const id = insertQuotaSnapshot(db, {
      account_id: 'acc_1',
      source: 'minimax',
      model_name: 'MiniMax-M3',
      total_count: 1000,
      remaining_count: 800,
      used_count: 200,
      remaining_percent: 80,
      remains_time: 3600,
      window_type: 'daily',
      window_start: '2026-01-01T00:00:00Z',
      window_end: '2026-01-02T00:00:00Z',
      raw_response: null,
    });
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  // 2. latestQuotaByAccount returns rows sorted DESC by fetched_at, respects limit
  it('latestQuotaByAccount returns rows sorted DESC by fetched_at, respects limit', () => {
    createAccount(db, { id: 'acc_old', label: 'T', credit_type: 'payg', api_key: 'k_old' });
    // older snapshot
    db.prepare(`
      INSERT INTO quota_snapshots (account_id, source, model_name, total_count, remaining_count, used_count, remaining_percent, remains_time, window_type, window_start, window_end, raw_response, fetched_at)
      VALUES ('acc_old', 'minimax', 'M1', 100, 100, 0, 100, null, null, null, null, null, datetime('now', '-1 hour'))
    `).run();
    // newer snapshot
    db.prepare(`
      INSERT INTO quota_snapshots (account_id, source, model_name, total_count, remaining_count, used_count, remaining_percent, remains_time, window_type, window_start, window_end, raw_response, fetched_at)
      VALUES ('acc_old', 'minimax', 'M1', 100, 90, 10, 90, null, null, null, null, null, datetime('now'))
    `).run();

    const rows = latestQuotaByAccount(db, 'acc_old', 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.remaining_count).toBe(90); // newest first
  });

  // 3. cleanupOldQuota(7) deletes only rows older than 7 days
  it('cleanupOldQuota(7) deletes only rows older than 7 days', () => {
    createAccount(db, { id: 'acc_old', label: 'T', credit_type: 'payg', api_key: 'k_old' });
    // Insert a "recent" row (yesterday) using a fixed fetched_at
    db.prepare(`
      INSERT INTO quota_snapshots (account_id, source, model_name, total_count, remaining_count, used_count, remaining_percent, remains_time, window_type, window_start, window_end, raw_response, fetched_at)
      VALUES ('acc_old', 'minimax', 'M1', 100, 50, 50, 50, null, null, null, null, null, datetime('now', '-1 day'))
    `).run();
    // Insert an "ancient" row (10 days ago)
    db.prepare(`
      INSERT INTO quota_snapshots (account_id, source, model_name, total_count, remaining_count, used_count, remaining_percent, remains_time, window_type, window_start, window_end, raw_response, fetched_at)
      VALUES ('acc_old', 'minimax', 'M2', 100, 30, 70, 30, null, null, null, null, null, datetime('now', '-10 days'))
    `).run();

    const deleted = cleanupOldQuota(db, 7);
    expect(deleted).toBe(1);

    const remaining = latestQuotaByAccount(db, 'acc_old', 10);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.model_name).toBe('M1');
  });

  // 4. cleanupOldQuota(0) deletes all rows
  it('cleanupOldQuota(0) deletes all rows', () => {
    createAccount(db, { id: 'acc_del', label: 'T', credit_type: 'payg', api_key: 'k_del' });
    insertQuotaSnapshot(db, {
      account_id: 'acc_del',
      source: 'minimax',
      model_name: 'M1',
      total_count: 100,
      remaining_count: 100,
      used_count: 0,
      remaining_percent: 100,
      remains_time: null,
      window_type: null,
      window_start: null,
      window_end: null,
      raw_response: null,
    });
    insertQuotaSnapshot(db, {
      account_id: 'acc_del',
      source: 'minimax',
      model_name: 'M2',
      total_count: 200,
      remaining_count: 200,
      used_count: 0,
      remaining_percent: 100,
      remains_time: null,
      window_type: null,
      window_start: null,
      window_end: null,
      raw_response: null,
    });

    const deleted = cleanupOldQuota(db, 0);
    expect(deleted).toBe(2);

    const remaining = latestQuotaByAccount(db, 'acc_del', 10);
    expect(remaining).toHaveLength(0);
  });

  // 5. cleanupOldQuota(365) deletes nothing on fresh DB
  it('cleanupOldQuota(365) deletes nothing on fresh DB', () => {
    createAccount(db, { id: 'acc_fresh', label: 'T', credit_type: 'payg', api_key: 'k_fresh' });
    insertQuotaSnapshot(db, {
      account_id: 'acc_fresh',
      source: 'minimax',
      model_name: 'M1',
      total_count: 100,
      remaining_count: 100,
      used_count: 0,
      remaining_percent: 100,
      remains_time: null,
      window_type: null,
      window_start: null,
      window_end: null,
      raw_response: null,
    });

    const deleted = cleanupOldQuota(db, 365);
    expect(deleted).toBe(0);

    const remaining = latestQuotaByAccount(db, 'acc_fresh', 10);
    expect(remaining).toHaveLength(1);
  });

  // 6. Null model_name and null fields stored as null (not undefined)
  it('null model_name and null fields stored as null (not undefined)', () => {
    createAccount(db, { id: 'acc_null', label: 'T', credit_type: 'payg', api_key: 'k_null' });
    insertQuotaSnapshot(db, {
      account_id: 'acc_null',
      source: 'minimax',
      model_name: null,
      total_count: null,
      remaining_count: null,
      used_count: null,
      remaining_percent: null,
      remains_time: null,
      window_type: null,
      window_start: null,
      window_end: null,
      raw_response: null,
    });

    const row = latestQuotaByAccount(db, 'acc_null', 1)[0];
    expect(row).toBeDefined();
    expect(row!.model_name).toBeNull();
    expect(row!.total_count).toBeNull();
    expect(row!.remaining_count).toBeNull();
    expect(row!.used_count).toBeNull();
    expect(row!.remaining_percent).toBeNull();
    expect(row!.remains_time).toBeNull();
    expect(row!.window_type).toBeNull();
    expect(row!.window_start).toBeNull();
    expect(row!.window_end).toBeNull();
    expect(row!.raw_response).toBeNull();
  });

  // 7. CASCADE delete: deleting account removes its quota snapshots
  it('CASCADE delete: deleting account removes its quota snapshots', () => {
    createAccount(db, { id: 'acc_cascade', label: 'T', credit_type: 'payg', api_key: 'k_cascade' });
    createAccount(db, { id: 'acc_other', label: 'T', credit_type: 'payg', api_key: 'k_other' });
    insertQuotaSnapshot(db, {
      account_id: 'acc_cascade',
      source: 'minimax',
      model_name: 'M1',
      total_count: 100,
      remaining_count: 100,
      used_count: 0,
      remaining_percent: 100,
      remains_time: null,
      window_type: null,
      window_start: null,
      window_end: null,
      raw_response: null,
    });
    insertQuotaSnapshot(db, {
      account_id: 'acc_cascade',
      source: 'minimax',
      model_name: 'M2',
      total_count: 200,
      remaining_count: 200,
      used_count: 0,
      remaining_percent: 100,
      remains_time: null,
      window_type: null,
      window_start: null,
      window_end: null,
      raw_response: null,
    });
    // Other account's snapshot should survive
    insertQuotaSnapshot(db, {
      account_id: 'acc_other',
      source: 'minimax',
      model_name: 'M3',
      total_count: 300,
      remaining_count: 300,
      used_count: 0,
      remaining_percent: 100,
      remains_time: null,
      window_type: null,
      window_start: null,
      window_end: null,
      raw_response: null,
    });

    // Delete the account (FK cascade should remove acc_cascade's snapshots)
    db.prepare(`DELETE FROM accounts WHERE id = 'acc_cascade'`).run();

    const cascadeSnapshots = latestQuotaByAccount(db, 'acc_cascade', 10);
    expect(cascadeSnapshots).toHaveLength(0);

    const otherSnapshots = latestQuotaByAccount(db, 'acc_other', 10);
    expect(otherSnapshots).toHaveLength(1);
    expect(otherSnapshots[0]!.model_name).toBe('M3');
  });
});
