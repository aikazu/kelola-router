// src/providers/codebuddy/transform.test.ts
import { describe, expect, it } from 'vitest';
import { prepareCodeBuddyBody } from './transform.js';

describe('prepareCodeBuddyBody', () => {
  it('converts an Anthropic body to OpenAI, forces stream, and guarantees a system message', () => {
    const out = prepareCodeBuddyBody(
      {
        model: 'cb/claude-opus-4.6',
        system: 'be terse',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'hi' }],
      },
      'anthropic'
    );
    expect(out.model).toBe('claude-opus-4.6'); // prefix stripped
    expect(out.stream).toBe(true);
    expect((out.stream_options as { include_usage?: boolean }).include_usage).toBe(true);
    const msgs = out.messages as Array<{ role: string; content: unknown }>;
    expect(msgs[0].role).toBe('system'); // moved from top-level by bodyAnthropicToOpenAI
    expect(out.system).toBeUndefined();
  });

  it('injects a default system message when the client sent none', () => {
    const out = prepareCodeBuddyBody(
      {
        model: 'cb/gemini-3.5-flash',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'hi' }],
      },
      'anthropic'
    );
    const msgs = out.messages as Array<{ role: string }>;
    expect(msgs[0].role).toBe('system');
    expect(msgs.filter((m) => m.role === 'system')).toHaveLength(1);
  });

  it('passes an OpenAI client body through, still forcing stream + system', () => {
    const out = prepareCodeBuddyBody(
      { model: 'cb/gpt-5.5', messages: [{ role: 'user', content: 'hi' }] },
      'openai'
    );
    expect(out.stream).toBe(true);
    const msgs = out.messages as Array<{ role: string }>;
    expect(msgs[0].role).toBe('system');
  });

  it('does not duplicate an existing OpenAI system message', () => {
    const out = prepareCodeBuddyBody(
      {
        model: 'glm-5.0',
        messages: [
          { role: 'system', content: 's' },
          { role: 'user', content: 'hi' },
        ],
      },
      'openai'
    );
    const msgs = out.messages as Array<{ role: string }>;
    expect(msgs.filter((m) => m.role === 'system')).toHaveLength(1);
  });
});
