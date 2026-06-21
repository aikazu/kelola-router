import { describe, expect, it } from 'vitest';
import {
  anthropicMessageBody,
  errorObjectBody,
  openaiCompletionBody,
  plainErrorBody,
  sseFullBody,
  ssePartialBody,
} from './__fixtures__/decodeFixtures';
import { decodeRequestBody, decodeResponseBody, detectFormat, isTruncated } from './decodeBody';

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
  it('prefers JSON body shape over misleading event-stream content-type', () => {
    const body = JSON.stringify({ choices: [{ message: { content: 'hi' } }] });
    expect(detectFormat(body, { contentType: 'text/event-stream; charset=utf-8' })).toBe(
      'openai-completion'
    );
  });
  it('defaults to plain-text for non-json non-sse', () => {
    expect(detectFormat('some random text', {})).toBe('plain-text');
  });
});

describe('decodeRequestBody', () => {
  it('builds message cards from string content', () => {
    const body = JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] });
    const view = decodeRequestBody(body);
    expect(view.kind).toBe('request');
    expect(view.messages).toHaveLength(1);
    expect(view.messages[0].role).toBe('user');
    expect(view.messages[0].blocks[0]).toEqual({ type: 'text', text: 'hello' });
    expect(view.summary).toEqual({
      messageCount: 1,
      toolCount: 0,
      hasSystem: false,
      stream: false,
    });
  });

  it('maps array content blocks (text + tool_use + tool_result + image)', () => {
    const body = JSON.stringify({
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 't1', name: 'get_weather', input: { city: 'Jakarta' } },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't1', content: 'sunny', is_error: false }],
        },
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' },
            },
          ],
        },
      ],
    });
    const view = decodeRequestBody(body);
    expect(view.messages[0].blocks[0]).toEqual({
      type: 'tool_use',
      toolName: 'get_weather',
      toolInput: { city: 'Jakarta' },
    });
    expect(view.messages[1].blocks[0]).toEqual({
      type: 'tool_result',
      text: 'sunny',
      isError: false,
    });
    const img = view.messages[2].blocks[0];
    expect(img.type).toBe('image');
    expect(img.mediaType).toBe('image/png');
    expect(img.byteLength).toBeGreaterThan(0);
  });

  it('captures system as text blocks (string)', () => {
    const body = JSON.stringify({ system: 'you are helpful', messages: [] });
    const view = decodeRequestBody(body);
    expect(view.system).toEqual([{ type: 'text', text: 'you are helpful' }]);
    expect(view.summary.hasSystem).toBe(true);
  });

  it('captures tools[] with name + input_schema', () => {
    const body = JSON.stringify({
      tools: [{ name: 'get_weather', input_schema: { type: 'object' } }],
      messages: [],
    });
    const view = decodeRequestBody(body);
    expect(view.tools).toEqual([{ name: 'get_weather', inputSchema: { type: 'object' } }]);
    expect(view.summary.toolCount).toBe(1);
  });

  it('sets summary.stream true when stream:true', () => {
    const view = decodeRequestBody(JSON.stringify({ stream: true, messages: [] }));
    expect(view.summary.stream).toBe(true);
  });

  it('returns parseError when body is not JSON', () => {
    const view = decodeRequestBody('not json');
    expect(view.parseError).toBeDefined();
    expect(view.raw).toBe('not json');
    expect(view.messages).toEqual([]);
  });
});

describe('decodeResponseBody non-stream', () => {
  it('unpacks openai completion content + reasoning + usage', () => {
    const view = decodeResponseBody(openaiCompletionBody, {});
    expect(view.kind).toBe('nonstream');
    if (view.kind !== 'nonstream') throw new Error('nonstream');
    expect(view.contentBlocks).toEqual([
      { type: 'reasoning', text: 'thinking...' },
      { type: 'text', text: 'Hello there.' },
    ]);
    expect(view.finishReason).toBe('stop');
    expect(view.usage).toEqual({ prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 });
  });

  it('unpacks anthropic message content blocks', () => {
    const view = decodeResponseBody(anthropicMessageBody, {});
    expect(view.kind).toBe('nonstream');
    if (view.kind !== 'nonstream') throw new Error('nonstream');
    expect(view.contentBlocks).toEqual([{ type: 'text', text: 'Hi from anthropic' }]);
    expect(view.finishReason).toBe('end_turn');
  });

  it('decodes error object', () => {
    const view = decodeResponseBody(errorObjectBody, {});
    expect(view.kind).toBe('error');
    if (view.kind !== 'error') throw new Error('error');
    expect(view.errorType).toBe('overloaded_error');
    expect(view.message).toBe('Overloaded');
    expect(view.requestId).toBe('req_123');
  });

  it('decodes plain error text', () => {
    const view = decodeResponseBody(plainErrorBody, {});
    expect(view.kind).toBe('plain-text');
    if (view.kind !== 'plain-text') throw new Error('plain');
    expect(view.text).toBe('fetch failed');
  });

  it('returns plain-text for null body', () => {
    const view = decodeResponseBody(null, {});
    expect(view.kind).toBe('plain-text');
  });
});

describe('decodeResponseBody sse', () => {
  it('parses events list', () => {
    const view = decodeResponseBody(sseFullBody, {});
    expect(view.kind).toBe('sse');
    if (view.kind !== 'sse') throw new Error('sse');
    expect(view.events.map((e) => e.type)).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
  });

  it('reconstructs text from deltas', () => {
    const view = decodeResponseBody(sseFullBody, {});
    if (view.kind !== 'sse') throw new Error('sse');
    expect(view.reconstructed).toHaveLength(1);
    expect(view.reconstructed[0]).toEqual({
      index: 0,
      blockType: 'text',
      text: 'Hello world',
    });
    expect(view.complete).toBe(true);
  });

  it('marks incomplete when message_stop missing', () => {
    const view = decodeResponseBody(ssePartialBody, {});
    if (view.kind !== 'sse') throw new Error('sse');
    expect(view.complete).toBe(false);
    expect(view.reconstructed[0].text).toBe('partial');
  });
});
