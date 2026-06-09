import { afterEach, describe, expect, it } from 'vitest';
import { _resetRateLimitForTests, recordLoginFailure } from './rateLimit.js';

afterEach(() => {
  _resetRateLimitForTests();
});

describe('rateLimit opportunistic sweep', () => {
  it('does not crash when many distinct IPs are recorded', () => {
    for (let i = 0; i < 15_000; i++) {
      recordLoginFailure(`ip-${i}`);
    }
    // No assertion needed — the test passes if the sweep doesn't OOM/throw.
    expect(true).toBe(true);
  });
});
