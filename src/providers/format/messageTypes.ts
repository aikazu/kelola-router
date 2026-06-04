/**
 * Shared message-shape types for OpenAI ↔ Anthropic body conversion and
 * the adjacent cache/caveman/alias injection points. These cover the
 * field shapes the proxy actually touches — not the full provider
 * schemas. Anything unknown is left to the provider SDK at request time.
 */

export type CacheControl = { type: 'ephemeral' };

export interface ContentBlock {
  type?: string;
  text?: string;
  cache_control?: CacheControl;
  content?: ContentBlock[];
  // Tool-use blocks carry arbitrary inputs we never read.
  id?: string;
  name?: string;
  input?: unknown;
}

export interface AnthropicMessage {
  role?: string;
  content?: string | ContentBlock[];
}

export interface AnthropicBody {
  system?: string | ContentBlock[];
  messages?: AnthropicMessage[];
  // Forward-compat for provider-specific fields the proxy forwards but doesn't
  // model (max_tokens, tools, tool_choice, metadata, mcp_servers, stream_options, …).
  [extra: string]: unknown;
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenAIMessage {
  role?: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  content?: string | ContentBlock[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

export interface OpenAIBody {
  system?: string;
  instructions?: string;
  messages?: OpenAIMessage[];
  input?: OpenAIMessage[]; // Responses API
  tools?: unknown[];
  tool_choice?: unknown;
  stream?: boolean;
  [extra: string]: unknown; // forward-compat for fields we don't model
}
