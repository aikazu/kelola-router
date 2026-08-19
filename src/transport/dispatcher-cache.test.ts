import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetDispatcherCacheForTests,
  getDispatcher,
  invalidateDispatcher,
} from './dispatcher-cache.js';

describe('dispatcherCache', () => {
  beforeEach(() => {
    _resetDispatcherCacheForTests();
  });
  afterEach(() => {
    _resetDispatcherCacheForTests();
  });

  it('returns the same agent for the same URL on repeat calls', async () => {
    const a1 = await getDispatcher('http://proxy.example:8080');
    const a2 = await getDispatcher('http://proxy.example:8080');
    expect(a1).toBe(a2);
  });

  it('returns a different agent for a different URL', async () => {
    const a1 = await getDispatcher('http://proxy-a.example:8080');
    const a2 = await getDispatcher('http://proxy-b.example:8080');
    expect(a1).not.toBe(a2);
  });

  it('invalidateDispatcher(url) forces a fresh agent on next getDispatcher', async () => {
    const a1 = await getDispatcher('http://proxy.example:8080');
    invalidateDispatcher('http://proxy.example:8080');
    const a2 = await getDispatcher('http://proxy.example:8080');
    expect(a1).not.toBe(a2);
  });

  it('invalidateDispatcher() with no arg clears the whole cache', async () => {
    const a1 = await getDispatcher('http://a.example:8080');
    const b1 = await getDispatcher('http://b.example:8080');
    invalidateDispatcher();
    const a2 = await getDispatcher('http://a.example:8080');
    const b2 = await getDispatcher('http://b.example:8080');
    expect(a1).toBeDefined();
    expect(b1).toBeDefined();
    expect(a2).toBeDefined();
    expect(b2).toBeDefined();
    // After clear, both URLs must produce fresh agents.
    expect(a1).not.toBe(a2);
    expect(b1).not.toBe(b2);
  });
});
