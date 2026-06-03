import { describe, expect, it } from 'vitest';
import { injectCaveman } from './index.js';

describe('injectCaveman', () => {
  it('no-op when level=off', () => {
    const body: any = { system: 'hi' };
    injectCaveman(body, 'off');
    expect(body.system).toBe('hi');
  });

  it('appends to Anthropic string system', () => {
    const body: any = { system: 'you are helpful' };
    injectCaveman(body, 'terse');
    expect(body.system).toContain('you are helpful');
    expect(body.system).toContain('Be concise');
  });

  it('creates system array with text+cache_control when missing', () => {
    const body: any = {
      system: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b', cache_control: { type: 'ephemeral' } },
      ],
    };
    injectCaveman(body, 'terse');
    expect(body.system.length).toBe(3);
    expect(body.system[0].text).toBe('a');
    expect(body.system[1].text).toBe('b');
    expect(body.system[1].cache_control).toBeDefined();
    expect(body.system[2].text).toContain('Be concise');
  });

  it('appends to OpenAI messages[0] (system role)', () => {
    const body: any = {
      messages: [
        { role: 'system', content: 'old' },
        { role: 'user', content: 'hi' },
      ],
    };
    injectCaveman(body, 'terse');
    expect(body.messages[0].content).toContain('old');
    expect(body.messages[0].content).toContain('Be concise');
  });

  it('prepends new system message if no system role exists', () => {
    const body: any = { messages: [{ role: 'user', content: 'hi' }] };
    injectCaveman(body, 'ultra');
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('Reply like a caveman');
  });

  it('appends to messages[] content array system', () => {
    const body: any = { messages: [{ role: 'system', content: [{ type: 'text', text: 'old' }] }] };
    injectCaveman(body, 'terse');
    expect(body.messages[0].content.length).toBe(2);
    expect(body.messages[0].content[1].text).toContain('Be concise');
  });
});
