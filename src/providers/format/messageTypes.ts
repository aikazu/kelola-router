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
  thinking?: string;
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
  role?: string;
  content?: string | ContentBlock[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
  reasoning_content?: string;
}

export interface OpenAIBody {
  system?: string;
  instructions?: string;
  messages?: OpenAIMessage[];
  input?: OpenAIMessage[]; // Responses API
  tools?: unknown[];
  tool_choice?: unknown;
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  [extra: string]: unknown; // forward-compat for fields we don't model
}

export interface OpenAIResponse {
  id?: string;
  model?: string;
  object?: string;
  created?: number;
  choices?: Array<{
    index?: number;
    finish_reason?: string | null;
    message: OpenAIMessage;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  [k: string]: unknown;
}

export interface AnthropicResponse {
  id?: string;
  model?: string;
  type?: string;
  role?: string;
  content?: ContentBlock[];
  stop_reason?: string | null;
  stop_sequence?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  [k: string]: unknown;
}
