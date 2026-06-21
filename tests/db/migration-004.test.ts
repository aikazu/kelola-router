// tests/db/migration-004.test.ts
// req_id used to be added by migration 004; it is now part of the consolidated
// 001-initial schema. This test still verifies the column exists on a fresh DB.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('request_logs req_id column', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'kr-')), 't.db');
  });
  afterEach(() => {
    delete process.env.ROUTER_DB_PATH;
  });

  it('includes a nullable req_id column on a fresh DB', async () => {
    const { openDb } = await import('../../src/db/index.js');
    const db = openDb();
    const cols = db.prepare('PRAGMA table_info(request_logs)').all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain('req_id');
    db.close();
  });
});
