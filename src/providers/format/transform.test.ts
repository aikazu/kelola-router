import { describe, expect, it } from 'vitest';
import type { OpenAIResponse } from './messageTypes.js';
import {
  bodyAddsOpenAIStreamUsage,
  bodyAnthropicToOpenAI,
  bodyOpenAIToAnthropic,
  responseAnthropicToOpenAI,
  responseOpenAIToAnthropic,
} from './transform.js';

describe('bodyOpenAIToAnthropic (tools)', () => {
  it('rewrites tools: OpenAI function wrapper → Anthropic input_schema', () => {
    const openai = {
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: 'weather in SF?' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather for a location',
            parameters: {
              type: 'object',
              properties: { location: { type: 'string' } },
              required: ['location'],
            },
          },
        },
      ],
    };
    const a = bodyOpenAIToAnthropic(openai);
    expect(a.tools).toEqual([
      {
        name: 'get_weather',
        description: 'Get weather for a location',
        input_schema: {
          type: 'object',
          properties: { location: { type: 'string' } },
          required: ['location'],
        },
      },
    ]);
    // No `type:"function"` wrapper
    expect((a.tools as { type?: string }[])[0].type).toBeUndefined();
  });

  it("rewrites tool_choice: 'auto' → {type:'auto'}", () => {
    expect(bodyOpenAIToAnthropic({ tool_choice: 'auto' }).tool_choice).toEqual({ type: 'auto' });
    expect(bodyOpenAIToAnthropic({ tool_choice: 'none' }).tool_choice).toEqual({ type: 'none' });
    expect(bodyOpenAIToAnthropic({ tool_choice: 'required' }).tool_choice).toEqual({ type: 'any' });
  });

  it("rewrites tool_choice: specific function → {type:'tool', name}", () => {
    expect(
      bodyOpenAIToAnthropic({
        tool_choice: { type: 'function', function: { name: 'get_weather' } },
      }).tool_choice
    ).toEqual({ type: 'tool', name: 'get_weather' });
  });

  it('preserves messages verbatim (no content rewrite)', () => {
    const openai = { messages: [{ role: 'user', content: 'hi' }] };
    expect(bodyOpenAIToAnthropic(openai).messages).toEqual(openai.messages);
  });

  it('drops OpenAI-only params (n, logprobs, frequency_penalty, presence_penalty)', () => {
    const a = bodyOpenAIToAnthropic({
      n: 2,
      frequency_penalty: 0.5,
      presence_penalty: 0.5,
      logprobs: true,
    });
    expect(a.n).toBeUndefined();
    expect(a.frequency_penalty).toBeUndefined();
    expect(a.presence_penalty).toBeUndefined();
    expect(a.logprobs).toBeUndefined();
  });

  it('renames max_tokens → max_tokens (Anthropic already uses max_tokens, no change)', () => {
    expect(bodyOpenAIToAnthropic({ max_tokens: 100 }).max_tokens).toBe(100);
  });

  it('renames max_completion_tokens → max_tokens (Anthropic only has max_tokens)', () => {
    const a = bodyOpenAIToAnthropic({ max_completion_tokens: 100 });
    expect(a.max_tokens).toBe(100);
    expect(a.max_completion_tokens).toBeUndefined();
  });
});

describe('bodyAnthropicToOpenAI (tools)', () => {
  it('rewrites tools: Anthropic input_schema → OpenAI function wrapper', () => {
    const anthropic = {
      tools: [
        { name: 'get_weather', description: 'Get weather', input_schema: { type: 'object' } },
      ],
    };
    const o = bodyAnthropicToOpenAI(anthropic);
    expect(o.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object' },
        },
      },
    ]);
  });

  it('rewrites tool_choice: Anthropic object → OpenAI form', () => {
    expect(bodyAnthropicToOpenAI({ tool_choice: { type: 'auto' } }).tool_choice).toBe('auto');
    expect(bodyAnthropicToOpenAI({ tool_choice: { type: 'any' } }).tool_choice).toBe('required');
    expect(
      bodyAnthropicToOpenAI({ tool_choice: { type: 'tool', name: 'get_weather' } }).tool_choice
    ).toEqual({ type: 'function', function: { name: 'get_weather' } });
  });

  it('moves top-level system into messages[0] (Anthropic system is top-level)', () => {
    const o = bodyAnthropicToOpenAI({
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(o.messages![0]).toEqual({ role: 'system', content: 'You are helpful' });
    expect(o.messages![1]).toEqual({ role: 'user', content: 'hi' });
    expect(o.system).toBeUndefined();
  });

  it('preserves Anthropic content blocks in messages', () => {
    const anthropic = {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    };
    const o = bodyAnthropicToOpenAI(anthropic);
    expect(o.messages![0].content).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('strips Anthropic-only top-level params (metadata, mcp_servers, context_management, container)', () => {
    const o = bodyAnthropicToOpenAI({
      metadata: { user_id: 'x' },
      mcp_servers: [],
      context_management: {},
      container: {},
    });
    expect(o.metadata).toBeUndefined();
    expect(o.mcp_servers).toBeUndefined();
    expect(o.context_management).toBeUndefined();
    expect(o.container).toBeUndefined();
  });

  it('renames max_tokens → max_completion_tokens (OpenAI preferred)', () => {
    const o = bodyAnthropicToOpenAI({ max_tokens: 100 });
    expect(o.max_completion_tokens).toBe(100);
    expect(o.max_tokens).toBe(100); // also kept for compat
  });
});

describe('responseOpenAIToAnthropic (tool_calls → tool_use)', () => {
  it('converts tool_calls in message to content blocks with tool_use', () => {
    const openaiResp = {
      id: 'x',
      model: 'MiniMax-M3',
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"location":"SF"}' },
              },
            ],
          },
        },
      ],
    };
    const a = responseOpenAIToAnthropic(openaiResp as OpenAIResponse);
    expect(a.stop_reason).toBe('tool_use');
    expect(a.content).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'get_weather', input: { location: 'SF' } },
    ]);
    expect(a.choices).toBeUndefined();
  });

  it("converts finish_reason: 'stop' → 'end_turn'", () => {
    const a = responseOpenAIToAnthropic({
      id: 'x',
      model: 'm',
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
    });
    expect(a.stop_reason).toBe('end_turn');
    expect(a.content).toEqual([{ type: 'text', text: 'ok' }]);
  });

  it("converts finish_reason: 'length' → 'max_tokens'", () => {
    const a = responseOpenAIToAnthropic({
      id: 'x',
      model: 'm',
      choices: [{ finish_reason: 'length', message: { role: 'assistant', content: 'x' } }],
    });
    expect(a.stop_reason).toBe('max_tokens');
  });

  it("converts finish_reason: 'content_filter' → 'refusal'", () => {
    const a = responseOpenAIToAnthropic({
      id: 'x',
      model: 'm',
      choices: [{ finish_reason: 'content_filter', message: { role: 'assistant', content: '' } }],
    });
    expect(a.stop_reason).toBe('refusal');
  });

  it('preserves reasoning_content as a thinking block', () => {
    const a = responseOpenAIToAnthropic({
      id: 'x',
      model: 'm',
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'answer', reasoning_content: 'thought' },
        },
      ],
    });
    expect(a.content).toEqual([
      { type: 'thinking', thinking: 'thought' },
      { type: 'text', text: 'answer' },
    ]);
  });
});

describe('responseAnthropicToOpenAI (tool_use → tool_calls)', () => {
  it('converts tool_use content block to tool_calls', () => {
    const a = {
      id: 'x',
      model: 'm',
      type: 'message',
      role: 'assistant',
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Let me check' },
        { type: 'tool_use', id: 'call_1', name: 'get_weather', input: { location: 'SF' } },
      ],
    };
    const o = responseAnthropicToOpenAI(a);
    expect(o.choices![0].finish_reason).toBe('tool_calls');
    expect(o.choices![0].message.content).toBe('Let me check');
    expect(o.choices![0].message.tool_calls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"location":"SF"}' },
      },
    ]);
  });

  it("converts stop_reason: end_turn → 'stop'", () => {
    const o = responseAnthropicToOpenAI({
      id: 'x',
      model: 'm',
      type: 'message',
      role: 'assistant',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
    });
    expect(o.choices![0].finish_reason).toBe('stop');
  });

  it("converts stop_reason: max_tokens → 'length'", () => {
    expect(
      responseAnthropicToOpenAI({
        id: 'x',
        model: 'm',
        type: 'message',
        role: 'assistant',
        stop_reason: 'max_tokens',
        content: [],
      }).choices![0].finish_reason
    ).toBe('length');
  });

  it("converts stop_reason: refusal → 'content_filter'", () => {
    expect(
      responseAnthropicToOpenAI({
        id: 'x',
        model: 'm',
        type: 'message',
        role: 'assistant',
        stop_reason: 'refusal',
        content: [],
      }).choices![0].finish_reason
    ).toBe('content_filter');
  });

  it('flattens thinking blocks to reasoning_content', () => {
    const o = responseAnthropicToOpenAI({
      id: 'x',
      model: 'm',
      type: 'message',
      role: 'assistant',
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: 'answer' },
      ],
    });
    expect(o.choices![0].message.reasoning_content).toBe('hmm');
    expect(o.choices![0].message.content).toBe('answer');
  });
});

describe('bodyAddsOpenAIStreamUsage', () => {
  it('sets stream_options.include_usage=true when stream=true and stream_options absent', () => {
    const out = bodyAddsOpenAIStreamUsage({ stream: true, messages: [] });
    expect(out.stream_options).toEqual({ include_usage: true });
  });

  it("preserves client's existing stream_options (does not overwrite include_usage=false)", () => {
    const out = bodyAddsOpenAIStreamUsage({
      stream: true,
      stream_options: { include_usage: false },
    });
    expect(out.stream_options.include_usage).toBe(false);
  });

  it('no-op when stream=false', () => {
    const out = bodyAddsOpenAIStreamUsage({ stream: false, messages: [] });
    expect(out.stream_options).toBeUndefined();
  });
});

describe('bodyOpenAIToAnthropic stream_options strip', () => {
  it('strips stream_options from OpenAI body when converting to Anthropic', () => {
    const out = bodyOpenAIToAnthropic({
      model: 'm',
      messages: [],
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(out.stream_options).toBeUndefined();
  });
});
