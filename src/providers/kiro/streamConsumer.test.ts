import { describe, expect, it, vi } from 'vitest';
import type { KiroEvent } from './eventstream.js';
import * as eventstreamModule from './eventstream.js';
import { consumeKiroFrames } from './streamConsumer.js';

function makeStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

describe('consumeKiroFrames', () => {
  it('yields events decoded from a single chunk', async () => {
    const fakeEvent: KiroEvent = {
      eventType: 'assistantResponseEvent',
      headers: { ':event-type': 'assistantResponseEvent' },
      payload: { content: 'hi' },
    };
    vi.spyOn(eventstreamModule, 'decodeFrames').mockReturnValue({
      events: [fakeEvent],
      rest: new Uint8Array(0),
    });

    const stream = makeStream([new Uint8Array([1, 2, 3])]);
    const results: KiroEvent[] = [];
    for await (const ev of consumeKiroFrames(stream)) {
      results.push(ev);
    }

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(fakeEvent);
    vi.restoreAllMocks();
  });

  it('handles leftover bytes across chunks', async () => {
    const fakeEvent: KiroEvent = {
      eventType: 'assistantResponseEvent',
      headers: { ':event-type': 'assistantResponseEvent' },
      payload: { content: 'x' },
    };
    let callCount = 0;
    vi.spyOn(eventstreamModule, 'decodeFrames').mockImplementation(() => {
      callCount++;
      if (callCount === 1) return { events: [], rest: new Uint8Array([9, 9]) };
      return { events: [fakeEvent], rest: new Uint8Array(0) };
    });

    const stream = makeStream([new Uint8Array([1]), new Uint8Array([2])]);
    const results: KiroEvent[] = [];
    for await (const ev of consumeKiroFrames(stream)) {
      results.push(ev);
    }

    expect(results).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('yields nothing for empty stream', async () => {
    vi.spyOn(eventstreamModule, 'decodeFrames').mockReturnValue({
      events: [],
      rest: new Uint8Array(0),
    });
    const stream = makeStream([]);
    const results: KiroEvent[] = [];
    for await (const ev of consumeKiroFrames(stream)) results.push(ev);
    expect(results).toHaveLength(0);
    vi.restoreAllMocks();
  });
});
