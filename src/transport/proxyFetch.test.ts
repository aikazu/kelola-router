import * as undici from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetEnvProxyMemo, proxyAwareFetch } from './proxyFetch.js';

// The proxy-success path calls undici's `fetch` (module-bound import) so the
// dispatcher option is honored on Node 22 (commit 6292341). Spying
// globalThis.fetch cannot observe that call, and undici's namespace `fetch` is
// non-configurable so vi.spyOn can't touch it either. Mock the module instead,
// keeping the real ProxyAgent (getDispatcher imports it) so dispatcher
// construction still works without any real network.
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: vi.fn() };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(undici.fetch).mockReset();
  _resetEnvProxyMemo();
});

beforeEach(() => {
  _resetEnvProxyMemo();
});

describe('proxyAwareFetch', () => {
  it('relay: sends to relay URL with x-relay-target + x-relay-path headers', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));
    await proxyAwareFetch(
      'https://api.minimax.io/v1/chat/completions',
      { method: 'POST' },
      { relay: { kind: 'vercel', url: 'https://my-relay.vercel.app/api/relay' }, proxy: null }
    );
    const [calledUrl, calledOpts] = spy.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(calledUrl).toBe('https://my-relay.vercel.app/api/relay');
    const headers = calledOpts.headers;
    expect(headers['x-relay-target']).toBe('https://api.minimax.io');
    expect(headers['x-relay-path']).toBe('/v1/chat/completions');
  });

  it('env HTTPS_PROXY: used when no settings proxy', async () => {
    const prev = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';
    try {
      const undiciSpy = vi.mocked(undici.fetch).mockResolvedValue(new Response('ok') as never);
      await proxyAwareFetch('https://api.minimax.io/v1/x', {}, { relay: null, proxy: null });
      const call = undiciSpy.mock.calls[0] as unknown as [string, { dispatcher?: unknown }];
      expect(call[0]).toBe('https://api.minimax.io/v1/x');
      expect(call[1].dispatcher).toBeDefined();
    } finally {
      if (prev === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = prev;
    }
  });

  it('direct: no relay + no proxy -> plain fetch', async () => {
    const prev = process.env.HTTPS_PROXY;
    delete process.env.HTTPS_PROXY;
    try {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
      await proxyAwareFetch('https://api.minimax.io/v1/x', {}, { relay: null, proxy: null });
      const call = spy.mock.calls[0] as [string, { dispatcher?: unknown }];
      expect(call[0]).toBe('https://api.minimax.io/v1/x');
      expect(call[1].dispatcher).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.HTTPS_PROXY = prev;
    }
  });

  it('falls back to direct on proxy dispatcher error', async () => {
    const prev = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = 'http://invalid:9999';
    try {
      // undici fetch rejects (e.g. proxy unreachable) -> code falls back to direct.
      vi.mocked(undici.fetch).mockRejectedValue(new Error('connect ECONNREFUSED'));
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
      await proxyAwareFetch('https://api.minimax.io/v1/x', {}, { relay: null, proxy: null });
      expect(spy).toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = prev;
    }
  });
});
