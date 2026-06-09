export interface CoalescerOptions<T> {
  intervalMs: number;
  highWater: number;
  flush: (items: T[]) => void;
}

export class Coalescer<T> {
  private buf: T[] = [];
  private timer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(private readonly opts: CoalescerOptions<T>) {}

  push(item: T): void {
    if (this.disposed) return;
    this.buf.push(item);
    if (this.buf.length > this.opts.highWater) {
      // Drop oldest to bound memory.
      this.buf.splice(0, this.buf.length - this.opts.highWater);
    }
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flushNow(), this.opts.intervalMs);
      if (this.timer.unref) this.timer.unref();
    }
  }

  private flushNow(): void {
    if (this.buf.length === 0) {
      this.timer = null;
      return;
    }
    const items = this.buf;
    this.buf = [];
    this.timer = null;
    try {
      this.opts.flush(items);
    } catch {
      // never let a flush error kill the coalescer
    }
  }

  /** Flush immediately and stop the timer. */
  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.disposed = true;
    this.flushNow();
  }
}
