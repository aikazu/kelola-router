// tests/db/migration-004.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('migration 004 req_id', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'kr-')), 't.db');
  });
  afterEach(() => {
    delete process.env.ROUTER_DB_PATH;
  });

  it('adds a nullable req_id column to request_logs', async () => {
    const { openDb } = await import('../../src/db/index.js');
    const db = openDb();
    const cols = db.prepare('PRAGMA table_info(request_logs)').all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain('req_id');
    expect(Number(db.pragma('user_version', { simple: true }))).toBeGreaterThanOrEqual(4);
    db.close();
  });
});
