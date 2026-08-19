import { describe, expect, it } from 'vitest';
import { checkFallbackError } from './error-rules.js';

describe('checkFallbackError', () => {
  it('honors Retry-After header on 429 (priority 1)', () => {
    const d = checkFallbackError(429, 'rate limit', undefined, 0, undefined, 30);
    expect(d.cooldownMs).toBe(30_000);
    expect(d.source).toBe('rule');
  });

  it('uses window reset for baseResp 2056 (priority 2)', () => {
    const d = checkFallbackError(200, 'window exhausted', 2056, 0, 600_000, undefined);
    expect(d.cooldownMs).toBe(600_000);
    expect(d.source).toBe('window-reset');
  });

  it('uses window reset for baseResp 2061 (priority 2)', () => {
    const d = checkFallbackError(200, 'window exhausted', 2061, 0, 1_200_000, undefined);
    expect(d.cooldownMs).toBe(1_200_000);
  });

  it("falls back to exponential for text 'rate limit' (priority 3)", () => {
    const d = checkFallbackError(200, 'rate limit reached', 1002, 1);
    expect(d.cooldownMs).toBe(2000);
    expect(d.newBackoffLevel).toBe(2);
  });

  it('falls back to exponential for status 429 (priority 3)', () => {
    const d = checkFallbackError(429, '', undefined, 2);
    expect(d.cooldownMs).toBe(4000);
  });

  it('status 401 → no cooldown, mark error', () => {
    const d = checkFallbackError(401, 'auth failed', 1004, 0);
    expect(d.cooldownMs).toBe(0);
  });

  it('status 5xx → 5s transient', () => {
    expect(checkFallbackError(500, '', undefined, 0).cooldownMs).toBe(5000);
    expect(checkFallbackError(502, '', undefined, 0).cooldownMs).toBe(5000);
    expect(checkFallbackError(503, '', undefined, 0).cooldownMs).toBe(5000);
    expect(checkFallbackError(504, '', undefined, 0).cooldownMs).toBe(5000);
  });

  it('unknown error → 5s default', () => {
    const d = checkFallbackError(418, 'teapot', undefined, 0);
    expect(d.cooldownMs).toBe(5000);
  });
});

describe('OpenAI / New-API error code mapping (TabiToken et al.)', () => {
  it('insufficient_user_quota → permanent disable (cooldown 0, source=balance)', () => {
    const d = checkFallbackError(
      403,
      '预扣费额度失败',
      undefined,
      0,
      undefined,
      undefined,
      'insufficient_user_quota'
    );
    expect(d.cooldownMs).toBe(0);
    expect(d.source).toBe('balance');
  });

  it('invalid_api_key → no cooldown, source=rule', () => {
    const d = checkFallbackError(
      401,
      'Incorrect API key',
      undefined,
      0,
      undefined,
      undefined,
      'invalid_api_key'
    );
    expect(d.cooldownMs).toBe(0);
    expect(d.source).toBe('rule');
  });

  it('authentication_error → no cooldown, source=rule', () => {
    const d = checkFallbackError(
      401,
      'auth expired',
      undefined,
      0,
      undefined,
      undefined,
      'authentication_error'
    );
    expect(d.cooldownMs).toBe(0);
    expect(d.source).toBe('rule');
  });

  it('context_length_exceeded → no cooldown, source=token-limit', () => {
    const d = checkFallbackError(
      400,
      'This model maximum context length is 200000 tokens',
      undefined,
      0,
      undefined,
      undefined,
      'context_length_exceeded'
    );
    expect(d.cooldownMs).toBe(0);
    expect(d.source).toBe('token-limit');
  });

  it('unknown errorCode with status 403 → falls through to default 5s (no regression)', () => {
    const d = checkFallbackError(
      403,
      'something else',
      undefined,
      0,
      undefined,
      undefined,
      'some_other_code'
    );
    expect(d.cooldownMs).toBe(5000);
    expect(d.source).toBe('default');
  });
});

describe('MiniMax base_resp.status_code mapping', () => {
  it('1002 (rate limit) → exponential backoff', () => {
    const d = checkFallbackError(200, '', 1002, 0);
    expect(d.cooldownMs).toBeGreaterThan(0);
    expect(d.newBackoffLevel).toBe(1);
  });

  it('1008 (insufficient balance) → permanent disable (cooldown 0, source=balance)', () => {
    const d = checkFallbackError(200, '', 1008, 0);
    expect(d.cooldownMs).toBe(0);
    expect(d.source).toBe('balance');
  });

  it('1004 (auth fail) → no cooldown', () => {
    const d = checkFallbackError(200, '', 1004, 0);
    expect(d.cooldownMs).toBe(0);
  });

  it('1001 (timeout) → short retry cooldown', () => {
    const d = checkFallbackError(200, '', 1001, 0);
    expect(d.cooldownMs).toBeGreaterThan(0);
    expect(d.cooldownMs).toBeLessThan(60_000);
  });

  it('1013 (internal) → default 5s cooldown', () => {
    const d = checkFallbackError(200, '', 1013, 0);
    expect(d.cooldownMs).toBe(5000);
  });

  it('1027 (output error) → short backoff', () => {
    const d = checkFallbackError(200, '', 1027, 0);
    expect(d.cooldownMs).toBeGreaterThan(0);
  });

  it('1039 (token limit) → no cooldown, source=token-limit', () => {
    const d = checkFallbackError(200, '', 1039, 0);
    expect(d.cooldownMs).toBe(0);
    expect(d.source).toBe('token-limit');
  });

  it('2013 (param error) → no cooldown, source=param', () => {
    const d = checkFallbackError(200, '', 2013, 0);
    expect(d.cooldownMs).toBe(0);
    expect(d.source).toBe('param');
  });

  it('unknown base_resp code → falls through to default 5s', () => {
    const d = checkFallbackError(200, '', 9999, 0);
    expect(d.cooldownMs).toBe(5000);
    expect(d.source).toBe('default');
  });
});
