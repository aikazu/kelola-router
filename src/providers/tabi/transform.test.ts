// src/providers/tabi/transform.test.ts
import { describe, expect, it } from 'vitest';
import { prepareTabiBody } from './transform.js';

describe('prepareTabiBody', () => {
  it('converts an Anthropic body to OpenAI, strips the prefix, and forces stream', () => {
    const out = prepareTabiBody(
      {
        model: 'tabi/claude-opus-5',
        system: 'be concise',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'hi' }],
      },
      'anthropic'
    );
    expect(out.model).toBe('claude-opus-5'); // prefix stripped
    expect(out.stream).toBe(true);
    expect((out.stream_options as { include_usage?: boolean }).include_usage).toBe(true);
  });

  it('strips only the tabi/ prefix when no upstreamModel is given', () => {
    const out = prepareTabiBody(
      { model: 'tabi/claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] },
      'openai'
    );
    expect(out.model).toBe('claude-sonnet-4-6');
  });

  it('uses the resolved upstreamModel verbatim when provided', () => {
    const out = prepareTabiBody(
      { model: 'tabi/deepseek-3.2', messages: [{ role: 'user', content: 'hi' }] },
      'openai',
      'deepseek-3.2'
    );
    expect(out.model).toBe('deepseek-3.2');
  });

  it('does NOT inject a default system message when the client sent none', () => {
    const out = prepareTabiBody(
      { model: 'tabi/gpt-5.5', messages: [{ role: 'user', content: 'hi' }] },
      'openai'
    );
    const msgs = out.messages as Array<{ role: string }>;
    expect(msgs.filter((m) => m.role === 'system')).toHaveLength(0);
    expect(msgs[0].role).toBe('user');
  });

  it('forces include_usage:true even when the client opted out', () => {
    const out = prepareTabiBody(
      {
        model: 'tabi/gpt-5.5',
        stream_options: { include_usage: false },
        messages: [{ role: 'user', content: 'hi' }],
      },
      'openai'
    );
    expect((out.stream_options as { include_usage?: boolean }).include_usage).toBe(true);
  });
});
