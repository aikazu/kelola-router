// src/providers/codebuddy/index.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeCodeBuddy } from './index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('executeCodeBuddy', () => {
  it('posts an OpenAI streaming body with Bearer auth to /v2/chat/completions', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    );
    await executeCodeBuddy({
      body: {
        model: 'cb/claude-opus-4.6',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      },
      account: { api_key: 'ck_test', base_url: 'https://www.codebuddy.ai', chat_endpoint: null },
      transport: null,
      clientFormat: 'anthropic',
    });
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe('https://www.codebuddy.ai/v2/chat/completions');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ck_test');
    expect(headers['anthropic-version']).toBeUndefined();
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.stream).toBe(true);
    expect(sent.model).toBe('claude-opus-4.6');
    expect(sent.messages[0].role).toBe('system');
  });
});
