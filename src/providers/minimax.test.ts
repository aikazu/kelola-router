import { describe, expect, it } from 'vitest';
import { type MinimaxAccount, PROVIDER, upstreamHeaders, upstreamUrl } from './minimax.js';

describe('minimax provider', () => {
  it("PROVIDER is the literal 'minimax'", () => {
    expect(PROVIDER).toBe('minimax');
  });

  it('upstreamUrl joins base URL + path', () => {
    const acc: MinimaxAccount = {
      provider: PROVIDER,
      apiKey: 'k',
      baseUrl: 'https://api.example.com',
    };
    expect(upstreamUrl(acc, 'openai', '/v1/chat/completions')).toBe(
      'https://api.example.com/v1/chat/completions'
    );
  });

  it('upstreamUrl uses region default when baseUrl is null', () => {
    const acc: MinimaxAccount = { provider: PROVIDER, apiKey: 'k', baseUrl: null };
    const u = upstreamUrl(acc, 'openai', '/v1/x');
    expect(u).toMatch(/^https?:\/\/.+\/v1\/x$/);
  });

  it('upstreamHeaders: openai format uses Bearer', () => {
    const acc: MinimaxAccount = { provider: PROVIDER, apiKey: 'kk', baseUrl: null };
    const h = upstreamHeaders(acc, false, 'openai');
    expect(h.Authorization).toBe('Bearer kk');
    expect(h['x-api-key']).toBeUndefined();
  });

  it('upstreamHeaders: anthropic format uses x-api-key + version', () => {
    const acc: MinimaxAccount = { provider: PROVIDER, apiKey: 'kk', baseUrl: null };
    const h = upstreamHeaders(acc, false, 'anthropic');
    expect(h['x-api-key']).toBe('kk');
    expect(h['anthropic-version']).toBe('2023-06-01');
    expect(h.Authorization).toBeUndefined();
  });

  it('upstreamHeaders: stream adds Accept text/event-stream', () => {
    const acc: MinimaxAccount = { provider: PROVIDER, apiKey: 'kk', baseUrl: null };
    expect(upstreamHeaders(acc, true, 'openai').Accept).toBe('text/event-stream');
  });
});
