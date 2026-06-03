import { describe, expect, it } from 'vitest';
import { smartTruncate } from './smartTruncate.js';

describe('smartTruncate', () => {
  it('returns original for short text', () => {
    const text = Array(100).fill('line').join('\n');
    expect(smartTruncate(text)).toBe(text);
  });

  it('truncates text with >250 lines, keeps head + tail', () => {
    const lines = Array(500)
      .fill(0)
      .map((_, i) => `line ${i}`);
    const out = smartTruncate(lines.join('\n'));
    expect(out).toContain('line 0');
    expect(out).toContain('line 499');
    expect(out).toContain('[320 lines truncated]');
    expect(out.split('\n').length).toBeLessThan(500);
  });
});
