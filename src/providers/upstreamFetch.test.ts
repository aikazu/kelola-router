import { afterEach, describe, expect, it, vi } from 'vitest';
import { upstreamFetch } from './upstreamFetch.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('upstreamFetch', () => {
  it('POSTs JSON body to the given URL and returns the response', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('ok', { status: 200, headers: { 'content-type': 'application/json' } })
      );
    const resp = await upstreamFetch(
      'https://api.example.com/v1/x',
      { hello: 'world' },
      { 'x-test': '1' }
    );
    expect(resp.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = spy.mock.calls[0];
    expect(calledUrl).toBe('https://api.example.com/v1/x');
    expect((calledInit as RequestInit).method).toBe('POST');
    expect((calledInit as RequestInit).headers).toMatchObject({
      'x-test': '1',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse((calledInit as RequestInit).body as string)).toEqual({ hello: 'world' });
  });

  it('passes null transport config (direct fetch) by default', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    await upstreamFetch('https://api.example.com/v1/x', { a: 1 });
    // spy is called once and no error thrown — direct path works
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
