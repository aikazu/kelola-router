import { describe, expect, it } from 'vitest';
import { callName, PREFIX_BY_PROVIDER, PROVIDERS_WITH_FETCH } from '../lib/provider-prefix';

describe('provider-prefix', () => {
  it('maps qwencloud to the qctp prefix', () => {
    expect(PREFIX_BY_PROVIDER.qwencloud).toBe('qctp');
  });

  it('included qwencloud in the fetch/reseed provider set', () => {
    expect(PROVIDERS_WITH_FETCH.has('qwencloud')).toBe(true);
  });

  it('renders a qwencloud model call string as qctp/<name>', () => {
    expect(callName('qwencloud', 'deepseek-v4-pro-0813')).toBe('qctp/deepseek-v4-pro-0813');
  });
});
