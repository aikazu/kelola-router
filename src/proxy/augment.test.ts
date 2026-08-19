import { describe, expect, it } from 'vitest';
import {
  type AnthropicBody,
  addDualCacheBreakpoints,
  augmentRequest,
  type ContentBlock,
} from './augment.js';

// Narrow the union to the array branch for assertions.
const sys = (b: AnthropicBody): ContentBlock[] => b.system as ContentBlock[];

describe('addDualCacheBreakpoints', () => {
  it('no-op for non-Anthropic shape', () => {
    const body: AnthropicBody = { messages: [{ role: 'user', content: 'hi' }] };
    addDualCacheBreakpoints(body);
    const first = body.messages?.[0].content as ContentBlock[] | string;
    expect(typeof first).toBe('string');
  });

  it('adds marker to last system block (string → array)', () => {
    const body: AnthropicBody = { system: 'you are helpful', messages: [] };
    addDualCacheBreakpoints(body);
    expect(Array.isArray(body.system)).toBe(true);
    expect(sys(body)[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('adds marker to last system block (array)', () => {
    const body: AnthropicBody = {
      system: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ],
      messages: [],
    };
    addDualCacheBreakpoints(body);
    expect(sys(body)[1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('adds marker to last assistant tool_use', () => {
    const body: AnthropicBody = {
      system: [{ type: 'text', text: 'x', cache_control: { type: 'ephemeral' } }],
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'thinking...' },
            { type: 'tool_use', text: undefined },
          ],
        },
        { role: 'user', content: 'ok' },
      ],
    };
    addDualCacheBreakpoints(body);
    const lastAssistant = (body.messages?.[1].content as ContentBlock[])[1];
    expect(lastAssistant.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('respects existing markers (does not overwrite)', () => {
    const body: AnthropicBody = {
      system: [{ type: 'text', text: 'x', cache_control: { type: 'ephemeral' } }],
      messages: [],
    };
    addDualCacheBreakpoints(body);
    expect(sys(body)[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('respectCallerMarkers=false forces marker even if some blocks have them', () => {
    const body: AnthropicBody = {
      system: [
        { type: 'text', text: 'a', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'b' },
      ],
      messages: [],
    };
    addDualCacheBreakpoints(body, false);
    expect(sys(body)[1].cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('augmentRequest', () => {
  it('runs caveman first (mutates system), then cache markers (wrap augmented prefix)', async () => {
    const body: AnthropicBody = {
      system: [{ type: 'text', text: 'a', cache_control: { type: 'ephemeral' } }],
      messages: [],
    };
    await augmentRequest(body, {
      caveman: { level: 'terse' },
      caching: { autoBreakpoints: true, respectCallerMarkers: true },
    });
    expect(sys(body).length).toBe(2);
    expect(sys(body)[1].text).toContain('Be concise');
  });
});
