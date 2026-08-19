// src/providers/tabi/index.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeTabi } from './index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('executeTabi', () => {
  it('posts an OpenAI streaming body with Bearer auth to /v1/chat/completions', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    );
    await executeTabi({
      body: {
        model: 'tabi/claude-opus-5',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      },
      account: { api_key: 'sk-test-key', base_url: null, chat_endpoint: null },
      transport: null,
      clientFormat: 'anthropic',
      upstreamModel: 'claude-opus-5',
    });
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe('https://tabitoken.cc/v1/chat/completions');
    const headers = (init as RequestInit).headers as Record<string, string>;
    // TabiToken authenticates with Bearer — never X-API-Key / anthropic-version.
    expect(headers.Authorization).toBe('Bearer sk-test-key');
    expect(headers['X-API-Key']).toBeUndefined();
    expect(headers['anthropic-version']).toBeUndefined();
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.stream).toBe(true);
    expect(sent.model).toBe('claude-opus-5');
  });

  it('honours a per-account base_url override', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('data: [DONE]\n\n', { status: 200 }));
    await executeTabi({
      body: { model: 'tabi/gpt-5.5', messages: [{ role: 'user', content: 'hi' }] },
      account: { api_key: 'sk-test', base_url: 'https://proxy.example', chat_endpoint: null },
      transport: null,
      clientFormat: 'openai',
    });
    expect(String(spy.mock.calls[0][0])).toBe('https://proxy.example/v1/chat/completions');
  });
});
