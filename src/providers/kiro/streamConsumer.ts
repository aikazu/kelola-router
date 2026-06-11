import { ChunkAccumulator } from './chunkAccumulator.js';
import { decodeFrames, type KiroEvent } from './eventstream.js';

/**
 * Consume a Kiro binary response body and yield decoded KiroEvents one by one.
 * Handles partial frames via ChunkAccumulator — safe to call with any chunk size.
 */
export async function* consumeKiroFrames(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<KiroEvent> {
  const reader = body.getReader();
  const acc = new ChunkAccumulator();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    acc.push(value);
    const merged = acc.view();
    const { events, rest: leftover } = decodeFrames(merged);
    acc.consume(merged.length - leftover.length);
    for (const event of events) yield event;
  }
}
