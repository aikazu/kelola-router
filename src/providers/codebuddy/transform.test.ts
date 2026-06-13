import { describe, expect, it } from 'vitest';
import { ensureCodeBuddyDefaults } from './transform.js';
import { CODEBUDDY_DEFAULT_SYSTEM, CODEBUDDY_DEFAULT_TEMPERATURE } from './index.js';

describe('ensureCodeBuddyDefaults', () => {
  it('injects system when missing', () => {
    const body = { model: 'codebuddy/claude-opus-4.6', messages: [{ role: 'user', content: 'hi' }] };
    const result = ensureCodeBuddyDefaults(body);
    expect(result.system).toBe(CODEBUDDY_DEFAULT_SYSTEM);
  });

  it('preserves existing system', () => {
    const body = { model: 'codebuddy/claude-opus-4.6', system: 'Custom system prompt', messages: [] };
    const result = ensureCodeBuddyDefaults(body);
    expect(result.system).toBe('Custom system prompt');
  });

  it('injects temperature when missing', () => {
    const body = { model: 'codebuddy/claude-opus-4.6', messages: [] };
    const result = ensureCodeBuddyDefaults(body);
    expect(result.temperature).toBe(CODEBUDDY_DEFAULT_TEMPERATURE);
  });

  it('preserves existing temperature', () => {
    const body = { model: 'codebuddy/claude-opus-4.6', temperature: 0.3, messages: [] };
    const result = ensureCodeBuddyDefaults(body);
    expect(result.temperature).toBe(0.3);
  });

  it('preserves temperature of 0', () => {
    const body = { model: 'codebuddy/claude-opus-4.6', temperature: 0, messages: [] };
    const result = ensureCodeBuddyDefaults(body);
    expect(result.temperature).toBe(0);
  });

  it('injects temperature when null', () => {
    const body = { model: 'codebuddy/claude-opus-4.6', temperature: null, messages: [] };
    const result = ensureCodeBuddyDefaults(body);
    expect(result.temperature).toBe(CODEBUDDY_DEFAULT_TEMPERATURE);
  });

  it('does not mutate original body', () => {
    const body = { model: 'codebuddy/claude-opus-4.6', messages: [{ role: 'user', content: 'test' }] };
    const result = ensureCodeBuddyDefaults(body);
    expect(body).not.toHaveProperty('system');
    expect(body).not.toHaveProperty('temperature');
    expect(result).not.toBe(body);
  });

  it('passes through all other fields unchanged', () => {
    const body = {
      model: 'codebuddy/claude-opus-4.6',
      max_tokens: 4096,
      stream: true,
      system: 'My system',
      temperature: 0.5,
      messages: [{ role: 'user', content: 'hello' }],
    };
    const result = ensureCodeBuddyDefaults(body);
    expect(result.model).toBe('codebuddy/claude-opus-4.6');
    expect(result.max_tokens).toBe(4096);
    expect(result.stream).toBe(true);
    expect(result.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });
});
