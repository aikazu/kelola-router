import { describe, expect, it } from 'vitest';
import type { AnthropicBody, AnthropicMessage, OpenAIBody, OpenAIMessage } from './messageTypes.js';

describe('messageTypes', () => {
  it('AnthropicBody accepts the legacy test shape', () => {
    const body: AnthropicBody = {
      system: [{ type: 'text', text: 'a' }],
      messages: [{ role: 'user', content: 'hi' }],
    };
    expect(body.messages[0].role).toBe('user');
  });

  it('OpenAIBody accepts messages + instructions', () => {
    const body: OpenAIBody = {
      instructions: 'be terse',
      messages: [
        { role: 'system', content: 'x' },
        { role: 'user', content: 'hi' },
      ],
    };
    expect(body.messages.length).toBe(2);
  });

  it('OpenAIMessage and AnthropicMessage have compatible content unions', () => {
    // Compile-time check: a content block works in either shape.
    const block: AnthropicMessage['content'] = 'hi';
    const oa: OpenAIMessage = { role: 'user', content: block };
    expect(oa.content).toBe('hi');
  });
});
