import { describe, expect, it, vi } from 'vitest';
import { Lru } from './lru.js';

describe('Lru', () => {
  it('evicts least-recently-used entry on overflow', () => {
    const lru = new Lru<number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.get('a'); // 'a' now most-recent
    lru.set('c', 3); // evicts 'b'
    expect(lru.has('a')).toBe(true);
    expect(lru.has('b')).toBe(false);
    expect(lru.has('c')).toBe(true);
  });

  it('calls dispose callback on eviction', () => {
    const dispose = vi.fn();
    const lru = new Lru<number>(1, { dispose });
    lru.set('a', 1);
    lru.set('b', 2);
    expect(dispose).toHaveBeenCalledWith('a', 1);
  });

  it('invalidate(key) removes the entry and calls dispose', () => {
    const dispose = vi.fn();
    const lru = new Lru<number>(2, { dispose });
    lru.set('a', 1);
    lru.invalidate('a');
    expect(lru.has('a')).toBe(false);
    expect(dispose).toHaveBeenCalledWith('a', 1);
  });

  it('invalidate() with no arg clears all entries', () => {
    const dispose = vi.fn();
    const lru = new Lru<number>(2, { dispose });
    lru.set('a', 1);
    lru.set('b', 2);
    lru.invalidate();
    expect(lru.size).toBe(0);
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
