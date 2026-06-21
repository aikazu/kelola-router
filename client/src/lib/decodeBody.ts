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

export function decodeResponseBody(body: string | null | undefined, meta: BodyMeta): ResponseView {
  const raw = body ?? '';
  const format = detectFormat(body, meta);
  switch (format) {
    case 'openai-completion':
      return decodeOpenaiCompletion(raw);
    case 'anthropic-message':
      return decodeAnthropicMessage(raw);
    case 'anthropic-sse':
      return decodeAnthropicSse(raw);
    case 'error':
      return decodeErrorObject(raw);
    default:
      return { kind: 'plain-text', text: raw, raw };
  }
}

function decodeOpenaiCompletion(raw: string): ResponseView {
  const obj = JSON.parse(raw) as {
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string; reasoning_content?: string };
    }>;
    usage?: unknown;
  };
  const choice = obj.choices?.[0];
  const blocks: ContentBlock[] = [];
  if (choice?.message?.reasoning_content) {
    blocks.push({ type: 'reasoning', text: choice.message.reasoning_content });
  }
  if (choice?.message?.content != null) {
    blocks.push({ type: 'text', text: choice.message.content });
  }
  return {
    kind: 'nonstream',
    contentBlocks: blocks,
    finishReason: choice?.finish_reason,
    usage: obj.usage,
    raw,
  };
}

function decodeAnthropicMessage(raw: string): ResponseView {
  const obj = JSON.parse(raw) as {
    content?: AnthropicContentBlock[];
    stop_reason?: string;
    usage?: unknown;
  };
  return {
    kind: 'nonstream',
    contentBlocks: Array.isArray(obj.content) ? obj.content.map(toContentBlock) : [],
    finishReason: obj.stop_reason,
    usage: obj.usage,
    raw,
  };
}

function decodeErrorObject(raw: string): ResponseView {
  const obj = JSON.parse(raw) as {
    error?: { type?: string; message?: string };
    request_id?: string;
    message?: string;
  };
  return {
    kind: 'error',
    errorType: obj.error?.type,
    message: obj.error?.message ?? obj.message ?? '',
    requestId: obj.request_id,
    raw,
  };
}

interface SseDelta {
  type: string;
  text?: string;
  partial_json?: string;
}

interface SseEventPayload {
  type: string;
  index?: number;
  content_block?: { type: string };
  delta?: SseDelta;
  usage?: unknown;
  message?: { model?: string; usage?: unknown };
}

function decodeAnthropicSse(raw: string): ResponseView {
  const events: SseEvent[] = [];
  const blocks = new Map<number, { type: string; parts: string[]; toolParts: string[] }>();
  let complete = false;

  for (const chunk of raw.split('\n\n')) {
    const lines = chunk.split('\n');
    let type: string | undefined;
    let dataLine: string | undefined;
    for (const line of lines) {
      if (line.startsWith('event: ')) type = line.slice(7).trim();
      else if (line.startsWith('data: ')) dataLine = line.slice(6);
    }
    if (!type) continue;
    events.push({ type, data: dataLine });
    let payload: SseEventPayload | undefined;
    if (dataLine) {
      try {
        payload = JSON.parse(dataLine) as SseEventPayload;
      } catch {
        payload = undefined;
      }
    }
    if (!payload) continue;
    if (type === 'message_stop') complete = true;
    if (type === 'content_block_start' && typeof payload.index === 'number') {
      blocks.set(payload.index, {
        type: payload.content_block?.type ?? 'text',
        parts: [],
        toolParts: [],
      });
    }
    if (type === 'content_block_delta' && typeof payload.index === 'number') {
      const block = blocks.get(payload.index);
      if (!block) continue;
      if (payload.delta?.type === 'text_delta' && typeof payload.delta.text === 'string') {
        block.parts.push(payload.delta.text);
      } else if (
        payload.delta?.type === 'input_json_delta' &&
        typeof payload.delta.partial_json === 'string'
      ) {
        block.toolParts.push(payload.delta.partial_json);
      }
    }
  }

  const reconstructed: ReconstructedText[] = [...blocks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, block]) => {
      if (block.type === 'tool_use') {
        const joined = block.toolParts.join('');
        try {
          return {
            index,
            blockType: block.type,
            text: block.parts.join(''),
            toolInput: JSON.parse(joined),
          };
        } catch {
          return {
            index,
            blockType: block.type,
            text: block.parts.join(''),
            toolInputParseError: true,
          };
        }
      }
      return { index, blockType: block.type, text: block.parts.join('') };
    });

  return { kind: 'sse', events, reconstructed, complete, raw };
}
