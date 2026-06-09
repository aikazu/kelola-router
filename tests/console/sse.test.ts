// tests/console/sse.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('GET /api/admin/console/stream', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'kr-')), 't.db');
  });
  afterEach(async () => {
    const { resetDb } = await import('../../src/server.js');
    resetDb();
    delete process.env.ROUTER_DB_PATH;
  });

  it('streams a backfilled recent event then closes', async () => {
    const { app, resetDb } = await import('../../src/server.js');
    resetDb();
    const { consoleBus } = await import('../../src/console/bus.js');
    consoleBus.emit({
      phase: 'start', reqId: 'seed', ts: '2026-06-09T00:00:00.000Z',
      method: 'POST', path: '/v1/messages', model: 'm', alias: null,
    });

    const res = await app.request('/api/admin/console/stream', {
      headers: { origin: 'http://localhost', host: 'localhost' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('seed');
    await reader.cancel();
  });
});
