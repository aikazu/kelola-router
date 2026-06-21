export const TRUNCATION_SUFFIX = '...truncated...';

export interface BodyMeta {
  contentType?: string;
}

export type DecodedFormat =
  | 'openai-completion'
  | 'anthropic-message'
  | 'anthropic-sse'
  | 'error'
  | 'plain-text';

export interface ContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result' | 'reasoning';
  text?: string;
  mediaType?: string;
  byteLength?: number;
  toolName?: string;
  toolInput?: unknown;
  isError?: boolean;
}

export interface MessageCard {
  role: string;
  blocks: ContentBlock[];
}

export interface RequestSummary {
  messageCount: number;
  toolCount: number;
  hasSystem: boolean;
  stream: boolean;
}

export interface RequestView {
  kind: 'request';
  system?: ContentBlock[];
  tools?: Array<{ name: string; inputSchema?: unknown }>;
  messages: MessageCard[];
  summary: RequestSummary;
  raw: string;
  parseError?: string;
}

export interface SseEvent {
  type: string;
  data?: string;
}

export interface ReconstructedText {
  index: number;
  blockType: string;
  text: string;
  toolInput?: unknown;
  toolInputParseError?: boolean;
}

export type ResponseView =
  | {
      kind: 'nonstream';
      contentBlocks: ContentBlock[];
      finishReason?: string;
      usage?: unknown;
      raw: string;
    }
  | {
      kind: 'sse';
      events: SseEvent[];
      reconstructed: ReconstructedText[];
      complete: boolean;
      raw: string;
    }
  | { kind: 'error'; errorType?: string; message: string; requestId?: string; raw: string }
  | { kind: 'plain-text'; text: string; raw: string };

export function isTruncated(body: string | null | undefined): boolean {
  return body?.endsWith(TRUNCATION_SUFFIX) ?? false;
}

export function detectFormat(body: string | null | undefined, meta: BodyMeta): DecodedFormat {
  if (body == null) return 'plain-text';
  const trimmed = body.trimStart();
  if (trimmed.startsWith('event:')) return 'anthropic-sse';
  if (meta.contentType?.includes('text/event-stream')) return 'anthropic-sse';
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return 'plain-text';
  }
  if (parsed !== null && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.choices)) return 'openai-completion';
    if (Array.isArray(obj.content) && 'stop_reason' in obj) return 'anthropic-message';
    if ('error' in obj) return 'error';
  }
  return 'plain-text';
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  is_error?: boolean;
  source?: { type?: string; media_type?: string; data?: string };
}

interface AnthropicMessage {
  role: string;
  content: string | AnthropicContentBlock[];
}

export function decodeRequestBody(body: string | null | undefined): RequestView {
  const raw = body ?? '';
  const base: RequestView = {
    kind: 'request',
    messages: [],
    summary: { messageCount: 0, toolCount: 0, hasSystem: false, stream: false },
    raw,
  };
  if (!body) return base;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    return { ...base, parseError: e instanceof Error ? e.message : 'parse failed' };
  }
  if (parsed === null || typeof parsed !== 'object')
    return { ...base, parseError: 'not an object' };
  const obj = parsed as Record<string, unknown>;

  const systemBlocks = toSystemBlocks(obj.system);
  const tools = toTools(obj.tools);
  const messages = toMessages(obj.messages);

  return {
    ...base,
    system: systemBlocks,
    tools,
    messages,
    summary: {
      messageCount: messages.length,
      toolCount: tools?.length ?? 0,
      hasSystem: systemBlocks !== undefined,
      stream: obj.stream === true,
    },
  };
}

function toSystemBlocks(system: unknown): ContentBlock[] | undefined {
  if (system == null) return undefined;
  if (typeof system === 'string') return [{ type: 'text', text: system }];
  if (Array.isArray(system)) {
    return system
      .filter((b): b is AnthropicContentBlock => b !== null && typeof b === 'object' && 'type' in b)
      .map((b) => ({ type: 'text', text: b.text ?? '' }));
  }
  return undefined;
}

function toTools(tools: unknown): Array<{ name: string; inputSchema?: unknown }> | undefined {
  if (!Array.isArray(tools)) return undefined;
  return tools
    .filter((t): t is Record<string, unknown> => t !== null && typeof t === 'object')
    .map((t) => ({ name: String(t.name ?? ''), inputSchema: t.input_schema }));
}

function toMessages(messages: unknown): MessageCard[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m): m is AnthropicMessage => m !== null && typeof m === 'object' && 'role' in m)
    .map((m) => ({ role: m.role, blocks: toContentBlocks(m.content) }));
}

function toContentBlocks(content: string | AnthropicContentBlock[]): ContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  return content.map(toContentBlock);
}

function toContentBlock(b: AnthropicContentBlock): ContentBlock {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text ?? '' };
    case 'image':
      return {
        type: 'image',
        mediaType: b.source?.media_type,
        byteLength: b.source?.data?.length ?? 0,
      };
    case 'tool_use':
      return { type: 'tool_use', toolName: b.name, toolInput: b.input };
    case 'tool_result': {
      const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '');
      return { type: 'tool_result', text, isError: b.is_error === true };
    }
    default:
      return { type: 'text', text: JSON.stringify(b) };
  }
}
