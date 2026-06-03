import { describe, expect, it } from 'vitest';
import { getQuotaCooldown } from './backoff.js';

describe('getQuotaCooldown', () => {
  it('level 1 → 1s', () => expect(getQuotaCooldown(1)).toBe(1000));
  it('level 2 → 2s', () => expect(getQuotaCooldown(2)).toBe(2000));
  it('level 3 → 4s', () => expect(getQuotaCooldown(3)).toBe(4000));
  it('level 4 → 8s', () => expect(getQuotaCooldown(4)).toBe(8000));
  it('level 8 → 4 min cap (240000ms)', () => expect(getQuotaCooldown(8)).toBe(240_000));
  it('level 9 → also 4 min cap', () => expect(getQuotaCooldown(9)).toBe(240_000));
  it('level 0 → 0 (no cooldown)', () => expect(getQuotaCooldown(0)).toBe(0));
});
