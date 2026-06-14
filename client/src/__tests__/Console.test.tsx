import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { ConsoleBlocks, type FlowEvent } from '../pages/Console';

const start: FlowEvent = { phase: 'start', reqId: 'a3f2', ts: '2026-06-09T12:04:31.000Z', method: 'POST', path: '/v1/messages', model: 'claude-sonnet-4', alias: null };
const account: FlowEvent = { phase: 'account', reqId: 'a3f2', ts: '', accountLabel: 'kiro1', reason: 'round-robin' };
const done: FlowEvent = { phase: 'done', reqId: 'a3f2', ts: '', status: 200, ttftMs: 480, inTok: 1200, outTok: 340, cacheTok: 800, costUsd: 0.004, latencyMs: 1400, rtkSaved: 0 };
const err: FlowEvent = { phase: 'error', reqId: 'b1', ts: '', status: 429, message: 'rate limited' };

describe('ConsoleBlocks', () => {
  it('groups events by reqId and renders summary', () => {
    render(<ConsoleBlocks events={[start, account, done]} />);
    expect(screen.getByText(/#a3f2/)).toBeTruthy();
    expect(screen.getByText(/kiro1/)).toBeTruthy();
    expect(screen.getByText(/200/)).toBeTruthy();
    expect(screen.getByText(/in 1\.2k/)).toBeTruthy();
  });

  it('renders an error block', () => {
    render(<ConsoleBlocks events={[err]} />);
    expect(screen.getByText(/rate limited/)).toBeTruthy();
    expect(screen.getByText(/429/)).toBeTruthy();
  });

  it('does not collapse identical consecutive blocks by default', () => {
    const s1: FlowEvent = { ...start, reqId: 'r1' };
    const d1: FlowEvent = { ...done, reqId: 'r1' };
    const s2: FlowEvent = { ...start, reqId: 'r2' };
    const d2: FlowEvent = { ...done, reqId: 'r2' };
    render(<ConsoleBlocks events={[s1, d1, s2, d2]} />);
    expect(screen.getByText(/#r1/)).toBeTruthy();
    expect(screen.getByText(/#r2/)).toBeTruthy();
    expect(screen.queryByText(/×2/)).toBeNull();
  });

  it('collapses identical consecutive blocks when collapse=true', () => {
    const s1: FlowEvent = { ...start, reqId: 'r1' };
    const d1: FlowEvent = { ...done, reqId: 'r1' };
    const s2: FlowEvent = { ...start, reqId: 'r2' };
    const d2: FlowEvent = { ...done, reqId: 'r2' };
    render(<ConsoleBlocks events={[s1, d1, s2, d2]} collapse />);
    expect(screen.getByText(/×2/)).toBeTruthy();
  });
});
