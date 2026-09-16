import { EventHeap } from './event-heap.js';
import type { SimEvent, ClockDriverTarget } from './types.js';

export class VirtualClock implements ClockDriverTarget {
  readonly domain = 'WORLD_VIRTUAL' as const;

  private currentUs: bigint = 0n;
  private seqCounter: bigint = 0n;
  private readonly heap = new EventHeap();

  constructor(initialUs: bigint = 0n) {
    this.currentUs = initialUs;
  }

  nowUs(): bigint {
    return this.currentUs;
  }

  /**
   * Schedule a simulation event.
   * Auto-assigns monotonic `seq` to strictly guarantee tie-breaking order.
   */
  schedule(event: SimEvent): bigint {
    if (event.timeUs < this.currentUs) {
      throw new Error(
        `Cannot schedule event in the past (event.timeUs: ${event.timeUs} < current: ${this.currentUs})`,
      );
    }
    const seq = ++this.seqCounter;
    event.seq = seq;
    this.heap.push(event);
    return seq;
  }

  peekNextTimeUs(): bigint | null {
    const next = this.heap.peek();
    return next ? next.timeUs : null;
  }

  hasEvents(): boolean {
    return !this.heap.isEmpty();
  }

  get pendingEventCount(): number {
    return this.heap.size;
  }

  /**
   * Advance clock time to target timestamp, executing any events scheduled at or before targetUs.
   */
  advanceTo(targetUs: bigint): void {
    if (targetUs < this.currentUs) {
      throw new Error(`Cannot advance time backwards (${targetUs} < ${this.currentUs})`);
    }
    this.currentUs = targetUs;
  }

  /**
   * Execute the next earliest event in the heap.
   * Advances currentUs to event's timeUs.
   * Returns true if an event was executed, false if heap is empty.
   */
  step(): boolean {
    const event = this.heap.pop();
    if (!event) {
      return false;
    }

    if (event.timeUs > this.currentUs) {
      this.currentUs = event.timeUs;
    }

    event.execute(event);
    return true;
  }

  /**
   * Drains all events scheduled up to maxUs (or indefinitely until heap is empty).
   */
  drain(maxUs?: bigint): number {
    let executed = 0;
    while (!this.heap.isEmpty()) {
      const nextTime = this.heap.peek()!.timeUs;
      if (maxUs !== undefined && nextTime > maxUs) {
        this.currentUs = maxUs;
        break;
      }
      this.step();
      executed++;
    }
    if (maxUs !== undefined && this.currentUs < maxUs) {
      this.currentUs = maxUs;
    }
    return executed;
  }

  getSnapshot(): { currentUs: bigint; seqCounter: bigint; pendingEvents: number } {
    return {
      currentUs: this.currentUs,
      seqCounter: this.seqCounter,
      pendingEvents: this.heap.size,
    };
  }
}
