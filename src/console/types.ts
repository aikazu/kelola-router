// src/console/types.ts
export type FlowReason = 'lowest-backoff' | 'round-robin' | 'sticky' | 'fallback';
export type TransportKind = 'proxy' | 'relay' | 'direct';

export type FlowEvent =
  | {
      phase: 'start';
      reqId: string;
      ts: string;
      method: string;
      path: string;
      model: string;
      alias: string | null;
    }
  | { phase: 'account'; reqId: string; ts: string; accountLabel: string; reason: FlowReason }
  | { phase: 'transport'; reqId: string; ts: string; kind: TransportKind; label: string }
  | { phase: 'transport-fail'; reqId: string; ts: string; fellBack: boolean; message: string }
  | {
      phase: 'done';
      reqId: string;
      ts: string;
      status: number;
      ttftMs: number | null;
      inTok: number;
      outTok: number;
      cacheTok: number;
      costUsd: number;
      latencyMs: number;
    }
  | { phase: 'error'; reqId: string; ts: string; status: number; message: string };
