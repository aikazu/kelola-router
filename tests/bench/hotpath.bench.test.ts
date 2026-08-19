import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { createAccount } from '../../src/db/repos/accounts.js';
import { createClientKey, genClientKey } from '../../src/db/repos/client_keys.js';
import { upsertModel } from '../../src/db/repos/models.js';
import { flushDeferredLogs } from '../../src/db/repos/requestLogs.js';
import {
  disableHotPathMetrics,
  enableHotPathMetrics,
  readHotPathMetrics,
} from '../../src/providers/minimax/hotPathMetrics.js';
import { app, resetDb } from '../../src/server.js';

const statementMethods = ['run', 'get', 'all'] as const;
type StatementMethod = (typeof statementMethods)[number];
type SpyableStatement = Database.Statement &
  Record<StatementMethod, (...args: unknown[]) => unknown>;

const isSpyableStatement = (value: unknown): value is SpyableStatement => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<Record<StatementMethod, unknown>>;
  return statementMethods.every((method) => typeof candidate[method] === 'function');
};

const wrapStatementMethod = (
  stmt: SpyableStatement,
  method: StatementMethod,
  onCall: () => void
) => {
  const original = stmt[method];
  stmt[method] = ((...args: unknown[]) => {
    onCall();
    return original.apply(stmt, args);
  }) as typeof original;
};

let key: string;

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'bench-')), 't.db');
  resetDb();
  const db = openDb();
  upsertModel(db, { name: 'MiniMax-M3', upstream_model: 'MiniMax-M3' });
  createAccount(db, { id: 'acc_1', label: 'a', credit_type: 'payg', api_key: 'mm_x' });
  key = genClientKey();
  createClientKey(db, { label: 'app', key });
  db.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('hot-path benchmark', () => {
  it('measures statements + overhead per request', async () => {
    const realPrepare = Database.prototype.prepare;
    let stmtRuns = 0;
    vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (sql: string) {
      const stmt = realPrepare.call(this, sql);
      if (!isSpyableStatement(stmt)) {
        return stmt;
      }

      for (const method of statementMethods) {
        wrapStatementMethod(stmt, method, () => {
          stmtRuns++;
        });
      }

      return stmt;
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'x',
            choices: [],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
      )
    );

    const make = () =>
      app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'mx/MiniMax-M3',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });

    await make(); // warm caches
    stmtRuns = 0;
    enableHotPathMetrics();
    const t0 = performance.now();
    const res = await make();
    const overheadMs = performance.now() - t0;
    const marks = readHotPathMetrics();
    disableHotPathMetrics();
    expect(res.status).toBe(200);
    console.log(`[bench] sqlite statement executions (warm): ${stmtRuns}`);
    console.log(`[bench] router overhead (fake upstream): ${overheadMs.toFixed(2)}ms`);
    console.log(`[bench] hot path marks: ${marks.map((mark) => mark.name).join(', ')}`);
    await flushDeferredLogs();
    expect(stmtRuns).toBeLessThanOrEqual(18);
    expect(overheadMs).toBeLessThan(35);
    expect(marks.some((mark) => mark.name === 'proxy:upstream-fetch-start')).toBe(true);
    expect(marks.some((mark) => mark.name === 'proxy:upstream-fetch-response')).toBe(true);
  });
});
