import { describe, expect, it } from 'vitest';
import {
  DUPLICATE_KEY_MESSAGE,
  friendlyAccountError,
} from '../lib/account-errors';

describe('friendlyAccountError', () => {
  it('maps the raw UNIQUE-constraint marker to a friendly duplicate-key message', () => {
    const raw = 'UNIQUE constraint failed: accounts.api_key';
    expect(friendlyAccountError(raw)).toBe(DUPLICATE_KEY_MESSAGE);
  });

  it('maps the marker even when wrapped with surrounding context', () => {
    const raw = 'INSERT failed: UNIQUE constraint failed: accounts.api_key';
    expect(friendlyAccountError(raw)).toBe(DUPLICATE_KEY_MESSAGE);
  });

  it('passes through unrelated error messages unchanged', () => {
    const other = 'label, api_key required';
    expect(friendlyAccountError(other)).toBe(other);
  });

  it('passes through empty strings unchanged', () => {
    expect(friendlyAccountError('')).toBe('');
  });
});