// src/console/sink.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleBus } from './bus.js';
import { attachStdoutSink } from './sink.js';
import type { FlowEvent } from './types.js';

const ev: FlowEvent = {
  phase: 'start',
  reqId: 'a',
  ts: '2026-06-09T00:00:00.000Z',
  method: 'POST',
  path: '/v1/messages',
  model: 'm',
  alias: null,
};

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CONSOLE_FLOW;
});

describe('attachStdoutSink', () => {
  beforeEach(() => {
    // Use a small interval for deterministic tests.
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces multiple events into a single write within the flush window', () => {
    const bus = new ConsoleBus(50);
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const detach = attachStdoutSink(bus, { intervalMs: 30 });
    for (let i = 0; i < 5; i++) bus.emit(ev);
    // Not yet flushed — coalescer is waiting for the timer.
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30);
    // Single batched write containing all 5 events.
    expect(spy).toHaveBeenCalledOnce();
    const out = String(spy.mock.calls[0][0]);
    for (let i = 0; i < 5; i++) expect(out).toContain('#a');
    detach();
  });

  it('suppresses output when CONSOLE_FLOW=0', () => {
    process.env.CONSOLE_FLOW = '0';
    const bus = new ConsoleBus();
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const detach = attachStdoutSink(bus);
    bus.emit(ev);
    vi.advanceTimersByTime(100);
    expect(spy).not.toHaveBeenCalled();
    detach();
  });

  it('detach() flushes any pending events immediately', () => {
    const bus = new ConsoleBus(50);
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const detach = attachStdoutSink(bus, { intervalMs: 1000 });
    bus.emit(ev);
    detach();
    expect(spy).toHaveBeenCalledOnce();
  });
});
