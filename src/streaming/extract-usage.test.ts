import { describe, expect, it } from 'vitest';
import { extractUsageFromSSE } from './extract-usage.js';

describe('extractUsageFromSSE (OpenAI)', () => {
  it('parses final chunk with usage', () => {
    const chunks = [
      `data: {"choices":[{"delta":{"content":"hi"}}]}\n\n`,
      `data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\n`,
      `data: [DONE]\n\n`,
    ];
    const r = extractUsageFromSSE(chunks.join(''), 'openai');
    expect(r.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 50,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 150,
    });
  });

  it('returns null usage if no usage in any chunk', () => {
    const chunks = [`data: {"choices":[{"delta":{"content":"hi"}}]}\n\n`, `data: [DONE]\n\n`];
    const r = extractUsageFromSSE(chunks.join(''), 'openai');
    expect(r.usage).toBeNull();
  });
});

describe('extractUsageFromSSE (Anthropic)', () => {
  it('parses message_delta with usage', () => {
    const chunks = [
      `event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_creation_input_tokens":10,"cache_read_input_tokens":0,"output_tokens":0}}}\n\n`,
      `event: message_delta\ndata: {"type":"message_delta","usage":{"input_tokens":100,"cache_creation_input_tokens":10,"cache_read_input_tokens":0,"output_tokens":50}}\n\n`,
      `event: message_stop\ndata: {"type":"message_stop"}\n\n`,
    ];
    const r = extractUsageFromSSE(chunks.join(''), 'anthropic');
    expect(r.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 50,
      cache_creation_tokens: 10,
      cache_read_tokens: 0,
      total_tokens: 150,
    });
  });
});
