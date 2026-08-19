import { describe, expect, it } from 'vitest';
import { PROVIDER, upstreamUrl } from './minimax/index.js';

// Regression: openai base previously included /v1, causing upstream path
// concatenation to produce /v1/v1/chat/completions (404 from MiniMax).
describe('upstreamUrl', () => {
  const acc = { provider: PROVIDER, apiKey: 'mm_test', baseUrl: null };

  it('openai + /v1/chat/completions yields a single /v1 prefix', () => {
    const url = upstreamUrl(acc, 'openai', '/v1/chat/completions');
    expect(url).toBe('https://api.minimax.io/v1/chat/completions');
  });

  it('openai + /v1/models yields a single /v1 prefix', () => {
    const url = upstreamUrl(acc, 'openai', '/v1/models');
    expect(url).toBe('https://api.minimax.io/v1/models');
  });

  it('anthropic + /v1/messages stays under /anthropic', () => {
    const url = upstreamUrl(acc, 'anthropic', '/v1/messages');
    expect(url).toBe('https://api.minimax.io/anthropic/v1/messages');
  });
});
