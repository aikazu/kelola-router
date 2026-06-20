import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetLockCleanupThrottle, getModelLock } from '../accounts/locks.js';
import { openDb } from '../db/index.js';
import { createAccount, getAccount } from '../db/repos/accounts.js';
import { handleUpstreamError } from './errorHandling.js';

describe('handleUpstreamError', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'eh-')), 't.db');
    _resetLockCleanupThrottle();
  });

  it('applies error state + sets a model lock on a 429 rate-limit', () => {
    const db = openDb();
    const acc = createAccount(db, {
      id: 'acc_1',
      label: 'L',
      credit_type: 'payg',
      api_key: 'kk',
      provider: 'codebuddy',
      enabled: true,
    });
    const resp = new Response('rate limit reached', { status: 429 });
    const { decision } = handleUpstreamError(db, {
      account: acc,
      acc: {
        id: acc.id,
        backoffLevel: 0,
        rateLimitedUntil: null,
        lastError: null,
        status: 'active',
        enabled: true,
      },
      status: 429,
      errBody: 'rate limit reached',
      response: resp,
      upstreamModel: 'cb/claude-opus-4.6',
    });
    expect(decision.cooldownMs).toBeGreaterThan(0);
    const after = getAccount(db, acc.id)!;
    expect(after.rate_limited_until).not.toBeNull();
    expect(getModelLock(db, acc.id, 'cb/claude-opus-4.6')).toBeDefined();
    expect(after.enabled).toBe(1); // not balance → not disabled
  });

  it('disables the account when source is balance (base_resp 1008)', () => {
    const db = openDb();
    const acc = createAccount(db, {
      id: 'acc_2',
      label: 'L',
      credit_type: 'payg',
      api_key: 'kk',
      provider: 'minimax',
      enabled: true,
    });
    const body = JSON.stringify({ base_resp: { status_code: 1008 } });
    const resp = new Response(body, { status: 402 });
    handleUpstreamError(db, {
      account: acc,
      acc: {
        id: acc.id,
        backoffLevel: 0,
        rateLimitedUntil: null,
        lastError: null,
        status: 'active',
        enabled: true,
      },
      status: 402,
      errBody: body,
      response: resp,
      upstreamModel: 'MiniMax-M2',
    });
    expect(getAccount(db, acc.id)!.enabled).toBe(0);
  });

  it('respects retry-after header when present', () => {
    const db = openDb();
    const acc = createAccount(db, {
      id: 'acc_3',
      label: 'L',
      credit_type: 'payg',
      api_key: 'kk',
      provider: 'codebuddy',
      enabled: true,
    });
    const resp = new Response('slow down', { status: 429, headers: { 'retry-after': '7' } });
    const { decision } = handleUpstreamError(db, {
      account: acc,
      acc: {
        id: acc.id,
        backoffLevel: 0,
        rateLimitedUntil: null,
        lastError: null,
        status: 'active',
        enabled: true,
      },
      status: 429,
      errBody: 'slow down',
      response: resp,
      upstreamModel: 'cb/x',
    });
    expect(decision.cooldownMs).toBe(7000);
  });

  it('parses from body-only when no Response is supplied (kiro path)', () => {
    const db = openDb();
    const acc = createAccount(db, {
      id: 'acc_4',
      label: 'L',
      credit_type: 'payg',
      api_key: 'kk',
      provider: 'kiro',
      enabled: true,
    });
    const { parsed } = handleUpstreamError(db, {
      account: acc,
      acc: {
        id: acc.id,
        backoffLevel: 0,
        rateLimitedUntil: null,
        lastError: null,
        status: 'active',
        enabled: true,
      },
      status: 429,
      errBody: 'rate limit',
      response: undefined,
      upstreamModel: 'kiro/x',
      retryAfterSec: 3,
    });
    expect(parsed.baseRespCode).toBeUndefined();
    expect(getModelLock(db, acc.id, 'kiro/x')).toBeDefined();
  });
});
