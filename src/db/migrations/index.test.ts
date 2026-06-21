import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../index.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'mg-')), 't.db');
});

describe('migration 001 consolidated schema', () => {
  it('creates the performance indexes', () => {
    const db = openDb();
    const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as {
      name: string;
    }[];
    const names = new Set(rows.map((r) => r.name));
    expect(names.has('idx_logs_model_created_cost')).toBe(true);
    expect(names.has('idx_logs_created_at')).toBe(true);
    expect(names.has('idx_accounts_enabled_status')).toBe(true);
    expect(names.has('idx_client_keys_active_key')).toBe(true);
  });

  it('creates all consolidated tables on a fresh DB', () => {
    const db = openDb();
    const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as {
      name: string;
    }[];
    const names = new Set(rows.map((r) => r.name));
    for (const table of [
      'accounts',
      'account_model_locks',
      'client_keys',
      'request_logs',
      'quota_snapshots',
      'models',
      'model_aliases',
      'sessions',
      'settings',
      'transports',
      'combos',
      'audit_log',
    ]) {
      expect(names.has(table)).toBe(true);
    }
  });

  it('folds the incremental columns into the base tables', () => {
    const db = openDb();
    const accountCols = db.prepare(`PRAGMA table_info(accounts)`).all() as Array<{ name: string }>;
    const accountNames = new Set(accountCols.map((c) => c.name));
    // from 002-kiro + 003-transports
    for (const col of [
      'provider',
      'access_token',
      'token_expires_at',
      'provider_data',
      'relay_id',
      'proxy_id',
      'proxy_pool',
      'proxy_rotate_every',
    ]) {
      expect(accountNames.has(col)).toBe(true);
    }

    const requestCols = db.prepare(`PRAGMA table_info(request_logs)`).all() as Array<{
      name: string;
    }>;
    // from 004-reqid
    expect(requestCols.map((c) => c.name)).toContain('req_id');

    const transportCols = db.prepare(`PRAGMA table_info(transports)`).all() as Array<{
      name: string;
    }>;
    // from 006-transport-country
    expect(transportCols.map((c) => c.name)).toContain('country');

    const modelCols = db.prepare(`PRAGMA table_info(models)`).all() as Array<{ name: string }>;
    // from 002-kiro + 010-model-context-output
    const modelNames = new Set(modelCols.map((c) => c.name));
    expect(modelNames.has('provider')).toBe(true);
    expect(modelNames.has('context_output')).toBe(true);
  });

  it('bumps user_version to 1 on a fresh DB', () => {
    const db = openDb();
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(1);
  });
});
