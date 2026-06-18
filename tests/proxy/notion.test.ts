import { ulid } from 'ulid';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { createAccount } from '../../src/db/repos/accounts.js';
import { upsertModel } from '../../src/db/repos/models.js';
import { handleNotionProxy } from '../../src/proxy/notion.js';

/**
 * Integration test for handleNotionProxy.
 *
 * Verifies:
 * - wire-format body sent to upstream (via mocked fetch)
 * - OpenAI SSE output emitted correctly
 * - error paths (no account, missing cookies, upstream 401, upstream 200 with
 *   NDJSON stream)
 *
 * Real upstream Notion calls are stubbed via fetch mock. The proxy is
 * exercised end-to-end (auth → transform → upstream → extract → SSE).
 */

interface MockContext {
  get(key: string): unknown;
  json(body: unknown, status?: number): Response;
}

function makeCtx(): MockContext {
  return {
    get: (key: string) => (key === 'clientKey' ? { id: 1 } : undefined),
    json: (body: unknown, status?: number) =>
      new Response(JSON.stringify(body), {
        status: status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
  };
}

function makeResponse(opts: { status: number; body: string; contentType?: string }): Response {
  const headers = new Headers();
  headers.set('content-type', opts.contentType ?? 'application/x-ndjson');
  return new Response(opts.body, { status: opts.status, headers });
}

function seedAccount(opts: { cookies?: Record<string, string>; spaceId?: string } = {}) {
  const db = openDb();
  const id = ulid();
  createAccount(db, {
    id,
    label: 'test',
    credit_type: 'token-plan',
    api_key: 'fake-user-id',
    enabled: true,
    provider: 'notion',
    provider_data: JSON.stringify({
      cookies: opts.cookies ?? {
        device_id: 'd1',
        notion_browser_id: 'b1',
        notion_check_cookie_consent: 'false',
        notion_user_id: 'u1',
        notion_sync_user_id: '%7B%7D',
        NEXT_LOCALE: 'en-US',
        p_sync_session: '%7B%7D',
        _cioid: 'c1',
        notion_locale: 'en-US',
        notion_users: '%5B%22u1%22%5D',
        token_v2: 'v03:abc',
      },
      spaceId: opts.spaceId ?? 'space-1',
      userId: 'u1',
    }),
  });
  // Seed a model so resolveModel works
  upsertModel(db, {
    name: 'notion-gpt-5.5',
    upstream_model: 'opal-quince-medium',
    display_name: 'Notion GPT-5.5',
    family: 'openai',
    context_window: 8192,
    pricing_input: 0,
    pricing_output: 0,
    pricing_cache_read: 0,
    pricing_cache_write: 0,
    source: 'builtin',
    provider: 'notion',
  });
  return id;
}

beforeAll(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    return new Response(
      [
        JSON.stringify({ type: 'patch-start', data: { s: [] }, version: 1 }),
        JSON.stringify({
          type: 'patch',
          v: [
            {
              o: 'a',
              p: '/s/-',
              v: {
                id: 'inf-1',
                type: 'agent-inference',
                value: [{ type: 'text', content: '' }],
                traceId: 't1',
              },
            },
          ],
        }),
        JSON.stringify({
          type: 'patch',
          v: [{ o: 'x', p: '/s/0/value/0/content', v: 'Hello from Notion!' }],
        }),
        JSON.stringify({ type: 'done' }),
      ].join('\n'),
      { status: 200, headers: { 'content-type': 'application/x-ndjson' } }
    );
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  const db = openDb();
  try {
    db.exec('DELETE FROM accounts');
    db.exec('DELETE FROM models');
  } finally {
    db.close();
  }
});

describe('handleNotionProxy — integration', () => {
  it('returns 503 when no Notion account exists', async () => {
    const db = openDb();
    try {
      const res = await handleNotionProxy(
        makeCtx() as never,
        'openai',
        '/v1/chat/completions',
        { model: 'nt/notion-gpt-5.5', messages: [{ role: 'user', content: 'hi' }] },
        db,
        { value: 0 },
        new Map()
      );
      expect(res.status).toBe(503);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('no_account');
    } finally {
      db.close();
    }
  });

  it('returns 401 notion_reauth_required when cookies missing', async () => {
    const db = openDb();
    try {
      const id = ulid();
      createAccount(db, {
        id,
        label: 'no-cookies',
        credit_type: 'token-plan',
        api_key: 'fake',
        enabled: true,
        provider: 'notion',
        provider_data: JSON.stringify({ cookies: {}, spaceId: 'space-1' }),
      });
      const res = await handleNotionProxy(
        makeCtx() as never,
        'openai',
        '/v1/chat/completions',
        { model: 'nt/notion-gpt-5.5', messages: [{ role: 'user', content: 'hi' }] },
        db,
        { value: 0 },
        new Map()
      );
      expect(res.status).toBe(401);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('notion_reauth_required');
    } finally {
      db.close();
    }
  });

  it('returns 401 notion_reauth_required when spaceId missing', async () => {
    const db = openDb();
    try {
      const id = ulid();
      createAccount(db, {
        id,
        label: 'no-space',
        credit_type: 'token-plan',
        api_key: 'fake',
        enabled: true,
        provider: 'notion',
        provider_data: JSON.stringify({
          cookies: {
            device_id: 'd',
            notion_browser_id: 'b',
            notion_check_cookie_consent: 'false',
            notion_user_id: 'u',
            notion_sync_user_id: '%7B%7D',
            NEXT_LOCALE: 'en-US',
            p_sync_session: '%7B%7D',
            _cioid: 'c',
            notion_locale: 'en-US',
            notion_users: '%5B%22u%22%5D',
            token_v2: 'v03:abc',
          },
          spaceId: null,
        }),
      });
      const res = await handleNotionProxy(
        makeCtx() as never,
        'openai',
        '/v1/chat/completions',
        { model: 'nt/notion-gpt-5.5', messages: [{ role: 'user', content: 'hi' }] },
        db,
        { value: 0 },
        new Map()
      );
      expect(res.status).toBe(401);
    } finally {
      db.close();
    }
  });

  it('translates NDJSON response to OpenAI SSE chunks', async () => {
    seedAccount();
    const db = openDb();
    try {
      const res = await handleNotionProxy(
        makeCtx() as never,
        'openai',
        '/v1/chat/completions',
        {
          model: 'nt/notion-gpt-5.5',
          messages: [{ role: 'user', content: 'hi' }],
          stream: true,
        },
        db,
        { value: 0 },
        new Map()
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
      }
      // Each chunk is a JSON `data:` line
      const dataLines = buf
        .split('\n\n')
        .filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]');
      expect(dataLines.length).toBeGreaterThanOrEqual(1);
      // Concatenate all delta.content values to verify the full text reached client
      const fullText = dataLines
        .map(
          (line) =>
            JSON.parse(line.slice('data: '.length)) as {
              choices: Array<{ delta: { content?: string } }>;
            }
        )
        .map((chunk) => chunk.choices[0]?.delta.content ?? '')
        .join('');
      expect(fullText).toBe('Hello from Notion!');
      expect(buf).toContain('data: [DONE]');
    } finally {
      db.close();
    }
  });

  it('sends upstream body in wire-format JSON', async () => {
    seedAccount();
    const db = openDb();
    let captured: { url: string; body: string; headers: Headers } | null = null;
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, init) => {
      captured = {
        url: String(url),
        body: String(init?.body ?? ''),
        headers:
          init?.headers instanceof Headers
            ? init.headers
            : new Headers(init?.headers as Record<string, string>),
      };
      return makeResponse({
        status: 200,
        body: [
          JSON.stringify({ type: 'patch-start', data: { s: [] }, version: 1 }),
          JSON.stringify({ type: 'done' }),
        ].join('\n'),
      });
    }) as unknown as typeof fetch;
    try {
      await handleNotionProxy(
        makeCtx() as never,
        'openai',
        '/v1/chat/completions',
        {
          model: 'nt/notion-gpt-5.5',
          messages: [
            { role: 'system', content: 'be terse' },
            { role: 'user', content: 'hi' },
          ],
        },
        db,
        { value: 0 },
        new Map()
      );
      expect(captured).not.toBeNull();
      const upstream = JSON.parse(captured!.body);
      expect(upstream.traceId).toBeDefined();
      expect(upstream.spaceId).toBe('space-1');
      expect(upstream.transcript).toHaveLength(5); // config + instruction + turn + 2 inferences
      const types = upstream.transcript.map((r: { type: string }) => r.type);
      expect(types).toEqual([
        'config',
        'agent-instruction-state',
        'agent-turn-full-record-map',
        'agent-inference',
        'agent-inference',
      ]);
      expect(upstream.transcript[0].value.model).toBe('opal-quince-medium');
      expect(captured!.headers.get('notion-client-version')).toBe('23.13.20260617.2303');
      expect(captured!.headers.get('accept')).toBe('application/x-ndjson');
      const cookie = captured!.headers.get('cookie')!;
      expect(cookie).toContain('token_v2=v03:abc');
      expect(cookie).toContain('notion_user_id=u1');
    } finally {
      globalThis.fetch = origFetch;
      db.close();
    }
  });
});
