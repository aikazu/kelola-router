// src/providers/zai/transform.test.ts
import { describe, expect, it } from 'vitest';
import { prepareZaiBody } from './transform.js';

describe('prepareZaiBody', () => {
  describe('OpenAI-format client → OpenAI upstream', () => {
    it('strips the zai/ prefix when no upstreamModel is supplied', () => {
      const out = prepareZaiBody({ model: 'zai/glm-5.2', messages: [] }, 'openai');
      expect(out.model).toBe('glm-5.2');
    });

    it('rewrites model when upstreamModel is supplied', () => {
      const out = prepareZaiBody({ model: 'glm-5.2', messages: [] }, 'openai', 'glm-5-turbo');
      expect(out.model).toBe('glm-5-turbo');
    });

    it('forces stream:true + include_usage', () => {
      const out = prepareZaiBody({ model: 'glm-5.2', messages: [] }, 'openai');
      expect(out.stream).toBe(true);
      expect(out.stream_options).toEqual({ include_usage: true });
    });

    it('preserves include_usage when the client already set it', () => {
      const out = prepareZaiBody(
        { model: 'glm-5.2', messages: [], stream_options: { include_usage: true } },
        'openai'
      );
      expect(out.stream_options).toEqual({ include_usage: true });
    });

    it('does not inject a default system message', () => {
      const out = prepareZaiBody(
        { model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }] },
        'openai'
      );
      expect(out.messages).toEqual([{ role: 'user', content: 'hi' }]);
    });
  });

  describe('Anthropic-format client → Anthropic upstream', () => {
    it('passes the body through with model rewrite (no system injection)', () => {
      const out = prepareZaiBody(
        {
          model: 'zai/claude-opus-4-8',
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'hi' }],
        },
        'anthropic'
      );
      expect(out.model).toBe('claude-opus-4-8');
      expect(out.max_tokens).toBe(1024);
      expect(out.messages).toEqual([{ role: 'user', content: 'hi' }]);
    });

    it('uses the explicit upstreamModel when supplied', () => {
      const out = prepareZaiBody(
        { model: 'whatever', messages: [{ role: 'user', content: 'hi' }] },
        'anthropic',
        'glm-5.2'
      );
      expect(out.model).toBe('glm-5.2');
    });

    it('forces stream:true for Anthropic upstream too', () => {
      const out = prepareZaiBody({ model: 'glm-5.2', messages: [] }, 'anthropic');
      expect(out.stream).toBe(true);
    });

    it('does not add stream_options (Anthropic format uses its own event shape)', () => {
      const out = prepareZaiBody({ model: 'glm-5.2', messages: [] }, 'anthropic');
      expect(out.stream_options).toBeUndefined();
    });
  });
});
