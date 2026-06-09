// src/console/flow.test.ts
import { describe, expect, it } from 'vitest';
import { ConsoleBus } from './bus.js';
import { buildAccount, buildDone, buildError, buildStart, buildTransport, genReqId } from './flow.js';

describe('genReqId', () => {
  it('returns a short hex id', () => {
    const id = genReqId();
    expect(id).toMatch(/^[0-9a-f]{4,8}$/);
  });
  it('returns distinct ids', () => {
    expect(genReqId()).not.toBe(genReqId());
  });
});

describe('build* helpers', () => {
  const ts = '2026-06-09T00:00:00.000Z';
  it('buildStart', () => {
    expect(buildStart('a', ts, 'POST', '/v1/messages', 'm', 'al')).toEqual({
      phase: 'start', reqId: 'a', ts, method: 'POST', path: '/v1/messages', model: 'm', alias: 'al',
    });
  });
  it('buildDone', () => {
    expect(buildDone('a', ts, 200, 100, 1, 2, 3, 0.5, 999)).toEqual({
      phase: 'done', reqId: 'a', ts, status: 200, ttftMs: 100, inTok: 1, outTok: 2, cacheTok: 3, costUsd: 0.5, latencyMs: 999,
    });
  });
  it('emits onto a bus', () => {
    const bus = new ConsoleBus();
    bus.emit(buildAccount('a', ts, 'kiro1', 'sticky'));
    bus.emit(buildTransport('a', ts, 'proxy', 'us-1'));
    bus.emit(buildError('a', ts, 500, 'boom'));
    expect(bus.recent().map((e) => e.phase)).toEqual(['account', 'transport', 'error']);
  });
});
