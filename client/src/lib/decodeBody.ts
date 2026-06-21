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
