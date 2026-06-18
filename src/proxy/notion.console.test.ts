// src/proxy/notion.console.test.ts
// TDD: ensures handleNotionProxy emits console flow events (start/error/done)
// and writes a request_logs row on every code path — parity with Pioneer.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consoleBus } from '../console/bus.js';
import { openDb } from '../db/index.js';
import { createAccount } from '../db/repos/accounts.js';
import { createClientKey } from '../db/repos/client_keys.js';
import { upsertModel } from '../db/repos/models.js';
import { flushDeferredLogs } from '../db/repos/requestLogs.js';
import { NOTION_AI_COOKIE_NAMES } from '../providers/notion/constants.js';
import { app, resetDb } from '../server.js';

function notionNdjsonResponse(): Response {
  // Minimal valid NDJSON for extractNotionStream:
  //  1. patch-start seeds an agent-inference record with empty content.
  //  2. patch updates that content to "hi" — extractor emits delta "hi".
  //  3. done terminates the stream (extractor emits done, handler emits [DONE]).
  const lines = [
    {
      type: 'patch-start',
      version: 1,
      data: { s: [{ id: 'inf1', type: 'agent-inference', value: [{ type: 'text', content: '' }] }] },
    },
    { type: 'patch', v: [{ o: 'x', p: '/s/0/value/0/content', v: 'hi' }] },
    { type: 'done' },
  ]
    .map((o) => JSON.stringify(o))
    .join('\n');
  return new Response(lines, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

function seedNotionAccount(db: ReturnType<typeof openDb>): void {
  const cookies: Record<string, string> = {};
  for (const n of NOTION_AI_COOKIE_NAMES) cookies[n] = 'c';
  createAccount(db, {
    id: 'nt1',
    label: 'NT',
    credit_type: 'payg',
    api_key: 'nt',
    provider: 'notion',
    provider_data: JSON.stringify({ cookies, userId: 'u', spaceId: 'sp' }),
  });
  upsertModel(db, {
    name: 'notion-default',
    upstream_model: 'notion-default',
    provider: 'notion',
    source: 'fetched',
    enabled: 1,
  });
}

function seedClientKey(db: ReturnType<typeof openDb>): string {
  const ck = createClientKey(db, { label: 'app', key: 'rk_test_key' });
  return ck.key;
}

function emitPhases(emitSpy: { mock: { calls: unknown[][] } }): string[] {
  return emitSpy.mock.calls.map((c) => (c[0] as { phase: string }).phase);
}

describe('handleNotionProxy console flow', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'nt-')), 't.db');
    process.env.ROUTER_ADMIN_KEY = 'ak_test';
    resetDb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits start + done and writes a log row on success', async () => {
    const db = openDb();
    seedNotionAccount(db);
    const key = seedClientKey(db);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(notionNdjsonResponse());
    const emitSpy = vi.spyOn(consoleBus, 'emit');

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'nt/notion-default',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    // Drain the stream so the deferred log-row flush triggers before we count.
    await res.text();
    await flushDeferredLogs();

    const phases = emitPhases(emitSpy);
    expect(phases).toContain('start');
    expect(phases).toContain('done');
    const logs = db
      .prepare('SELECT COUNT(*) c FROM request_logs')
      .get() as { c: number };
    expect(logs.c).toBeGreaterThanOrEqual(1);
  });

  it('emits start + error and writes a log row when no notion account', async () => {
    const db = openDb();
    // Seed a model so peek.provider === 'notion' routes us into handleNotionProxy,
    // but DO NOT seed an account — the handler must emit start + error + log row.
    upsertModel(db, {
      name: 'notion-default',
      upstream_model: 'notion-default',
      provider: 'notion',
      source: 'fetched',
      enabled: 1,
    });
    const key = seedClientKey(db);
    const emitSpy = vi.spyOn(consoleBus, 'emit');

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'nt/notion-default',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    await res.text();
    await flushDeferredLogs();

    expect(res.status).toBe(503);
    const phases = emitPhases(emitSpy);
    expect(phases).toContain('start');
    expect(phases).toContain('error');
    const logs = db
      .prepare('SELECT COUNT(*) c FROM request_logs')
      .get() as { c: number };
    expect(logs.c).toBeGreaterThanOrEqual(1);
  });
});
