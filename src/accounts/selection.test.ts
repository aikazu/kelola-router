import { describe, expect, it } from 'vitest';
import { selectAccount } from './selection.js';
import type { AccountState } from './types.js';

function acc(id: string, level = 0, limited = false, enabled = true): AccountState {
  return {
    id,
    backoffLevel: level,
    rateLimitedUntil: limited ? new Date(Date.now() + 60_000).toISOString() : null,
    lastError: null,
    status: 'active',
    enabled,
  };
}

describe('selectAccount', () => {
  describe('lowest-backoff (default)', () => {
    it('picks lowest backoff level', () => {
      const r = selectAccount([acc('a', 3), acc('b', 1), acc('c', 2)]);
      expect(r.account?.id).toBe('b');
      expect(r.reason).toBe('lowest-backoff');
    });

    it('skips rate-limited account', () => {
      const r = selectAccount([acc('a', 0, true), acc('b')]);
      expect(r.account?.id).toBe('b');
    });

    it('skips disabled accounts', () => {
      const r = selectAccount([{ ...acc('a'), enabled: false }, acc('b')]);
      expect(r.account?.id).toBe('b');
    });

    it('returns null if all limited', () => {
      const r = selectAccount([acc('a', 0, true), acc('b', 0, true)]);
      expect(r.account).toBeNull();
    });

    it('works without opts (backwards compat)', () => {
      const r = selectAccount([acc('a'), acc('b')]);
      expect(r.account?.id).toBe('a');
      expect(r.reason).toBe('lowest-backoff');
    });
  });

  describe('round-robin', () => {
    const accounts = [acc('a'), acc('b'), acc('c')];

    it('cycles through available accounts', () => {
      const r0 = selectAccount(accounts, { mode: 'round-robin', cursor: 0 });
      const r1 = selectAccount(accounts, { mode: 'round-robin', cursor: 1 });
      const r2 = selectAccount(accounts, { mode: 'round-robin', cursor: 2 });
      expect(r0.account?.id).toBe('a');
      expect(r0.nextCursor).toBe(1);
      expect(r1.account?.id).toBe('b');
      expect(r2.account?.id).toBe('c');
    });

    it('wraps around when cursor exceeds length', () => {
      const r = selectAccount(accounts, { mode: 'round-robin', cursor: 3 });
      expect(r.account?.id).toBe('a');
      expect(r.nextCursor).toBe(4);
    });

    it('returns reason round-robin', () => {
      const r = selectAccount(accounts, { mode: 'round-robin', cursor: 0 });
      expect(r.reason).toBe('round-robin');
    });
  });

  describe('sticky', () => {
    const accounts = [acc('a', 3), acc('b', 1), acc('c', 2)];

    it('pins account per clientKeyId', () => {
      const stickyMap = new Map<number, string>([[42, 'b']]);
      const r = selectAccount(accounts, { mode: 'sticky', clientKeyId: 42, stickyMap });
      expect(r.account?.id).toBe('b');
      expect(r.reason).toBe('sticky');
    });

    it('falls back to lowest-backoff when pinned account unavailable', () => {
      const withDisabled = [acc('a', 3), acc('b', 1, false, false), acc('c', 2)];
      const stickyMap = new Map<number, string>([[42, 'b']]);
      const r = selectAccount(withDisabled, { mode: 'sticky', clientKeyId: 42, stickyMap });
      expect(r.account?.id).toBe('c');
      expect(r.reason).toBe('fallback');
      expect(stickyMap.get(42)).toBe('c');
    });

    it('falls back and pins when no entry exists', () => {
      const stickyMap = new Map<number, string>();
      const r = selectAccount(accounts, { mode: 'sticky', clientKeyId: 99, stickyMap });
      expect(r.account?.id).toBe('b'); // lowest backoff
      expect(r.reason).toBe('fallback');
      expect(stickyMap.get(99)).toBe('b');
    });
  });

  describe('no accounts available', () => {
    it('returns null for all modes', () => {
      expect(selectAccount([], { mode: 'lowest-backoff' }).account).toBeNull();
      expect(selectAccount([], { mode: 'round-robin', cursor: 0 }).account).toBeNull();
      expect(selectAccount([], { mode: 'sticky', clientKeyId: 1, stickyMap: new Map() }).account).toBeNull();
    });
  });
});
