import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../db/index.js';
import { createAccount, updateAccount } from '../db/repos/accounts.js';
import { clearCache, setSetting } from '../db/repos/settings.js';
import { createTransport, updateTransport } from '../db/repos/transports.js';
import {
  __resetRotationState,
  getProxyFailureMode,
  resolveTransportForAccount,
} from './resolve.js';

let db: ReturnType<typeof openDb>;

function mkAccount(id: string) {
  return createAccount(db, { id, label: id, credit_type: 'payg', api_key: `k_${id}` });
}

beforeEach(() => {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'rs-')), 't.db');
  db = openDb();
  __resetRotationState();
});

describe('resolveTransportForAccount', () => {
  it('returns null when account has no assignment and no global config', () => {
    const acc = mkAccount('a1');
    expect(resolveTransportForAccount(db, acc)).toBeNull();
  });

  it('falls back to global settings.transport when account has no assignment', () => {
    setSetting(db, 'transport', {
      relay: null,
      proxy: { kind: 'http', url: 'http://global:8080' },
    });
    const acc = mkAccount('a2');
    const cfg = resolveTransportForAccount(db, acc);
    expect(cfg?.proxy?.url).toBe('http://global:8080');
  });

  it('does not keep a stale cached global fallback after settings.transport changes', () => {
    setSetting(db, 'transport', {
      relay: null,
      proxy: { kind: 'http', url: 'http://global-old:8080' },
    });
    const acc = mkAccount('a2b');

    const first = resolveTransportForAccount(db, acc);

    setSetting(db, 'transport', {
      relay: null,
      proxy: { kind: 'http', url: 'http://global-new:8080' },
    });
    clearCache();
    const second = resolveTransportForAccount(db, acc);

    expect(first?.proxy?.url).toBe('http://global-old:8080');
    expect(second?.proxy?.url).toBe('http://global-new:8080');
  });

  it('resolves a single proxy assignment', () => {
    createTransport(db, {
      id: 'p1',
      label: 'p1',
      type: 'proxy',
      kind: 'socks5',
      url: 'socks5://1.2.3.4:1080',
    });
    const acc = mkAccount('a3');
    updateAccount(db, acc.id, { proxy_id: 'p1' });
    const cfg = resolveTransportForAccount(db, { ...acc, proxy_id: 'p1' });
    expect(cfg).toEqual({ relay: null, proxy: { kind: 'socks5', url: 'socks5://1.2.3.4:1080' } });
  });

  it('resolves a single relay assignment and ignores proxy', () => {
    createTransport(db, {
      id: 'r1',
      label: 'r1',
      type: 'relay',
      kind: 'vercel',
      url: 'https://relay.app',
    });
    createTransport(db, { id: 'p1', label: 'p1', type: 'proxy', kind: 'http', url: 'http://p' });
    const acc = mkAccount('a4');
    const cfg = resolveTransportForAccount(db, { ...acc, relay_id: 'r1', proxy_id: 'p1' });
    expect(cfg).toEqual({ relay: { kind: 'vercel', url: 'https://relay.app' }, proxy: null });
  });

  it('relay takes priority over global config too', () => {
    setSetting(db, 'transport', { relay: null, proxy: { kind: 'http', url: 'http://global' } });
    createTransport(db, {
      id: 'r1',
      label: 'r1',
      type: 'relay',
      kind: 'cloudflare',
      url: 'https://cf.app',
    });
    const acc = mkAccount('a5');
    const cfg = resolveTransportForAccount(db, { ...acc, relay_id: 'r1' });
    expect(cfg?.relay?.url).toBe('https://cf.app');
    expect(cfg?.proxy).toBeNull();
  });

  it('rotates through a proxy pool every N requests', () => {
    createTransport(db, { id: 'p1', label: 'p1', type: 'proxy', kind: 'http', url: 'http://p1' });
    createTransport(db, { id: 'p2', label: 'p2', type: 'proxy', kind: 'http', url: 'http://p2' });
    const acc = {
      ...mkAccount('a6'),
      proxy_pool: JSON.stringify(['p1', 'p2']),
      proxy_rotate_every: 2,
    };
    // every=2: req1->p1, req2->p1, req3->p2, req4->p2, req5->p1
    const urls = Array.from({ length: 5 }, () => resolveTransportForAccount(db, acc)?.proxy?.url);
    expect(urls).toEqual(['http://p1', 'http://p1', 'http://p2', 'http://p2', 'http://p1']);
  });

  it('skips disabled members of the pool', () => {
    createTransport(db, {
      id: 'p1',
      label: 'p1',
      type: 'proxy',
      kind: 'http',
      url: 'http://p1',
      enabled: false,
    });
    createTransport(db, { id: 'p2', label: 'p2', type: 'proxy', kind: 'http', url: 'http://p2' });
    const acc = {
      ...mkAccount('a7'),
      proxy_pool: JSON.stringify(['p1', 'p2']),
      proxy_rotate_every: 1,
    };
    const urls = Array.from({ length: 3 }, () => resolveTransportForAccount(db, acc)?.proxy?.url);
    expect(urls).toEqual(['http://p2', 'http://p2', 'http://p2']);
  });

  it('treats rotate_every < 1 as 1', () => {
    createTransport(db, { id: 'p1', label: 'p1', type: 'proxy', kind: 'http', url: 'http://p1' });
    createTransport(db, { id: 'p2', label: 'p2', type: 'proxy', kind: 'http', url: 'http://p2' });
    const acc = {
      ...mkAccount('a8'),
      proxy_pool: JSON.stringify(['p1', 'p2']),
      proxy_rotate_every: 0,
    };
    const urls = Array.from({ length: 3 }, () => resolveTransportForAccount(db, acc)?.proxy?.url);
    expect(urls).toEqual(['http://p1', 'http://p2', 'http://p1']);
  });

  it('falls back to global when pool is empty or all disabled', () => {
    setSetting(db, 'transport', { relay: null, proxy: { kind: 'http', url: 'http://global' } });
    createTransport(db, {
      id: 'p1',
      label: 'p1',
      type: 'proxy',
      kind: 'http',
      url: 'http://p1',
      enabled: false,
    });
    const acc = { ...mkAccount('a9'), proxy_pool: JSON.stringify(['p1']), proxy_rotate_every: 1 };
    expect(resolveTransportForAccount(db, acc)?.proxy?.url).toBe('http://global');
  });

  it('ignores a missing single proxy id and falls back to global', () => {
    setSetting(db, 'transport', { relay: null, proxy: { kind: 'http', url: 'http://global' } });
    const acc = { ...mkAccount('a10'), proxy_id: 'ghost' };
    expect(resolveTransportForAccount(db, acc)?.proxy?.url).toBe('http://global');
  });

  it('caches resolved proxy pool transport for a short TTL', () => {
    createTransport(db, { id: 'p1', label: 'p1', type: 'proxy', kind: 'http', url: 'http://p1' });
    createTransport(db, { id: 'p2', label: 'p2', type: 'proxy', kind: 'http', url: 'http://p2' });
    const acc = {
      ...mkAccount('a11'),
      proxy_pool: JSON.stringify(['p1', 'p2']),
      proxy_rotate_every: 10,
    };

    const first = resolveTransportForAccount(db, acc);
    const second = resolveTransportForAccount(db, acc);

    expect(first?.proxy?.url).toBe('http://p1');
    expect(second?.proxy?.url).toBe('http://p1');
  });

  it('expires resolved proxy pool transport cache after the short TTL', () => {
    vi.useFakeTimers();
    createTransport(db, { id: 'p1', label: 'p1', type: 'proxy', kind: 'http', url: 'http://p1' });
    createTransport(db, { id: 'p2', label: 'p2', type: 'proxy', kind: 'http', url: 'http://p2' });
    const acc = {
      ...mkAccount('a11b'),
      proxy_pool: JSON.stringify(['p1', 'p2']),
      proxy_rotate_every: 1,
    };

    const first = resolveTransportForAccount(db, acc);
    vi.advanceTimersByTime(1001);
    const second = resolveTransportForAccount(db, acc);

    expect(first?.proxy?.url).toBe('http://p1');
    expect(second?.proxy?.url).toBe('http://p2');
    vi.useRealTimers();
  });

  it('invalidates resolved transport cache when a transport changes', () => {
    createTransport(db, { id: 'p1', label: 'p1', type: 'proxy', kind: 'http', url: 'http://old' });
    const acc = { ...mkAccount('a12'), proxy_id: 'p1' };

    const first = resolveTransportForAccount(db, acc);
    updateTransport(db, 'p1', { url: 'http://new' });
    const second = resolveTransportForAccount(db, acc);

    expect(first?.proxy?.url).toBe('http://old');
    expect(second?.proxy?.url).toBe('http://new');
  });
});

describe('getProxyFailureMode', () => {
  it("defaults to 'direct' when unset", () => {
    expect(getProxyFailureMode(db)).toBe('direct');
  });

  it("defaults to 'direct' for legacy transport setting without the key", () => {
    setSetting(db, 'transport', { relay: null, proxy: null });
    expect(getProxyFailureMode(db)).toBe('direct');
  });

  it("returns 'block' when configured", () => {
    setSetting(db, 'transport', { relay: null, proxy: null, proxyFailureMode: 'block' });
    expect(getProxyFailureMode(db)).toBe('block');
  });
});
