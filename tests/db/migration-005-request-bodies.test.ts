import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrations/index.js';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'router-test-'));
  db = new Database(join(dir, 't.db'));
  db.pragma('foreign_keys = ON');
  migrate(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true });
});

describe('migration 005', () => {
  it('adds body + headers + error columns to request_logs', () => {
    const cols = db.prepare('PRAGMA table_info(request_logs)').all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain('request_body');
    expect(names).toContain('response_body');
    expect(names).toContain('request_headers');
    expect(names).toContain('response_headers');
    expect(names).toContain('error');
  });

  it('allows inserting all new columns', () => {
    db.prepare(`
      INSERT INTO request_logs (
        model, endpoint, format, status_code, latency_ms, prompt_tokens, completion_tokens,
        total_tokens, cost_usd, request_body, response_body,
        request_headers, response_headers, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'test-model',
      '/v1/chat/completions',
      'openai',
      200,
      123,
      10,
      20,
      30,
      0.001,
      '{"messages":[]}',
      '{"content":"hi"}',
      '{"content-type":"application/json"}',
      '{"x-request-id":"abc"}',
      null
    );
    const row = db.prepare('SELECT * FROM request_logs ORDER BY id DESC LIMIT 1').get() as Record<
      string,
      unknown
    >;
    expect(row.request_body).toBe('{"messages":[]}');
    expect(row.response_body).toBe('{"content":"hi"}');
    expect(row.error).toBeNull();
  });
});
