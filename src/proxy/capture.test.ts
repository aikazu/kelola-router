import { describe, expect, it } from 'vitest';
import { headersToJson } from './capture.js';

describe('headersToJson', () => {
  it('captures only the default fields by default', () => {
    const h = new Headers({
      'content-type': 'application/json',
      'x-custom-thing': 'foo',
      'x-request-id': 'r-1',
    });
    const out = JSON.parse(headersToJson(h)) as Record<string, string>;
    expect(out['content-type']).toBe('application/json');
    expect(out['x-request-id']).toBe('r-1');
    expect(out['x-custom-thing']).toBeUndefined();
  });

  it('captures all headers when fields=null', () => {
    const h = new Headers({ a: '1', b: '2' });
    const out = JSON.parse(headersToJson(h, null)) as Record<string, string>;
    expect(out.a).toBe('1');
    expect(out.b).toBe('2');
  });

  it('respects a custom allowlist', () => {
    const h = new Headers({ 'x-foo': '1', 'x-bar': '2' });
    const out = JSON.parse(headersToJson(h, ['x-foo'])) as Record<string, string>;
    expect(out['x-foo']).toBe('1');
    expect(out['x-bar']).toBeUndefined();
  });
});
