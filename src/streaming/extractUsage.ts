import { parseSseDataLines, type TailBuffer } from './tailBuffer.js';

export interface SSEUsage {
  prompt_tokens: number;
  completion_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
}

export interface SSEParseResult {
  usage: SSEUsage | null;
  raw: string;
}

function extractUsageFromSSE(raw: string, format: 'openai' | 'anthropic'): SSEParseResult {
  if (format === 'openai') return extractOpenAI(raw);
  return extractAnthropic(raw);
}

function extractOpenAI(raw: string): SSEParseResult {
  let usage: SSEUsage | null = null;
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (payload === '[DONE]') continue;
    try {
      const obj = JSON.parse(payload);
      if (obj.usage) {
        usage = {
          prompt_tokens: obj.usage.prompt_tokens ?? 0,
          completion_tokens: obj.usage.completion_tokens ?? 0,
          cache_creation_tokens: 0,
          cache_read_tokens: obj.usage.prompt_tokens_details?.cached_tokens ?? 0,
          total_tokens: obj.usage.total_tokens ?? 0,
        };
      }
    } catch {}
  }
  return { usage, raw };
}

function extractAnthropic(raw: string): SSEParseResult {
  let usage: SSEUsage | null = null;
  const events = raw.split('\n\n');
  for (const ev of events) {
    const lines = ev.split('\n');
    let data = '';
    for (const l of lines) if (l.startsWith('data: ')) data += l.slice(6).trim();
    if (!data) continue;
    try {
      const obj = JSON.parse(data);
      if (obj.usage && (obj.type === 'message_delta' || obj.type === 'message_start')) {
        usage = {
          prompt_tokens: obj.usage.input_tokens ?? 0,
          completion_tokens: obj.usage.output_tokens ?? 0,
          cache_creation_tokens: obj.usage.cache_creation_input_tokens ?? 0,
          cache_read_tokens: obj.usage.cache_read_input_tokens ?? 0,
          total_tokens: (obj.usage.input_tokens ?? 0) + (obj.usage.output_tokens ?? 0),
        };
      }
    } catch {}
  }
  return { usage, raw };
}

/** Incrementally extract SSE usage from a chunk via a TailBuffer. */
export function extractUsageFromSSEStream(
  tail: TailBuffer,
  chunk: string,
  format: 'openai' | 'anthropic',
  last: SSEUsage | null
): SSEUsage | null {
  const { lines } = parseSseDataLines(tail, chunk);
  if (lines.length === 0) return last;
  for (const payload of lines) {
    try {
      const obj = JSON.parse(payload) as Record<string, unknown>;
      const u = obj.usage as Record<string, unknown> | undefined;
      if (!u) continue;
      if (format === 'openai') {
        last = {
          prompt_tokens: (u.prompt_tokens as number) ?? 0,
          completion_tokens: (u.completion_tokens as number) ?? 0,
          cache_creation_tokens: 0,
          cache_read_tokens:
            (u.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens ?? 0,
          total_tokens: (u.total_tokens as number) ?? 0,
        };
      } else {
        last = {
          prompt_tokens: (u.input_tokens as number) ?? 0,
          completion_tokens: (u.output_tokens as number) ?? 0,
          cache_creation_tokens: (u.cache_creation_input_tokens as number) ?? 0,
          cache_read_tokens: (u.cache_read_input_tokens as number) ?? 0,
          total_tokens: ((u.input_tokens as number) ?? 0) + ((u.output_tokens as number) ?? 0),
        };
      }
    } catch {
      // ignore malformed payloads
    }
  }
  return last;
}

// @internal — exported for unit tests only; production code uses extractUsageFromSSEStream
export { extractUsageFromSSE };
