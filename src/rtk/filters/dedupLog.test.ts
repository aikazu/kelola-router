import { describe, expect, it } from 'vitest';
import { dedupLog } from './dedupLog.js';

describe('dedupLog', () => {
  it('collapses repeated lines after 3 occurrences', async () => {
    const lines = ['a', 'a', 'a', 'a', 'a', 'b', 'b', 'b', 'b'];
    const out = dedupLog(lines.join('\n'));
    expect(out).toContain('a\na\na\n... [a repeated]');
    expect(out).toContain('b\nb\nb\n... [b repeated]');
  });
});
