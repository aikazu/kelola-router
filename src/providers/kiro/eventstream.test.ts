import { describe, expect, it } from 'vitest';
import { KiroAssembler } from './assembler.js';
import { decodeFrames, type KiroEvent } from './eventstream.js';

/**
 * Build a single AWS event-stream frame with one string header (`:event-type`)
 * and a JSON payload. CRC fields are zeroed (the decoder does not verify them).
 */
function buildFrame(eventType: string, payload: unknown): Uint8Array {
  const enc = new TextEncoder();
  const nameBytes = enc.encode(':event-type');
  const valueBytes = enc.encode(eventType);
  // header: nameLen(1) name type(1) valueLen(2) value
  const headerLen = 1 + nameBytes.length + 1 + 2 + valueBytes.length;
  const header = new Uint8Array(headerLen);
  const hv = new DataView(header.buffer);
  let o = 0;
  header[o++] = nameBytes.length;
  header.set(nameBytes, o);
  o += nameBytes.length;
  header[o++] = 7; // string type
  hv.setUint16(o, valueBytes.length, false);
  o += 2;
  header.set(valueBytes, o);

  const payloadBytes = enc.encode(payload === undefined ? '' : JSON.stringify(payload));
  const totalLen = 12 + headerLen + payloadBytes.length + 4;
  const frame = new Uint8Array(totalLen);
  const fv = new DataView(frame.buffer);
  fv.setUint32(0, totalLen, false);
  fv.setUint32(4, headerLen, false);
  // prelude CRC at 8 left 0
  frame.set(header, 12);
  frame.set(payloadBytes, 12 + headerLen);
  // message CRC at end left 0
  return frame;
}

function concat(frames: Uint8Array[]): Uint8Array {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const f of frames) {
    out.set(f, off);
    off += f.length;
  }
  return out;
}

describe('decodeFrames', () => {
  it('decodes a single assistantResponseEvent frame', () => {
    const frame = buildFrame('assistantResponseEvent', { content: 'Hello' });
    const { events, rest } = decodeFrames(frame);
    expect(rest.length).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('assistantResponseEvent');
    expect(events[0]!.payload).toEqual({ content: 'Hello' });
  });

  it('decodes multiple concatenated frames', () => {
    const buf = concat([
      buildFrame('assistantResponseEvent', { content: 'A' }),
      buildFrame('assistantResponseEvent', { content: 'B' }),
      buildFrame('messageStopEvent', {}),
    ]);
    const { events } = decodeFrames(buf);
    expect(events.map((e) => e.eventType)).toEqual([
      'assistantResponseEvent',
      'assistantResponseEvent',
      'messageStopEvent',
    ]);
  });

  it('returns trailing partial bytes as rest', () => {
    const frame = buildFrame('assistantResponseEvent', { content: 'Hi' });
    const partial = frame.slice(0, frame.length - 3);
    const { events, rest } = decodeFrames(partial);
    expect(events).toHaveLength(0);
    expect(rest.length).toBe(partial.length);
  });
});

describe('KiroAssembler', () => {
  it('emits assistant content chunks then a finish chunk', () => {
    const a = new KiroAssembler('claude-sonnet-4-5');
    const out: ReturnType<KiroAssembler['process']> = [];
    const ev = (e: KiroEvent) => out.push(...a.process(e));
    ev({ eventType: 'assistantResponseEvent', headers: {}, payload: { content: 'Hello ' } });
    ev({ eventType: 'assistantResponseEvent', headers: {}, payload: { content: 'world' } });
    ev({ eventType: 'messageStopEvent', headers: {}, payload: {} });
    const flat = out.flat();
    expect(flat[0]!.choices[0]!.delta).toEqual({ role: 'assistant', content: 'Hello ' });
    expect(flat[1]!.choices[0]!.delta).toEqual({ content: 'world' });
    expect(flat[2]!.choices[0]!.finish_reason).toBe('stop');
  });

  it('emits tool_calls and reports tool_calls finish reason', () => {
    const a = new KiroAssembler('claude-sonnet-4-5');
    const chunks = a.process({
      eventType: 'toolUseEvent',
      headers: {},
      payload: { toolUseId: 't1', name: 'get_weather', input: { city: 'London' } },
    });
    const start = chunks[0]!.choices[0]!.delta.tool_calls![0]!;
    expect(start.id).toBe('t1');
    expect(start.function!.name).toBe('get_weather');
    expect(a.finishReason).toBe('tool_calls');
  });
});
