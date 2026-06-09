// src/console/bus.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleBus } from './bus.js';
import type { FlowEvent } from './types.js';

function ev(reqId: string): FlowEvent {
  return { phase: 'start', reqId, ts: '2026-06-09T00:00:00.000Z', method: 'POST', path: '/v1/messages', model: 'm', alias: null };
}

describe('ConsoleBus', () => {
  let bus: ConsoleBus;
  beforeEach(() => {
    bus = new ConsoleBus(3); // small cap for test
  });

  it('delivers emitted events to subscribers', () => {
    const seen: FlowEvent[] = [];
    bus.subscribe((e) => seen.push(e));
    bus.emit(ev('a'));
    expect(seen).toHaveLength(1);
    expect(seen[0].reqId).toBe('a');
  });

  it('unsubscribe stops delivery', () => {
    const fn = vi.fn();
    const off = bus.subscribe(fn);
    off();
    bus.emit(ev('a'));
    expect(fn).not.toHaveBeenCalled();
  });

  it('recent() returns buffered events oldest->newest, capped', () => {
    bus.emit(ev('a'));
    bus.emit(ev('b'));
    bus.emit(ev('c'));
    bus.emit(ev('d')); // evicts 'a'
    expect(bus.recent().map((e) => e.reqId)).toEqual(['b', 'c', 'd']);
  });

  it('a throwing subscriber does not break others', () => {
    const good = vi.fn();
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe(good);
    bus.emit(ev('a'));
    expect(good).toHaveBeenCalledOnce();
  });
});
