// src/providers/pioneer/index.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executePioneer } from './index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('executePioneer', () => {
  it('posts an OpenAI streaming body with X-API-Key auth to /v1/chat/completions', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    );
    await executePioneer({
      body: {
        model: 'pio/claude-opus-4-8',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      },
      account: { api_key: 'pio_sk_test', base_url: null, chat_endpoint: null },
      transport: null,
      clientFormat: 'anthropic',
      upstreamModel: 'claude-opus-4-8',
    });
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe('https://api.pioneer.ai/v1/chat/completions');
    const headers = (init as RequestInit).headers as Record<string, string>;
    // Pioneer authenticates with X-API-Key — never Bearer / anthropic-version.
    expect(headers['X-API-Key']).toBe('pio_sk_test');
    expect(headers.Authorization).toBeUndefined();
    expect(headers['anthropic-version']).toBeUndefined();
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.stream).toBe(true);
    expect(sent.model).toBe('claude-opus-4-8'); // resolved upstream id, namespace dropped
  });

  it('honours a per-account base_url override', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('data: [DONE]\n\n', { status: 200 }));
    await executePioneer({
      body: { model: 'pio/gpt-5.5', messages: [{ role: 'user', content: 'hi' }] },
      account: { api_key: 'pio_sk_test', base_url: 'https://proxy.example', chat_endpoint: null },
      transport: null,
      clientFormat: 'openai',
    });
    expect(String(spy.mock.calls[0][0])).toBe('https://proxy.example/v1/chat/completions');
  });
});
