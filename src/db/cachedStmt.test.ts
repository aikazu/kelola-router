import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { cachedStmt } from './cachedStmt.js';
import { openDb } from './index.js';

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'cs-')), 't.db');
});

it('returns the same Statement for the same SQL on repeat calls', () => {
  const db = openDb();
  const a = cachedStmt(db, `SELECT 1 AS x`);
  const b = cachedStmt(db, `SELECT 1 AS x`);
  expect(a).toBe(b);
});
