import { describe, expect, it } from 'vitest';
import { safeApply } from './applyFilter.js';
import type { FilterFn } from './types.js';

describe('safeApply', () => {
  it('returns original if filter is undefined', () => {
    expect(safeApply(undefined, 'hello')).toBe('hello');
  });

  it('returns filter output on success', () => {
    const f: FilterFn = ((t: string) => t.toUpperCase()) as FilterFn;
    f.filterName = 'upper';
    expect(safeApply(f, 'hi')).toBe('HI');
  });

  it('returns original if filter throws', () => {
    const f = (() => {
      throw new Error('boom');
    }) as unknown as FilterFn;
    f.filterName = 'boom';
    expect(safeApply(f, 'data')).toBe('data');
  });

  it('returns original if filter returns non-string', () => {
    const f = ((_t: string) => 42 as unknown as string) as FilterFn;
    f.filterName = 'weird';
    expect(safeApply(f, 'x')).toBe('x');
  });
});
