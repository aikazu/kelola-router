import { describe, expect, it } from 'vitest';
import { isThinkingEnabled, resolveKiroModel } from './constants.js';

describe('resolveKiroModel', () => {
  it('resolves a plain model', () => {
    expect(resolveKiroModel('claude-sonnet-4-5')).toEqual({
      upstream: 'claude-sonnet-4-5',
      agentic: false,
      thinking: false,
    });
  });

  it('strips -thinking', () => {
    expect(resolveKiroModel('claude-sonnet-4-5-thinking')).toEqual({
      upstream: 'claude-sonnet-4-5',
      agentic: false,
      thinking: true,
    });
  });

  it('strips -agentic', () => {
    expect(resolveKiroModel('claude-sonnet-4-5-agentic')).toEqual({
      upstream: 'claude-sonnet-4-5',
      agentic: true,
      thinking: false,
    });
  });

  it('strips -thinking-agentic (both, in order)', () => {
    expect(resolveKiroModel('claude-sonnet-4-5-thinking-agentic')).toEqual({
      upstream: 'claude-sonnet-4-5',
      agentic: true,
      thinking: true,
    });
  });
});

describe('isThinkingEnabled', () => {
  it('detects Claude thinking.type=enabled', () => {
    expect(isThinkingEnabled({ thinking: { type: 'enabled' } })).toBe(true);
  });

  it('detects reasoning_effort', () => {
    expect(isThinkingEnabled({ reasoning_effort: 'high' })).toBe(true);
  });

  it('detects <thinking_mode>enabled</thinking_mode> in a system message', () => {
    expect(
      isThinkingEnabled({
        messages: [{ role: 'system', content: 'x <thinking_mode>enabled</thinking_mode> y' }],
      })
    ).toBe(true);
  });

  it('detects via model name', () => {
    expect(isThinkingEnabled({}, 'claude-sonnet-4-5-thinking')).toBe(true);
  });

  it('returns false for a plain request', () => {
    expect(isThinkingEnabled({ messages: [{ role: 'user', content: 'hi' }] }, 'claude')).toBe(
      false
    );
  });
});
