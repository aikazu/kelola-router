// src/console/format.ts
import type { FlowEvent } from './types.js';

const C = {
  reset: '\x1b[0m',
  gold: '\x1b[38;5;179m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape
const ANSI_RE = /\x1b\[[0-9;]*m/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtLatency(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function renderStdout(ev: FlowEvent): string {
  switch (ev.phase) {
    case 'start': {
      const model = ev.alias ? `${ev.alias}→${ev.model}` : ev.model;
      return `${C.gold}#${ev.reqId}${C.reset} → ${ev.method} ${ev.path} ${model}`;
    }
    case 'account':
      return `  ${C.dim}⤷${C.reset} account: ${ev.accountLabel} (${ev.reason})`;
    case 'transport':
      return `  ${C.dim}⤷${C.reset} ${ev.kind}: ${ev.label}`;
    case 'done': {
      const col = ev.status >= 400 ? C.red : C.green;
      const mark = ev.status >= 400 ? '✗' : '✓';
      return `  ${col}${mark}${C.reset} in ${fmtTokens(ev.inTok)} out ${fmtTokens(ev.outTok)} cache ${fmtTokens(ev.cacheTok)} $${ev.costUsd.toFixed(4)} ${fmtLatency(ev.latencyMs)} · ${ev.status}`;
    }
    case 'error':
      return `  ${C.red}✗${C.reset} ${ev.status} ${ev.message}`;
  }
}
