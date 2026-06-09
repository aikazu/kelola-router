// Append-only byte buffer that grows geometrically. Used to reassemble
// partially-received AWS event-stream frames across ReadableStream chunks.
export class ChunkAccumulator {
  private buf: Uint8Array;
  private len = 0;
  constructor(initialCap = 4096) {
    this.buf = new Uint8Array(initialCap);
  }

  push(chunk: Uint8Array): void {
    if (this.len + chunk.length > this.buf.length) {
      let cap = this.buf.length;
      while (cap < this.len + chunk.length) cap *= 2;
      const next = new Uint8Array(cap);
      next.set(this.buf.subarray(0, this.len));
      this.buf = next;
    }
    this.buf.set(chunk, this.len);
    this.len += chunk.length;
  }

  /** Bytes currently held (zero-copy view). */
  view(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }

  /** Discard the first `n` bytes (compacts by shifting the view). */
  consume(n: number): void {
    if (n <= 0) return;
    if (n >= this.len) {
      this.len = 0;
      return;
    }
    // Copy the tail to the front. Amortized O(view size); callers should
    // consume small amounts per call.
    this.buf.copyWithin(0, n, this.len);
    this.len -= n;
  }

  reset(): void {
    this.len = 0;
  }
}
