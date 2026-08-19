// src/proxy/notion.error.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getModelLock } from '../accounts/locks.js';
import { openDb } from '../db/index.js';
import { createAccount, getAccount } from '../db/repos/accounts.js';
import { NOTION_AI_COOKIE_NAMES } from '../providers/notion/constants.js';

function seedNotionCookies(): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const n of NOTION_AI_COOKIE_NAMES) cookies[n] = 'c';
  return cookies;
}

describe('handleNotionProxy error handling', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'notion-')), 't.db');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks the account as error on a 401 upstream (cookie expiry)', async () => {
    const { handleNotionProxy } = await import('./notion.js');
    const db = openDb();
    const acc = createAccount(db, {
      id: 'acc_n1',
      label: 'n',
      credit_type: 'payg',
      api_key: 'kk',
      provider: 'notion',
      enabled: true,
      provider_data: JSON.stringify({ cookies: seedNotionCookies(), spaceId: 's' }),
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unauthorized', { status: 401 }));

    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) =>
        k === 'clientKey' ? { id: 'ck_row_1' } : k === 'startTime' ? Date.now() : undefined,
      set: () => {},
      json: (o: unknown, s?: number) => new Response(JSON.stringify(o), { status: s ?? 200 }),
    } as unknown as Parameters<typeof handleNotionProxy>[0];

    await handleNotionProxy(
      c,
      'openai',
      '/v1/chat/completions',
      {
        model: 'notion',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      },
      db,
      { value: 0 },
      new Map()
    );
    expect(getAccount(db, acc.id)!.status).toBe('error');
  });

  it('sets a model lock on a 429 upstream', async () => {
    const { handleNotionProxy } = await import('./notion.js');
    const db = openDb();
    createAccount(db, {
      id: 'acc_n2',
      label: 'n',
      credit_type: 'payg',
      api_key: 'kk',
      provider: 'notion',
      enabled: true,
      provider_data: JSON.stringify({ cookies: seedNotionCookies(), spaceId: 's' }),
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('rate limit', { status: 429 }));

    const c = {
      req: { method: 'POST', raw: { headers: new Headers() } },
      get: (k: string) =>
        k === 'clientKey' ? { id: 'ck_row_1' } : k === 'startTime' ? Date.now() : undefined,
      set: () => {},
      json: (o: unknown, s?: number) => new Response(JSON.stringify(o), { status: s ?? 200 }),
    } as unknown as Parameters<typeof handleNotionProxy>[0];

    await handleNotionProxy(
      c,
      'openai',
      '/v1/chat/completions',
      {
        model: 'notion',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      },
      db,
      { value: 0 },
      new Map()
    );
    expect(getModelLock(db, 'acc_n2', 'notion')).toBeDefined();
  });
});
