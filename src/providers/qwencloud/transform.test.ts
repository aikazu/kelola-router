// src/providers/qwencloud/transform.test.ts
import { describe, expect, it } from 'vitest';
import { prepareQwenCloudBody } from './transform.js';

describe('prepareQwenCloudBody', () => {
  it('passes an Anthropic body through with model untouched when bare', () => {
    const out = prepareQwenCloudBody({
      model: 'qwen3.8-max',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(out.model).toBe('qwen3.8-max');
    expect(out.max_tokens).toBe(1024);
    expect(out.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('strips the qctp/ prefix when no upstreamModel is supplied', () => {
    const out = prepareQwenCloudBody({
      model: 'qctp/deepseek-v4-pro-0813',
      max_tokens: 128,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(out.model).toBe('deepseek-v4-pro-0813');
  });

  it('rewrites model when upstreamModel is supplied (namespaced DB row wins)', () => {
    const out = prepareQwenCloudBody(
      { model: 'qwen3.8-max', max_tokens: 128, messages: [{ role: 'user', content: 'hi' }] },
      'qwen3.8-max'
    );
    expect(out.model).toBe('qwen3.8-max');
  });

  it('forces stream:true so the proxy can tee usage / convert format', () => {
    const out = prepareQwenCloudBody({ model: 'qwen3.8-max', max_tokens: 32, messages: [] });
    expect(out.stream).toBe(true);
  });

  it('preserves the client stream when already true', () => {
    const out = prepareQwenCloudBody({
      model: 'deepseek-v4-flash-0731',
      max_tokens: 32,
      messages: [],
      stream: true,
    });
    expect(out.stream).toBe(true);
  });

  it('does not inject a default system message or stream_options', () => {
    const out = prepareQwenCloudBody({
      model: 'qwen3.8-max',
      max_tokens: 32,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(out.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(out.system).toBeUndefined();
    expect(out.stream_options).toBeUndefined();
  });
});
