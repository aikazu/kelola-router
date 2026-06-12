// src/console/flow.ts
import { randomBytes } from 'node:crypto';
import type { FlowEvent, FlowReason, TransportKind } from './types.js';

export function genReqId(): string {
  return randomBytes(2).toString('hex');
}

export function buildStart(
  reqId: string,
  ts: string,
  method: string,
  path: string,
  model: string,
  alias: string | null
): FlowEvent {
  return { phase: 'start', reqId, ts, method, path, model, alias };
}

export function buildAccount(
  reqId: string,
  ts: string,
  accountLabel: string,
  reason: FlowReason
): FlowEvent {
  return { phase: 'account', reqId, ts, accountLabel, reason };
}

export function buildTransport(
  reqId: string,
  ts: string,
  kind: TransportKind,
  label: string
): FlowEvent {
  return { phase: 'transport', reqId, ts, kind, label };
}

export function buildDone(
  reqId: string,
  ts: string,
  status: number,
  ttftMs: number | null,
  inTok: number,
  outTok: number,
  cacheTok: number,
  costUsd: number,
  latencyMs: number
): FlowEvent {
  return { phase: 'done', reqId, ts, status, ttftMs, inTok, outTok, cacheTok, costUsd, latencyMs };
}

export function buildTransportFail(
  reqId: string,
  ts: string,
  fellBack: boolean,
  message: string
): FlowEvent {
  return { phase: 'transport-fail', reqId, ts, fellBack, message: message.slice(0, 200) };
}

export function buildError(reqId: string, ts: string, status: number, message: string): FlowEvent {
  return { phase: 'error', reqId, ts, status, message: message.slice(0, 200) };
}
