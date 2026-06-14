import { describe, expect, it } from 'vitest';
import { parseModelPrefix } from './modelPrefix.js';

describe('parseModelPrefix', () => {
  it('parses mm prefix to minimax', () => {
    expect(parseModelPrefix('mm/MiniMax-M3')).toEqual({
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
});
