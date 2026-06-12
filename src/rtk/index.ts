import { safeApply } from './applyFilter.js';
import { autoDetectFilter } from './autodetect.js';
import { MIN_COMPRESS_SIZE, RAW_CAP } from './constants.js';
import type { CompressStats } from './types.js';

type MutableRecord = Record<string, unknown>;

function isRecord(value: unknown): value is MutableRecord {
  return typeof value === 'object' && value !== null;
}

export function compressMessages(body: unknown, enabled: boolean): CompressStats | null {
  if (!enabled) return null;
  if (!isRecord(body)) return null;

  const items: unknown[] | null = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.input)
      ? body.input
      : null;
  if (!items) return null;

  const stats: CompressStats = { bytesBefore: 0, bytesAfter: 0, hits: [] };
  try {
    for (const msg of items) {
      if (!isRecord(msg)) continue;
      if (msg.type === 'function_call_output') {
        if (typeof msg.output === 'string')
          msg.output = compressText(msg.output, stats, 'openai-responses');
        else if (Array.isArray(msg.output)) {
          for (const part of msg.output) {
            if (isRecord(part) && part.type === 'input_text' && typeof part.text === 'string') {
              part.text = compressText(part.text, stats, 'openai-responses-array');
            }
          }
        }
        continue;
      }
      if (msg.role === 'tool' && typeof msg.content === 'string') {
        msg.content = compressText(msg.content, stats, 'openai-tool');
        continue;
      }
      if (msg.role === 'tool' && Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
            part.text = compressText(part.text, stats, 'openai-tool-array');
          }
        }
        continue;
      }
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (!isRecord(block) || block.type !== 'tool_result') continue;
          if (block.is_error === true) continue;
          if (typeof block.content === 'string') {
            block.content = compressText(block.content, stats, 'claude-string');
          } else if (Array.isArray(block.content)) {
            for (const part of block.content) {
              if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
                part.text = compressText(part.text, stats, 'claude-array');
              }
            }
          }
        }
      }
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn('[RTK] compressMessages error:', message);
    return null;
  }
  return stats.hits.length > 0 ? stats : null;
}

function compressText(text: string, stats: CompressStats, shape: string): string {
  const bytesIn = text.length;
  stats.bytesBefore += bytesIn;
  if (bytesIn < MIN_COMPRESS_SIZE || bytesIn > RAW_CAP) {
    stats.bytesAfter += bytesIn;
    return text;
  }
  const fn = autoDetectFilter(text);
  if (!fn) {
    stats.bytesAfter += bytesIn;
    return text;
  }
  const out = safeApply(fn, text);
  if (!out || out.length === 0 || out.length >= bytesIn) {
    stats.bytesAfter += bytesIn;
    return text;
  }
  stats.bytesAfter += out.length;
  stats.hits.push({ shape, filter: fn.filterName, saved: bytesIn - out.length });
  return out;
}

export function rtkBytesSaved(stats: CompressStats | null): number {
  if (!stats) return 0;
  const saved = stats.bytesBefore - stats.bytesAfter;
  return saved > 0 ? saved : 0;
}

export function formatRtkLog(stats: CompressStats | null): string | null {
  if (!stats?.hits?.length) return null;
  const saved = stats.bytesBefore - stats.bytesAfter;
  const pct = stats.bytesBefore > 0 ? ((saved / stats.bytesBefore) * 100).toFixed(1) : '0';
  const filters = [...new Set(stats.hits.map((h) => h.filter))].join(',');
  return `[RTK] saved ${saved}B / ${stats.bytesBefore}B (${pct}%) via [${filters}] hits=${stats.hits.length}`;
}
