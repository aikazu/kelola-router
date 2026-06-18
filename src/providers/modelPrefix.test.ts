import { describe, expect, it } from 'vitest';
import { parseModelPrefix } from './modelPrefix.js';

describe('parseModelPrefix', () => {
  it('parses mx prefix to minimax', () => {
    expect(parseModelPrefix('mx/MiniMax-M3')).toEqual({
      provider: 'minimax',
      modelName: 'MiniMax-M3',
      prefixed: true,
    });
  });

  it('parses kr prefix to kiro', () => {
    expect(parseModelPrefix('kr/claude-opus-4-8')).toEqual({
      provider: 'kiro',
      modelName: 'claude-opus-4-8',
      prefixed: true,
    });
  });

  it('parses cb prefix to codebuddy', () => {
    expect(parseModelPrefix('cb/some-model')).toEqual({
      provider: 'codebuddy',
      modelName: 'some-model',
      prefixed: true,
    });
  });

  it('parses pio prefix to pioneer', () => {
    expect(parseModelPrefix('pio/claude-opus-4-8')).toEqual({
      provider: 'pioneer',
      modelName: 'claude-opus-4-8',
      prefixed: true,
    });
  });

  it('parses a pio prefix with a slashed upstream id (first slash only)', () => {
    expect(parseModelPrefix('pio/deepseek-ai/DeepSeek-V4-Pro')).toEqual({
      provider: 'pioneer',
      modelName: 'deepseek-ai/DeepSeek-V4-Pro',
      prefixed: true,
    });
  });

  it('treats a string with no slash as bare', () => {
    expect(parseModelPrefix('claude-opus-4-8')).toEqual({
      provider: null,
      modelName: 'claude-opus-4-8',
      prefixed: false,
    });
  });

  it('splits on the first slash only', () => {
    expect(parseModelPrefix('kr/org/model')).toEqual({
      provider: 'kiro',
      modelName: 'org/model',
      prefixed: true,
    });
  });

  it('throws on an unknown prefix', () => {
    expect(() => parseModelPrefix('xx/foo')).toThrow(/unknown model prefix: xx/);
  });

  it('passes through an empty tail after a known prefix (validated downstream)', () => {
    expect(parseModelPrefix('mx/')).toEqual({
      provider: 'minimax',
      modelName: '',
      prefixed: true,
    });
  });

  it('treats an empty string as bare (validated downstream)', () => {
    expect(parseModelPrefix('')).toEqual({
      provider: null,
      modelName: '',
      prefixed: false,
    });
  });
});
