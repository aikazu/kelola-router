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
