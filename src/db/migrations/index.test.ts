import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../index.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'mg-')), 't.db');
});

describe('migration 001 additive indexes', () => {
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
});
