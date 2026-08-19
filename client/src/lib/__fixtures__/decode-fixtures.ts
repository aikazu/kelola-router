export const openaiCompletionBody = JSON.stringify({
  id: 'chatcmpl-x',
  object: 'chat.completion',
  choices: [
    {
      index: 0,
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'Hello there.', reasoning_content: 'thinking...' },
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
});

export const anthropicMessageBody = JSON.stringify({
  id: 'msg_x',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'Hi from anthropic' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 5, output_tokens: 2 },
});

export const errorObjectBody = JSON.stringify({
  error: { type: 'overloaded_error', message: 'Overloaded' },
  request_id: 'req_123',
});

export const plainErrorBody = 'fetch failed';

export const sseFullBody = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_1","model":"x","usage":{"input_tokens":3,"output_tokens":0}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":3,"output_tokens":2}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
].join('\n');

export const ssePartialBody = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_1","model":"x","usage":{"input_tokens":3,"output_tokens":0}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}',
  '',
].join('\n');
