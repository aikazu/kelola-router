import { describe, expect, it, vi } from 'vitest';
import type { FallbackDecision } from '../accounts/errorRules.js';
import type { AccountState } from '../accounts/types.js';
import type { Account } from '../db/repos/accounts.js';

// Import from pipeline.ts — implementation lives there
import {
  applyErrorState,
  buildAccountStates,
  buildLogRow,
  clearErrorState,
  type Db,
  type LogRowContext,
} from './pipeline.js';

// ---------------------------------------------------------------------------
// Helper — build a minimal AccountRow
// ---------------------------------------------------------------------------
function makeAccountRow(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    label: 'test-account',
    credit_type: 'payg',
    api_key: 'sk-test',
    base_url: null,
    enabled: true,
    rate_limited_until: null,
    backoff_level: 0,
    last_error: null,
    status: 'active',
    created_at: '2024-01-01T00:00:00.000Z',
    provider: 'minimax',
    access_token: null,
    token_expires_at: null,
    provider_data: null,
    relay_id: null,
    proxy_id: null,
    proxy_pool: null,
    proxy_rotate_every: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — buildAccountStates
// ---------------------------------------------------------------------------

describe('buildAccountStates', () => {
  it('parses last_error from valid JSON string', () => {
    const row = makeAccountRow({
      last_error: '{"status":429,"message":"rate limited","timestamp":"2024-01-01T00:00:00Z"}',
    });
    const states = buildAccountStates([row]);
    expect(states).toHaveLength(1);
    expect(states[0].lastError).toEqual({
      status: 429,
      message: 'rate limited',
      timestamp: '2024-01-01T00:00:00Z',
    });
  });

  it('sets lastError to null when last_error is null', () => {
    const states = buildAccountStates([makeAccountRow({ last_error: null })]);
    expect(states[0].lastError).toBeNull();
  });

  it('sets lastError to null on malformed JSON (safe)', () => {
    const states = buildAccountStates([makeAccountRow({ last_error: '{not valid json' })]);
    expect(states[0].lastError).toBeNull();
  });

  it('sets rateLimitedUntil to null when rate_limited_until is null', () => {
    const states = buildAccountStates([makeAccountRow({ rate_limited_until: null })]);
    expect(states[0].rateLimitedUntil).toBeNull();
  });

  it('preserves future rate_limited_until timestamp', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const states = buildAccountStates([makeAccountRow({ rate_limited_until: future })]);
    expect(states[0].rateLimitedUntil).toBe(future);
  });

  it('marks disabled account as enabled=false', () => {
    const states = buildAccountStates([makeAccountRow({ enabled: false })]);
    expect(states[0].enabled).toBe(false);
  });

  it('marks enabled account as enabled=true', () => {
    const states = buildAccountStates([makeAccountRow({ enabled: true })]);
    expect(states[0].enabled).toBe(true);
  });

  it('maps all AccountRow fields correctly', () => {
    const future = new Date(Date.now() + 30_000).toISOString();
    const row = makeAccountRow({
      id: 'acc-xyz',
      backoff_level: 3,
      rate_limited_until: future,
      last_error: '{"status":500,"message":"server error","timestamp":"2024-01-01T00:00:00Z"}',
      status: 'error',
      enabled: true,
    });
    const [s] = buildAccountStates([row]);
    expect(s.id).toBe('acc-xyz');
    expect(s.backoffLevel).toBe(3);
    expect(s.rateLimitedUntil).toBe(future);
    expect(s.lastError).toEqual({
      status: 500,
      message: 'server error',
      timestamp: '2024-01-01T00:00:00Z',
    });
    expect(s.status).toBe('error');
    expect(s.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — buildLogRow
// ---------------------------------------------------------------------------

describe('buildLogRow', () => {
  const makeCtx = (overrides: Partial<LogRowContext> = {}): LogRowContext => ({
    clientKeyId: 1,
    accountId: 'acc-1',
    model: 'MiniMax-M3',
    requestedModel: 'MiniMax-M3',
    endpoint: '/v1/chat/completions',
    format: 'openai',
    promptTokens: 100,
    completionTokens: 200,
    cacheCreationTokens: 0,
    cacheReadTokens: 50,
    totalTokens: 300,
    costUsd: 0.005,
    latencyMs: 450,
    statusCode: 200,
    baseRespCode: undefined,
    stream: 0,
    rtkBytesSaved: 0,
    requestBody: '{"messages":[{"role":"user","content":"hello"}]}',
    responseBody: '{"choices":[{"message":{"role":"assistant","content":"hi"}}]}',
    requestHeaders: new Headers({
      'content-type': 'application/json',
      authorization: 'Bearer sk-xxx',
    }),
    responseHeaders: new Headers({ 'content-type': 'application/json' }),
    reqId: 'req-abc-123',
    ...overrides,
  });

  it('returns an object with all 20 required fields', () => {
    const ctx = makeCtx();
    const row = buildLogRow(ctx);
    expect(row.client_key_id).toBe(1);
    expect(row.account_id).toBe('acc-1');
    expect(row.model).toBe('MiniMax-M3');
    expect(row.requested_model).toBe('MiniMax-M3');
    expect(row.endpoint).toBe('/v1/chat/completions');
    expect(row.format).toBe('openai');
    expect(row.prompt_tokens).toBe(100);
    expect(row.completion_tokens).toBe(200);
    expect(row.cache_creation_tokens).toBe(0);
    expect(row.cache_read_tokens).toBe(50);
    expect(row.total_tokens).toBe(300);
    expect(row.cost_usd).toBe(0.005);
    expect(row.latency_ms).toBe(450);
    expect(row.status_code).toBe(200);
    expect(row.base_resp_code).toBeNull();
    expect(row.stream).toBe(0);
    expect(row.rtk_bytes_saved).toBe(0);
    expect(row.request_body).toBe('{"messages":[{"role":"user","content":"hello"}]}');
    expect(row.response_body).toBe('{"choices":[{"message":{"role":"assistant","content":"hi"}}]}');
    expect(typeof row.request_headers).toBe('string');
    expect(typeof row.response_headers).toBe('string');
    expect(row.req_id).toBe('req-abc-123');
  });

  it('truncates request_body exceeding MAX_BODY_BYTES (100_000)', () => {
    const longBody = 'x'.repeat(150_000);
    const row = buildLogRow(makeCtx({ requestBody: longBody }));
    expect(row.request_body).toContain('...truncated...');
    expect(row.request_body!.length).toBeLessThan(longBody.length);
  });

  it('sets rtk_bytes_saved to 0 when zero', () => {
    const row = buildLogRow(makeCtx({ rtkBytesSaved: 0 }));
    expect(row.rtk_bytes_saved).toBe(0);
  });

  it('captures content-type header via headersToJson', () => {
    const row = buildLogRow(makeCtx());
    const headers = JSON.parse(row.request_headers as string);
    expect(headers['content-type']).toBe('application/json');
  });
});

// ---------------------------------------------------------------------------
// Tests — applyErrorState (needs db mock)
// ---------------------------------------------------------------------------

describe('applyErrorState', () => {
  it('sets rate_limited_until when cooldownMs > 0', () => {
    const updateAccountMock = vi.fn();
    const db: Db = { updateAccount: updateAccountMock };
    const acc: AccountState = {
      id: 'acc-1',
      backoffLevel: 0,
      rateLimitedUntil: null,
      lastError: null,
      status: 'active',
      enabled: true,
    };
    const decision: FallbackDecision = {
      shouldFallback: true,
      cooldownMs: 30_000,
      source: 'rule',
    };
    applyErrorState(db, acc, decision, 'rate limited', { status: 429 });

    expect(updateAccountMock).toHaveBeenCalledTimes(1);
    const [, patch] = updateAccountMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(patch.rate_limited_until).not.toBeNull();
    expect(new Date(patch.rate_limited_until as string).getTime()).toBeGreaterThan(Date.now());
  });

  it('sets rate_limited_until to null when cooldownMs = 0', () => {
    const updateAccountMock = vi.fn();
    const db: Db = { updateAccount: updateAccountMock };
    const acc: AccountState = {
      id: 'acc-1',
      backoffLevel: 0,
      rateLimitedUntil: null,
      lastError: null,
      status: 'active',
      enabled: true,
    };
    const decision: FallbackDecision = {
      shouldFallback: true,
      cooldownMs: 0,
      source: 'rule',
    };
    applyErrorState(db, acc, decision, 'bad request', { status: 400 });

    const [, patch] = updateAccountMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(patch.rate_limited_until).toBeNull();
  });

  it('preserves backoffLevel when newBackoffLevel is undefined', () => {
    const updateAccountMock = vi.fn();
    const db: Db = { updateAccount: updateAccountMock };
    const acc: AccountState = {
      id: 'acc-1',
      backoffLevel: 2,
      rateLimitedUntil: null,
      lastError: null,
      status: 'active',
      enabled: true,
    };
    const decision: FallbackDecision = {
      shouldFallback: true,
      cooldownMs: 0,
      source: 'default',
    };
    applyErrorState(db, acc, decision, 'server error', { status: 500 });

    const [, patch] = updateAccountMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(patch.backoff_level).toBe(2);
  });

  it('updates backoff_level when newBackoffLevel is set', () => {
    const updateAccountMock = vi.fn();
    const db: Db = { updateAccount: updateAccountMock };
    const acc: AccountState = {
      id: 'acc-1',
      backoffLevel: 0,
      rateLimitedUntil: null,
      lastError: null,
      status: 'active',
      enabled: true,
    };
    const decision: FallbackDecision = {
      shouldFallback: true,
      cooldownMs: 5_000,
      newBackoffLevel: 3,
      source: 'rule',
    };
    applyErrorState(db, acc, decision, 'rate limit', { status: 429 });

    const [, patch] = updateAccountMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(patch.backoff_level).toBe(3);
  });

  it('sets status to error when response status is 401', () => {
    const updateAccountMock = vi.fn();
    const db: Db = { updateAccount: updateAccountMock };
    const acc: AccountState = {
      id: 'acc-1',
      backoffLevel: 0,
      rateLimitedUntil: null,
      lastError: null,
      status: 'active',
      enabled: true,
    };
    const decision: FallbackDecision = {
      shouldFallback: true,
      cooldownMs: 0,
      source: 'rule',
    };
    applyErrorState(db, acc, decision, 'unauthorized', { status: 401 });

    const [, patch] = updateAccountMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(patch.status).toBe('error');
  });

  it('preserves status when response status is not 401', () => {
    const updateAccountMock = vi.fn();
    const db: Db = { updateAccount: updateAccountMock };
    const acc: AccountState = {
      id: 'acc-1',
      backoffLevel: 0,
      rateLimitedUntil: null,
      lastError: null,
      status: 'active',
      enabled: true,
    };
    const decision: FallbackDecision = {
      shouldFallback: true,
      cooldownMs: 5_000,
      source: 'rule',
    };
    applyErrorState(db, acc, decision, 'server error', { status: 500 });

    const [, patch] = updateAccountMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(patch.status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// Tests — clearErrorState
// ---------------------------------------------------------------------------

describe('clearErrorState', () => {
  it('does not call updateAccount when all fields are already clean', () => {
    const updateAccountMock = vi.fn();
    const db: Db = { updateAccount: updateAccountMock };
    const acc: AccountState = {
      id: 'acc-1',
      backoffLevel: 0,
      rateLimitedUntil: null,
      lastError: null,
      status: 'active',
      enabled: true,
    };
    clearErrorState(db, acc);
    expect(updateAccountMock).not.toHaveBeenCalled();
  });

  it('calls updateAccount when backoffLevel is dirty', () => {
    const updateAccountMock = vi.fn();
    const db: Db = { updateAccount: updateAccountMock };
    const acc: AccountState = {
      id: 'acc-1',
      backoffLevel: 2,
      rateLimitedUntil: null,
      lastError: null,
      status: 'active',
      enabled: true,
    };
    clearErrorState(db, acc);
    expect(updateAccountMock).toHaveBeenCalledTimes(1);
    const [, patch] = updateAccountMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(patch.backoff_level).toBe(0);
  });

  it('calls updateAccount when rateLimitedUntil is set', () => {
    const updateAccountMock = vi.fn();
    const db: Db = { updateAccount: updateAccountMock };
    const acc: AccountState = {
      id: 'acc-1',
      backoffLevel: 0,
      rateLimitedUntil: new Date(Date.now() + 30_000).toISOString(),
      lastError: null,
      status: 'active',
      enabled: true,
    };
    clearErrorState(db, acc);
    expect(updateAccountMock).toHaveBeenCalledTimes(1);
    const [, patch] = updateAccountMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(patch.rate_limited_until).toBeNull();
  });

  it('calls updateAccount when lastError is set', () => {
    const updateAccountMock = vi.fn();
    const db: Db = { updateAccount: updateAccountMock };
    const acc: AccountState = {
      id: 'acc-1',
      backoffLevel: 0,
      rateLimitedUntil: null,
      lastError: {
        status: 500,
        message: 'error',
        timestamp: '2024-01-01T00:00:00Z',
      },
      status: 'active',
      enabled: true,
    };
    clearErrorState(db, acc);
    expect(updateAccountMock).toHaveBeenCalledTimes(1);
    const [, patch] = updateAccountMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(patch.last_error).toBeNull();
  });

  it('calls updateAccount when status is error', () => {
    const updateAccountMock = vi.fn();
    const db: Db = { updateAccount: updateAccountMock };
    const acc: AccountState = {
      id: 'acc-1',
      backoffLevel: 0,
      rateLimitedUntil: null,
      lastError: null,
      status: 'error',
      enabled: true,
    };
    clearErrorState(db, acc);
    expect(updateAccountMock).toHaveBeenCalledTimes(1);
    const [, patch] = updateAccountMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(patch.status).toBe('active');
  });
});
