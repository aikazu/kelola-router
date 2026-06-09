// src/console/bus.ts
import type { FlowEvent } from './types.js';

type Subscriber = (ev: FlowEvent) => void;

export class ConsoleBus {
  private buffer: FlowEvent[] = [];
  private subs = new Set<Subscriber>();
  constructor(private readonly cap = 200) {}

  emit(ev: FlowEvent): void {
    this.buffer.push(ev);
    if (this.buffer.length > this.cap) this.buffer.shift();
    for (const fn of this.subs) {
      try {
        fn(ev);
      } catch {
        // a broken subscriber must not break emission for the rest
      }
    }
  }

  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }

  recent(): FlowEvent[] {
    return [...this.buffer];
  }
}

export const consoleBus = new ConsoleBus();
