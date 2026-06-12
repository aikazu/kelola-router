// src/console/format.test.ts
import { describe, expect, it } from 'vitest';
import { fmtTokens, renderStdout, stripAnsi } from './format.js';
import type { FlowEvent } from './types.js';

const TS = '2026-06-09T12:04:31.000Z';

describe('fmtTokens', () => {
  it('formats thousands with k suffix', () => {
    expect(fmtTokens(1200)).toBe('1.2k');
    expect(fmtTokens(340)).toBe('340');
    expect(fmtTokens(0)).toBe('0');
  });
});

describe('renderStdout', () => {
  it('renders a start line with reqId, method, path, model', () => {
    const ev: FlowEvent = {
      phase: 'start',
      reqId: 'a3f2',
      ts: TS,
      method: 'POST',
      path: '/v1/messages',
      model: 'claude-sonnet-4',
      alias: null,
    };
    expect(stripAnsi(renderStdout(ev))).toBe('#a3f2 → POST /v1/messages claude-sonnet-4');
  });

  it('renders alias when present', () => {
    const ev: FlowEvent = {
      phase: 'start',
      reqId: 'a3f2',
      ts: TS,
      method: 'POST',
      path: '/v1/messages',
      model: 'claude-sonnet-4',
      alias: 'sonnet',
    };
    expect(stripAnsi(renderStdout(ev))).toBe('#a3f2 → POST /v1/messages sonnet→claude-sonnet-4');
  });

  it('renders account line', () => {
    const ev: FlowEvent = {
      phase: 'account',
      reqId: 'a3f2',
      ts: TS,
      accountLabel: 'kiro1',
      reason: 'round-robin',
    };
    expect(stripAnsi(renderStdout(ev))).toBe('  ⤷ account: kiro1 (round-robin)');
  });

  it('renders transport line', () => {
    const ev: FlowEvent = {
      phase: 'transport',
      reqId: 'a3f2',
      ts: TS,
      kind: 'proxy',
      label: 'us-1',
    };
    expect(stripAnsi(renderStdout(ev))).toBe('  ⤷ proxy: us-1');
  });

  it('renders done line', () => {
    const ev: FlowEvent = {
      phase: 'done',
      reqId: 'a3f2',
      ts: TS,
      status: 200,
      ttftMs: 480,
      inTok: 1200,
      outTok: 340,
      cacheTok: 800,
      costUsd: 0.004,
      latencyMs: 1400,
      rtkSaved: 0,
    };
    expect(stripAnsi(renderStdout(ev))).toBe('  ✓ in 1.2k out 340 cache 800 $0.0040 1.4s · 200');
  });

  it('renders done line with saved when rtkSaved > 0', () => {
    const ev: FlowEvent = {
      phase: 'done',
      reqId: 'a3f2',
      ts: TS,
      status: 200,
      ttftMs: 480,
      inTok: 1200,
      outTok: 340,
      cacheTok: 800,
      costUsd: 0.004,
      latencyMs: 1400,
      rtkSaved: 2400,
    };
    expect(stripAnsi(renderStdout(ev))).toBe(
      '  ✓ in 1.2k out 340 cache 800 $0.0040 1.4s saved 2.4k · 200'
    );
  });

  it('renders error line', () => {
    const ev: FlowEvent = {
      phase: 'error',
      reqId: 'a3f2',
      ts: TS,
      status: 429,
      message: 'rate limited',
    };
    expect(stripAnsi(renderStdout(ev))).toBe('  ✗ 429 rate limited');
  });

  it('renders transport-fail line with direct fallback', () => {
    const ev: FlowEvent = {
      phase: 'transport-fail',
      reqId: 'a3f2',
      ts: TS,
      fellBack: true,
      message: 'connect ECONNREFUSED',
    };
    expect(stripAnsi(renderStdout(ev))).toBe('  ⤷ proxy failed → direct: connect ECONNREFUSED');
  });

  it('renders transport-fail line when blocked', () => {
    const ev: FlowEvent = {
      phase: 'transport-fail',
      reqId: 'a3f2',
      ts: TS,
      fellBack: false,
      message: 'connect ECONNREFUSED',
    };
    expect(stripAnsi(renderStdout(ev))).toBe('  ⤷ proxy blocked: connect ECONNREFUSED');
  });
});
