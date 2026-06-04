import { describe, expect, it } from 'vitest';
import { buildHeaders } from './headers.js';

const account = { provider: 'minimax' as const, apiKey: 'mm_test' };

describe('buildHeaders', () => {
  it('OpenAI format uses Authorization: Bearer', () => {
    const h = buildHeaders(account, false, 'openai');
    expect(h.Authorization).toBe('Bearer mm_test');
    expect(h['Content-Type']).toBe('application/json');
  });

  it('Anthropic format uses x-api-key + anthropic-version', () => {
    const h = buildHeaders(account, false, 'anthropic');
    expect(h['x-api-key']).toBe('mm_test');
    expect(h['anthropic-version']).toBe('2023-06-01');
    expect(h['Content-Type']).toBe('application/json');
  });

  it('streaming adds Accept: text/event-stream', () => {
    const h = buildHeaders(account, true, 'openai');
    expect(h.Accept).toBe('text/event-stream');
  });

  it('non-streaming has no Accept', () => {
    const h = buildHeaders(account, false, 'openai');
    expect(h.Accept).toBeUndefined();
  });
});
