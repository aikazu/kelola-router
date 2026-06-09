// src/console/sink.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleBus } from './bus.js';
import { attachStdoutSink } from './sink.js';
import type { FlowEvent } from './types.js';

const ev: FlowEvent = { phase: 'start', reqId: 'a', ts: '2026-06-09T00:00:00.000Z', method: 'POST', path: '/v1/messages', model: 'm', alias: null };

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CONSOLE_FLOW;
});

describe('attachStdoutSink', () => {
  it('writes a rendered line per event when enabled', () => {
    const bus = new ConsoleBus();
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    attachStdoutSink(bus);
    bus.emit(ev);
    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0][0])).toContain('#a');
  });

  it('suppresses output when CONSOLE_FLOW=0', () => {
    process.env.CONSOLE_FLOW = '0';
    const bus = new ConsoleBus();
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    attachStdoutSink(bus);
    bus.emit(ev);
    expect(spy).not.toHaveBeenCalled();
  });
});
