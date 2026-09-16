/**
 * BulkheadCore: Bounded Admission Controller
 *
 * Partitions service capacity with strict concurrency limits and a bounded wait queue.
 * Rejects saturated traffic immediately to isolate upstream callers from cascading collapse.
 *
 * ZERO dependencies, ZERO Date.now(), ZERO timers.
 */

import type { BulkheadConfig, BulkheadAdmissionResult } from './types.js';

interface QueuedItem {
  readonly id: number;
  readonly queuedAtMicros: bigint;
}

export class BulkheadCore {
  private readonly config: BulkheadConfig;
  private _activeCount = 0;
  private nextItemId = 1;
  private readonly queue: QueuedItem[] = [];

  constructor(config: BulkheadConfig) {
    this.config = config;
  }

  public get activeCount(): number {
    return this._activeCount;
  }

  public get queuedCount(): number {
    return this.queue.length;
  }

  public get isFull(): boolean {
    return (
      this._activeCount >= this.config.maxConcurrent &&
      this.queue.length >= this.config.maxQueueCapacity
    );
  }

  /**
   * Attempt to acquire an execution slot or queue position.
   */
  public tryAcquire(nowMicros: bigint): BulkheadAdmissionResult {
    this.pruneExpiredQueue(nowMicros);

    // Slot available immediately
    if (this._activeCount < this.config.maxConcurrent) {
      this._activeCount++;
      const slotId = this.nextItemId++;
      return { allowed: true, queued: false, slotId };
    }

    // Queue slot available
    if (this.queue.length < this.config.maxQueueCapacity) {
      const id = this.nextItemId++;
      this.queue.push({ id, queuedAtMicros: nowMicros });
      return { allowed: true, queued: true, queuePosition: this.queue.length };
    }

    // Completely saturated -> shed immediately
    return { allowed: false, reason: 'BULKHEAD_FULL' };
  }

  /**
   * Release an active execution slot. If any queued callers exist, promotes the next valid caller.
   *
   * @returns true if a queued item was promoted to active, false if slot was simply freed.
   */
  public release(_slotId: number, nowMicros: bigint): boolean {
    this.pruneExpiredQueue(nowMicros);

    if (this.queue.length > 0) {
      // Promote the first queued item directly into the active slot
      this.queue.shift();
      return true;
    }

    if (this._activeCount > 0) {
      this._activeCount--;
    }
    return false;
  }

  private pruneExpiredQueue(nowMicros: bigint): void {
    if (this.config.queueTimeoutMicros <= 0n) return;

    while (this.queue.length > 0) {
      const item = this.queue[0];
      const elapsed = nowMicros - item.queuedAtMicros;
      if (elapsed >= this.config.queueTimeoutMicros) {
        this.queue.shift();
      } else {
        break;
      }
    }
  }
}
