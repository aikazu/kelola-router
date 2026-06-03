import { describe, expect, it } from 'vitest';
import { getUpstreamFormat } from './negotiate.js';

describe('getUpstreamFormat', () => {
  it('returns client format when no override is configured', () => {
    expect(getUpstreamFormat('openai', 'auto')).toBe('openai');
    expect(getUpstreamFormat('anthropic', 'auto')).toBe('anthropic');
  });

  it('returns the override when set to openai or anthropic', () => {
    expect(getUpstreamFormat('anthropic', 'openai')).toBe('openai');
    expect(getUpstreamFormat('openai', 'anthropic')).toBe('anthropic');
  });

  it("treats unknown override values as 'auto'", () => {
    // Cast bypasses type check on purpose — runtime may receive garbage.
    expect(getUpstreamFormat('anthropic', 'weird' as unknown as 'auto')).toBe('anthropic');
  });
});
