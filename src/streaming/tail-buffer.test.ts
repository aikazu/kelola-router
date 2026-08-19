import { describe, expect, it } from 'vitest';
import { parseSseDataLines, TailBuffer } from './tail-buffer.js';

describe('TailBuffer', () => {
  it('keeps the most recent N bytes (drops oldest chunks first)', () => {
    const t = new TailBuffer(10);
    t.push('0123456789'); // 10 chars
    t.push('abcdef'); // 6 chars — pushes us over 10; oldest whole chunk dropped
    expect(t.snapshot()).toBe('abcdef');
  });

  it('keeps the last few whole chunks when each is small', () => {
    const t = new TailBuffer(10);
    t.push('aaa'); // 3
    t.push('bbb'); // 6
    t.push('ccc'); // 9
    t.push('ddd'); // 12 > 10, drop 'aaa'
    expect(t.snapshot()).toBe('bbbcccddd');
  });

  it('parses complete SSE data: lines from a chunk', () => {
    const t = new TailBuffer(1024);
    const { lines, rest } = parseSseDataLines(t, 'data: {"a":1}\ndata: {"b":2}\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe('');
  });

  it('holds back the last incomplete line until the next chunk', () => {
    const t = new TailBuffer(1024);
    const r1 = parseSseDataLines(t, 'data: hello\ndata: par');
    expect(r1.lines).toEqual(['hello']);
    expect(r1.rest).toBe('data: par');
    const r2 = parseSseDataLines(t, 'tial\n');
    expect(r2.lines).toEqual(['partial']);
    expect(r2.rest).toBe('');
  });
});
