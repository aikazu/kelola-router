// src/console/flow.test.ts
import { describe, expect, it } from 'vitest';
import { ConsoleBus } from './bus.js';
import {
  buildAccount,
  buildDone,
  buildError,
  buildStart,
  buildTransport,
  buildTransportFail,
  genReqId,
} from './flow.js';

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
      phase: 'start',
      reqId: 'a',
      ts,
      method: 'POST',
      path: '/v1/messages',
      model: 'm',
      alias: 'al',
    });
  });
  it('buildDone', () => {
    expect(buildDone('a', ts, 200, 100, 1, 2, 3, 0.5, 999, 42)).toEqual({
      phase: 'done',
      reqId: 'a',
      ts,
      status: 200,
      ttftMs: 100,
      inTok: 1,
      outTok: 2,
      cacheTok: 3,
      costUsd: 0.5,
      latencyMs: 999,
      rtkSaved: 42,
    });
  });

  it('buildDone defaults rtkSaved to 0', () => {
    const ev = buildDone('a', ts, 200, 100, 1, 2, 3, 0.5, 999);
    if (ev.phase !== 'done') throw new Error('wrong phase');
    expect(ev.rtkSaved).toBe(0);
  });
  it('buildTransportFail', () => {
    expect(buildTransportFail('a', ts, true, 'ECONNREFUSED')).toEqual({
      phase: 'transport-fail',
      reqId: 'a',
      ts,
      fellBack: true,
      message: 'ECONNREFUSED',
    });
  });
  it('buildTransportFail truncates long messages', () => {
    const ev = buildTransportFail('a', ts, false, 'x'.repeat(300));
    if (ev.phase !== 'transport-fail') throw new Error('wrong phase');
    expect(ev.message.length).toBe(200);
  });
  it('emits onto a bus', () => {
    const bus = new ConsoleBus();
    bus.emit(buildAccount('a', ts, 'kiro1', 'sticky'));
    bus.emit(buildTransport('a', ts, 'proxy', 'us-1'));
    bus.emit(buildTransportFail('a', ts, true, 'boom'));
    bus.emit(buildError('a', ts, 500, 'boom'));
    expect(bus.recent().map((e) => e.phase)).toEqual([
      'account',
      'transport',
      'transport-fail',
      'error',
    ]);
  });
});
