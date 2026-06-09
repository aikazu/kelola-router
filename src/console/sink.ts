// src/console/sink.ts
import { ConsoleBus, consoleBus } from './bus.js';
import { renderStdout } from './format.js';

/** Subscribe a stdout writer to the bus. Gated by CONSOLE_FLOW (default on). */
export function attachStdoutSink(bus: ConsoleBus = consoleBus): () => void {
  if (process.env.CONSOLE_FLOW === '0') return () => {};
  return bus.subscribe((ev) => {
    process.stdout.write(`${renderStdout(ev)}\n`);
  });
}
