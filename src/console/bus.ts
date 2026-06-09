// src/console/bus.ts
import type { FlowEvent } from './types.js';

type Subscriber = (ev: FlowEvent) => void;

export class ConsoleBus {
  private buf: (FlowEvent | undefined)[];
  private head = 0; // next write index
  private size = 0; // number of valid entries (<= cap)
  private subs = new Set<Subscriber>();
  constructor(private readonly cap = 200) {
    this.buf = new Array(cap);
  }

  emit(ev: FlowEvent): void {
    this.buf[this.head] = ev;
    this.head = (this.head + 1) % this.cap;
    if (this.size < this.cap) this.size++;
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
    const out: FlowEvent[] = [];
    // Start from the oldest valid entry; if buf isn't full yet, that's
    // (head - size) modulo cap.
    const start = this.size < this.cap ? (this.head - this.size + this.cap) % this.cap : this.head;
    for (let i = 0; i < this.size; i++) {
      const ev = this.buf[(start + i) % this.cap];
      if (ev !== undefined) out.push(ev);
    }
    return out;
  }
}

export const consoleBus = new ConsoleBus();
