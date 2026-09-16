/**
 * Bounded FIFO queue.
 *
 * Deterministic by construction: no time, no randomness, no iteration-order dependence.
 * Backed by a ring buffer so enqueue/dequeue are O(1) and the 18,000-deep queues the
 * saturation scenarios produce do not degrade into O(n) array shifts.
 */
export class BoundedQueue<T> {
  readonly capacity: number;

  private readonly items: Array<T | undefined>;
  private head = 0;
  private tail = 0;
  private count = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 0) {
      throw new Error(`BoundedQueue capacity must be a non-negative integer, got ${capacity}`);
    }
    this.capacity = capacity;
    this.items = new Array<T | undefined>(capacity);
  }

  get depth(): number {
    return this.count;
  }

  get isFull(): boolean {
    return this.count >= this.capacity;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  /** Returns false when the queue is full; the caller is then responsible for shedding. */
  enqueue(item: T): boolean {
    if (this.isFull) {
      return false;
    }
    this.items[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
    this.count++;
    return true;
  }

  dequeue(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }
    const item = this.items[this.head];
    this.items[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.count--;
    return item as T;
  }

  peek(): T | undefined {
    return this.count === 0 ? undefined : (this.items[this.head] as T);
  }

  /**
   * Remove entries matching a predicate, oldest first.
   * Used for deadline expiry of queued requests — queue-wait timeouts are the majority
   * of timeouts in a saturated system, so they must be expressible.
   */
  removeWhere(predicate: (item: T) => boolean): T[] {
    if (this.count === 0) {
      return [];
    }
    const removed: T[] = [];
    const retained: T[] = [];
    const total = this.count;

    for (let i = 0; i < total; i++) {
      const item = this.dequeue() as T;
      if (predicate(item)) {
        removed.push(item);
      } else {
        retained.push(item);
      }
    }
    for (const item of retained) {
      this.enqueue(item);
    }
    return removed;
  }

  /** Snapshot in FIFO order. Used for canonical hashing — order is part of the state. */
  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.count; i++) {
      out.push(this.items[(this.head + i) % this.capacity] as T);
    }
    return out;
  }

  clear(): void {
    this.items.fill(undefined);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }
}
