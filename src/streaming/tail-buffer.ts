/**
 * Sliding tail buffer for SSE. Keeps the most-recent `maxBytes` of an
 * arbitrarily long stream, plus an internal "rest" string for any incomplete
 * final line.
 *
 * Designed to be cheap: a small ring of concatenated chunks, trimmed when it
 * exceeds `maxBytes`. For typical usage (last ~32KB of an SSE stream) the
 * `snapshot()`/`lines()` returns are O(1) amortized.
 */
export class TailBuffer {
  private chunks: string[] = [];
  private len = 0;
  constructor(public readonly maxBytes: number) {}

  push(chunk: string): void {
    this.chunks.push(chunk);
    this.len += chunk.length;
    // Trim oldest chunks until we're under the cap.
    while (this.len > this.maxBytes && this.chunks.length > 1) {
      const dropped = this.chunks.shift()!;
      this.len -= dropped.length;
    }
  }

  snapshot(): string {
    return this.chunks.join('');
  }

  /** Internal: replace the current chunks with a single chunk. */
  reset(text: string): void {
    this.chunks = [text];
    this.len = text.length;
  }
}

export interface ParseResult {
  lines: string[];
  rest: string;
}

/**
 * Parse complete SSE `data: ...` lines from a new chunk. Any trailing
 * incomplete line is returned in `rest` and held inside `tail`.
 */
export function parseSseDataLines(tail: TailBuffer, chunk: string): ParseResult {
  tail.push(chunk);
  const text = tail.snapshot();
  const lastNl = text.lastIndexOf('\n');
  if (lastNl === -1) {
    return { lines: [], rest: text };
  }
  const complete = text.slice(0, lastNl);
  const rest = text.slice(lastNl + 1);
  const lines: string[] = [];
  for (const line of complete.split('\n')) {
    if (line.startsWith('data: ')) {
      const payload = line.slice(6).trim();
      if (payload !== '[DONE]') lines.push(payload);
    } else if (line.startsWith('data:')) {
      // Some servers omit the space; tolerate it.
      const payload = line.slice(5).trim();
      if (payload !== '[DONE]') lines.push(payload);
    }
  }
  tail.reset(rest);
  return { lines, rest };
}
