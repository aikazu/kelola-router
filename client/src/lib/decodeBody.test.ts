import { describe, expect, it } from 'vitest';
import { detectFormat, isTruncated } from './decodeBody';

describe('isTruncated', () => {
  it('returns true when body ends with truncation suffix', () => {
    expect(isTruncated('some data...truncated...')).toBe(true);
  });
  it('returns false for clean body', () => {
    expect(isTruncated('{"ok":true}')).toBe(false);
  });
  it('returns false for null', () => {
    expect(isTruncated(null)).toBe(false);
  });
});

describe('detectFormat', () => {
  it('detects anthropic-sse from event: lines', () => {
    const body =
      'event: message_start\ndata: {"type":"message_start"}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';
    expect(detectFormat(body, {})).toBe('anthropic-sse');
  });
  it('detects openai-completion from choices[]', () => {
    const body = JSON.stringify({ id: 'x', choices: [{ message: { content: 'hi' } }] });
    expect(detectFormat(body, {})).toBe('openai-completion');
  });
  it('detects anthropic-message from content[] + stop_reason', () => {
    const body = JSON.stringify({
      content: [{ type: 'text', text: 'hi' }],
      stop_reason: 'end_turn',
    });
    expect(detectFormat(body, {})).toBe('anthropic-message');
  });
  it('detects error from error object', () => {
    const body = JSON.stringify({ error: { type: 'api_error', message: 'boom' } });
    expect(detectFormat(body, {})).toBe('error');
  });
  it('detects plain-text for unparseable body', () => {
    expect(detectFormat('fetch failed', {})).toBe('plain-text');
  });
  it('uses content-type event-stream as sse hint even without event: prefix', () => {
    expect(detectFormat('not json at all', { contentType: 'text/event-stream' })).toBe(
      'anthropic-sse'
    );
  });
  it('defaults to plain-text for non-json non-sse', () => {
    expect(detectFormat('some random text', {})).toBe('plain-text');
  });
});
