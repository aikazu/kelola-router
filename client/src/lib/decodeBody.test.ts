import { describe, expect, it } from 'vitest';
// biome-ignore lint/correctness/noUnusedImports: re-exported type re-verified by downstream tasks
import { type BodyMeta, isTruncated } from './decodeBody';

describe('isTruncated', () => {
  it('returns true when body ends with truncation suffix', () => {
    expect(isTruncated('some data...truncated...')).toBe(true);
  });
  it('returns false for clean body', () => {
    expect(isTruncated('{"ok":true}')).toBe(false);
  });
  it('returns false for null', () => {
    expect(isTruncated(null)).toBe(false);
  });
});
