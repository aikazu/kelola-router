import { describe, expect, it } from 'vitest';
import { type CavemanBody, injectCaveman } from './index.js';

type Block = { type?: string; text?: string; cache_control?: unknown };
// Narrow unions for assertions.
const sysArr = (b: CavemanBody): Block[] => b.system as Block[];
const sysStr = (b: CavemanBody): string => b.system as string;
const msgs = (b: CavemanBody) => b.messages ?? [];
const content = (b: CavemanBody, i: number): Block[] => msgs(b)[i].content as Block[];

describe('injectCaveman', () => {
  it('no-op when level=off', () => {
    const body: CavemanBody = { system: 'hi' };
    injectCaveman(body, 'off');
    expect(sysStr(body)).toBe('hi');
  });

  it('appends to Anthropic string system', () => {
    const body: CavemanBody = { system: 'you are helpful' };
    injectCaveman(body, 'terse');
    expect(sysStr(body)).toContain('you are helpful');
    expect(sysStr(body)).toContain('Be concise');
  });

  it('creates system array with text+cache_control when missing', () => {
    const body: CavemanBody = {
      system: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b', cache_control: { type: 'ephemeral' } },
      ],
    };
    injectCaveman(body, 'terse');
    expect(sysArr(body).length).toBe(3);
    expect(sysArr(body)[0].text).toBe('a');
    expect(sysArr(body)[1].text).toBe('b');
    expect(sysArr(body)[1].cache_control).toBeDefined();
    expect(sysArr(body)[2].text).toContain('Be concise');
  });

  it('appends to OpenAI messages[0] (system role)', () => {
    const body: CavemanBody = {
      messages: [
        { role: 'system', content: 'old' },
        { role: 'user', content: 'hi' },
      ],
    };
    injectCaveman(body, 'terse');
    expect(msgs(body)[0].content).toContain('old');
    expect(msgs(body)[0].content).toContain('Be concise');
  });

  it('prepends new system message if no system role exists', () => {
    const body: CavemanBody = { messages: [{ role: 'user', content: 'hi' }] };
    injectCaveman(body, 'ultra');
    expect(msgs(body)[0].role).toBe('system');
    expect(msgs(body)[0].content).toContain('Reply like a caveman');
  });

  it('appends to messages[] content array system', () => {
    const body: CavemanBody = {
      messages: [{ role: 'system', content: [{ type: 'text', text: 'old' }] }],
    };
    injectCaveman(body, 'terse');
    expect(content(body, 0).length).toBe(2);
    expect(content(body, 0)[1].text).toContain('Be concise');
  });
});
