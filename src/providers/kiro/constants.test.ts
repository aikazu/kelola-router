import { describe, expect, it } from 'vitest';
import {
  isThinkingEnabled,
  kiroCliUserAgent,
  resolveKiroEndpoint,
  resolveKiroModel,
  resolveKiroPersona,
  toCliModelId,
} from './constants.js';

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

describe('persona', () => {
  it('resolveKiroPersona defaults to ide for unknown/missing values', () => {
    expect(resolveKiroPersona(undefined)).toBe('ide');
    expect(resolveKiroPersona(null)).toBe('ide');
    expect(resolveKiroPersona('ide')).toBe('ide');
    expect(resolveKiroPersona('nonsense')).toBe('ide');
  });

  it('resolveKiroPersona recognizes cli', () => {
    expect(resolveKiroPersona('cli')).toBe('cli');
  });

  it('IDE persona resolves to the codewhisperer host', () => {
    expect(resolveKiroEndpoint('ide', 'us-east-1')).toBe(
      'https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse'
    );
  });

  it('CLI persona resolves to the kiro runtime host', () => {
    expect(resolveKiroEndpoint('cli', 'us-east-1')).toBe('https://runtime.us-east-1.kiro.dev/');
    expect(resolveKiroEndpoint('cli', 'eu-central-1')).toBe(
      'https://runtime.eu-central-1.kiro.dev/'
    );
  });

  it('CLI user-agent mimics aws-sdk-rust + AmazonQ-For-CLI', () => {
    const ua = kiroCliUserAgent();
    expect(ua).toContain('aws-sdk-rust/');
    expect(ua).toContain('app/AmazonQ-For-CLI');
    expect(ua).toContain('codewhispererstreaming');
  });

  it('toCliModelId converts hyphenated version to dotted', () => {
    expect(toCliModelId('claude-sonnet-4-6')).toBe('claude-sonnet-4.6');
    expect(toCliModelId('claude-opus-4-8')).toBe('claude-opus-4.8');
    expect(toCliModelId('claude-haiku-4-5')).toBe('claude-haiku-4.5');
  });

  it('toCliModelId leaves non-versioned ids unchanged', () => {
    expect(toCliModelId('auto')).toBe('auto');
  });
});
