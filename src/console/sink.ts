// src/console/sink.ts
import type { ConsoleBus } from './bus.js';
import { Coalescer } from '../util/coalescer.js';
import { renderStdout } from './format.js';

export interface SinkOptions {
  intervalMs?: number;
  highWater?: number;
}

/** Subscribe a coalesced stdout writer to the bus. */
export function attachStdoutSink(bus: ConsoleBus, opts: SinkOptions = {}): () => void {
  if (process.env.CONSOLE_FLOW === '0') return () => {};
  const intervalMs = opts.intervalMs ?? 50;
  const highWater = opts.highWater ?? 500;
  const coalescer = new Coalescer<{ ev: Parameters<typeof renderStdout>[0] }>({
    intervalMs,
    highWater,
    flush: (items) => {
      const text = items.map((i) => renderStdout(i.ev)).join('\n') + '\n';
      // Respect backpressure: if the write can't keep up, the next batch
      // will catch up. We don't drop here — the coalescer's high-water mark
      // already bounds memory.
      if (!process.stdout.write(text)) {
        // No-op: future enhancement could pause + drain on 'drain' event.
      }
    },
  });
  const off = bus.subscribe((ev) => coalescer.push({ ev }));
  return () => {
    off();
    coalescer.dispose();
  };
}
