// src/providers/pioneer/transform.test.ts
import { describe, expect, it } from 'vitest';
import { preparePioneerBody } from './transform.js';

describe('preparePioneerBody', () => {
  it('converts an Anthropic body to OpenAI, strips the prefix, and forces stream', () => {
    const out = preparePioneerBody(
      {
        model: 'pio/claude-opus-4-8',
        system: 'be terse',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'hi' }],
      },
      'anthropic'
    );
    expect(out.model).toBe('claude-opus-4-8'); // prefix stripped
    expect(out.stream).toBe(true);
    expect((out.stream_options as { include_usage?: boolean }).include_usage).toBe(true);
  });

  it('strips only the pio/ prefix when no upstreamModel is given', () => {
    const out = preparePioneerBody(
      { model: 'pio/claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }] },
      'openai'
    );
    expect(out.model).toBe('claude-opus-4-8');
  });

  it('uses the resolved upstreamModel verbatim when provided', () => {
    const out = preparePioneerBody(
      { model: 'pio/deepseek-ai/DeepSeek-V4-Pro', messages: [{ role: 'user', content: 'hi' }] },
      'openai',
      'deepseek-ai/DeepSeek-V4-Pro'
    );
    expect(out.model).toBe('deepseek-ai/DeepSeek-V4-Pro');
  });

  it('does NOT inject a default system message when the client sent none', () => {
    const out = preparePioneerBody(
      { model: 'pio/gpt-5.5', messages: [{ role: 'user', content: 'hi' }] },
      'openai'
    );
    const msgs = out.messages as Array<{ role: string }>;
    expect(msgs.filter((m) => m.role === 'system')).toHaveLength(0);
    expect(msgs[0].role).toBe('user');
  });

  it('forces include_usage:true even when the client opted out', () => {
    const out = preparePioneerBody(
      {
        model: 'pio/gpt-5.5',
        stream_options: { include_usage: false },
        messages: [{ role: 'user', content: 'hi' }],
      },
      'openai'
    );
    expect((out.stream_options as { include_usage?: boolean }).include_usage).toBe(true);
  });
});
