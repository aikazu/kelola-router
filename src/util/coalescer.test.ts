import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Coalescer } from './coalescer.js';

describe('Coalescer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces multiple pushes into one flush call', () => {
    const flush = vi.fn();
    const c = new Coalescer<string>({ intervalMs: 50, highWater: 100, flush });
    c.push('a');
    c.push('b');
    c.push('c');
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith(['a', 'b', 'c']);
  });

  it('drops oldest items past the high-water mark', () => {
    const flush = vi.fn();
    const c = new Coalescer<number>({ intervalMs: 50, highWater: 3, flush });
    c.push(1);
    c.push(2);
    c.push(3);
    c.push(4); // drops 1
    c.push(5); // drops 2
    vi.advanceTimersByTime(50);
    expect(flush).toHaveBeenCalledWith([3, 4, 5]);
  });

  it('dispose() flushes immediately and stops the timer', () => {
    const flush = vi.fn();
    const c = new Coalescer<string>({ intervalMs: 50, highWater: 100, flush });
    c.push('a');
    c.dispose();
    expect(flush).toHaveBeenCalledWith(['a']);
    c.push('b');
    vi.advanceTimersByTime(50);
    expect(flush).toHaveBeenCalledOnce();
  });
});
