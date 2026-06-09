export interface LruOptions<V> {
  /** Called when an entry is evicted (overflow or invalidate). */
  dispose?: (key: string, value: V) => void;
}

/**
 * Tiny string-keyed LRU. `get` promotes the entry to most-recent.
 * `set` evicts the least-recently-used entry if size > max.
 * O(1) for all ops. ~50 lines, no deps.
 */
export class Lru<V> {
  private map = new Map<string, V>();
  constructor(private readonly max: number, private readonly opts: LruOptions<V> = {}) {}

  get size(): number {
    return this.map.size;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    // Re-insert to promote to most-recent.
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) {
      const old = this.map.get(key)!;
      this.opts.dispose?.(key, old);
      this.map.delete(key);
    } else if (this.map.size >= this.max) {
      const oldestKey = this.map.keys().next().value as string | undefined;
      if (oldestKey !== undefined) {
        const oldestVal = this.map.get(oldestKey)!;
        this.map.delete(oldestKey);
        this.opts.dispose?.(oldestKey, oldestVal);
      }
    }
    this.map.set(key, value);
  }

  invalidate(key?: string): void {
    if (key === undefined) {
      for (const [k, v] of this.map) this.opts.dispose?.(k, v);
      this.map.clear();
      return;
    }
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.opts.dispose?.(key, v);
    }
  }
}
