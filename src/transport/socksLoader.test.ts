import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetSocksCacheForTests, getSocksDispatcher, invalidateSocks } from './socksLoader.js';

describe('socksLoader cache', () => {
  beforeEach(() => _resetSocksCacheForTests());
  afterEach(() => _resetSocksCacheForTests());

  it('returns the same dispatcher for the same URL', async () => {
    const a = await getSocksDispatcher('socks5://user:pass@127.0.0.1:1080');
    const b = await getSocksDispatcher('socks5://user:pass@127.0.0.1:1080');
    expect(a).toBe(b);
  });

  it('returns a different dispatcher for a different URL', async () => {
    const a = await getSocksDispatcher('socks5://127.0.0.1:1080');
    const b = await getSocksDispatcher('socks5://127.0.0.1:1081');
    expect(a).not.toBe(b);
  });

  it('invalidateSocks(url) forces a fresh dispatcher', async () => {
    const a = await getSocksDispatcher('socks5://127.0.0.1:1080');
    invalidateSocks('socks5://127.0.0.1:1080');
    const b = await getSocksDispatcher('socks5://127.0.0.1:1080');
    expect(a).not.toBe(b);
  });
});
