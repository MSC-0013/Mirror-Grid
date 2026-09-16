import { BoundedQueue } from './queue.js';

/**
 * A request occupying, or waiting for, a concurrency slot.
 *
 * All timestamps are integer microseconds in WORLD_VIRTUAL. No floats, ever —
 * a float here would reach the canonical state hash.
 */
export interface SimRequest {
  readonly id: string;
  /** Absolute virtual deadline. Propagated down the call tree; never reset per hop. */
  readonly deadlineUs: bigint;
  readonly enqueuedAtUs: bigint;
  readonly depth: number;
  /** Set when the request is admitted to a slot. */
  admittedAtUs?: bigint;
}

export type AdmissionOutcome =
  | { kind: 'ADMITTED'; request: SimRequest }
  | { kind: 'QUEUED'; request: SimRequest; queueDepth: number }
  | { kind: 'REJECTED'; request: SimRequest; reason: 'QUEUE_FULL' };

export type ReleaseOutcome =
  | { kind: 'IDLE' }
  | { kind: 'PROMOTED'; request: SimRequest; queueWaitUs: bigint };

export interface ServiceModelSnapshot {
  readonly serviceId: string;
  readonly concurrencyLimit: number;
  readonly queueCapacity: number;
  readonly activeSlots: number;
  readonly queueDepth: number;
  /** FIFO order matters for the hash — two queues with the same depth are not the same state. */
  readonly queuedRequestIds: readonly string[];
  readonly admittedTotal: number;
  readonly completedTotal: number;
  readonly rejectedTotal: number;
  readonly expiredInQueueTotal: number;
  /** Slot-microseconds accumulated. The numerator of utilization; exact integer. */
  readonly busyUsAccumulated: bigint;
  /**
   * Exact time-integral of (activeSlots + queueDepth), in count-microseconds.
   *
   * This is L in Little's Law, integrated rather than sampled. A 1 Hz gauge estimate of
   * the same quantity carries ~10% sampling error, which would force a meaninglessly loose
   * tolerance on the steady-state check; integrating at every state change makes the
   * assertion tight enough to actually catch broken queue accounting.
   */
  readonly occupancyIntegralUs: bigint;
  /** Virtual time at which the integral was last accrued. */
  readonly lastChangeUs: bigint;
}

/**
 * Bounded-concurrency service with a bounded FIFO admission queue.
 *
 * THE LOAD-BEARING RULE
 * ---------------------
 * A concurrency slot is held for the ENTIRE request span — including time spent waiting
 * on downstream dependencies, retries and backoff. It is NOT released when local work
 * finishes.
 *
 * Capacity is therefore arithmetic, not configuration:
 *
 *     capacity = concurrencyLimit / occupancy
 *
 *     64 slots /  20ms occupancy = 3200 req/s   (healthy)
 *     64 slots / 900ms occupancy =   71 req/s   (dependency degraded)
 *
 * Nothing was reconfigured; capacity fell 45x because slots are held longer. That is the
 * whole cascade mechanism, and it is why no code in this package mentions "cascade".
 */
export class BoundedConcurrencyService {
  readonly serviceId: string;
  readonly concurrencyLimit: number;

  private readonly queue: BoundedQueue<SimRequest>;
  private readonly active = new Map<string, SimRequest>();

  private admittedTotal = 0;
  private completedTotal = 0;
  private rejectedTotal = 0;
  private expiredInQueueTotal = 0;
  private busyUsAccumulated = 0n;
  private occupancyIntegralUs = 0n;
  private lastChangeUs = 0n;

  constructor(serviceId: string, concurrencyLimit: number, queueCapacity: number) {
    if (concurrencyLimit < 1) {
      throw new Error(`concurrencyLimit must be >= 1 for service ${serviceId}`);
    }
    this.serviceId = serviceId;
    this.concurrencyLimit = concurrencyLimit;
    this.queue = new BoundedQueue<SimRequest>(queueCapacity);
  }

  get activeSlots(): number {
    return this.active.size;
  }

  get queueDepth(): number {
    return this.queue.depth;
  }

  get queueCapacity(): number {
    return this.queue.capacity;
  }

  /** activeSlots / concurrencyLimit, in parts-per-billion. Integer — safe for hashing. */
  get saturationPpb(): number {
    return Math.floor((this.active.size * 1_000_000_000) / this.concurrencyLimit);
  }

  /**
   * Offer a request. Admits to a free slot, else queues, else rejects (shed).
   * Rejection is the modelled 503 — the system refusing work it cannot hold.
   */
  /**
   * Accrue the occupancy integral up to `nowUs` at the CURRENT level, then move the marker.
   * Must be called before any change to activeSlots or queueDepth, so each interval is
   * credited at the level that actually held during it.
   */
  private accrue(nowUs: bigint): void {
    if (nowUs > this.lastChangeUs) {
      const level = BigInt(this.active.size + this.queue.depth);
      this.occupancyIntegralUs += level * (nowUs - this.lastChangeUs);
      this.lastChangeUs = nowUs;
    }
  }

  /** Bring the integral up to date without changing state — for end-of-run accounting. */
  settleOccupancy(nowUs: bigint): void {
    this.accrue(nowUs);
  }

  tryAdmit(request: SimRequest, nowUs: bigint): AdmissionOutcome {
    this.accrue(nowUs);
    if (this.active.size < this.concurrencyLimit) {
      this.occupySlot(request, nowUs);
      return { kind: 'ADMITTED', request };
    }
    if (this.queue.enqueue(request)) {
      return { kind: 'QUEUED', request, queueDepth: this.queue.depth };
    }
    this.rejectedTotal++;
    return { kind: 'REJECTED', request, reason: 'QUEUE_FULL' };
  }

  /**
   * Release a held slot and promote the next queued request, if any.
   * `nowUs` is when the ENTIRE span finished, not when local work finished.
   */
  release(requestId: string, nowUs: bigint): ReleaseOutcome {
    this.accrue(nowUs);
    const request = this.active.get(requestId);
    if (request) {
      this.active.delete(requestId);
      this.completedTotal++;
      if (request.admittedAtUs !== undefined) {
        this.busyUsAccumulated += nowUs - request.admittedAtUs;
      }
    }

    const next = this.queue.dequeue();
    if (!next) {
      return { kind: 'IDLE' };
    }
    const queueWaitUs = nowUs - next.enqueuedAtUs;
    this.occupySlot(next, nowUs);
    return { kind: 'PROMOTED', request: next, queueWaitUs };
  }

  /**
   * Drop queued requests whose absolute deadline has passed.
   * These never got a slot — in a saturated system they are the bulk of timeouts.
   */
  expireQueued(nowUs: bigint): SimRequest[] {
    this.accrue(nowUs);
    const expired = this.queue.removeWhere((r) => r.deadlineUs <= nowUs);
    this.expiredInQueueTotal += expired.length;
    return expired;
  }

  isActive(requestId: string): boolean {
    return this.active.has(requestId);
  }

  getSnapshot(): ServiceModelSnapshot {
    return {
      serviceId: this.serviceId,
      concurrencyLimit: this.concurrencyLimit,
      queueCapacity: this.queue.capacity,
      activeSlots: this.active.size,
      queueDepth: this.queue.depth,
      queuedRequestIds: this.queue.toArray().map((r) => r.id),
      admittedTotal: this.admittedTotal,
      completedTotal: this.completedTotal,
      rejectedTotal: this.rejectedTotal,
      expiredInQueueTotal: this.expiredInQueueTotal,
      busyUsAccumulated: this.busyUsAccumulated,
      occupancyIntegralUs: this.occupancyIntegralUs,
      lastChangeUs: this.lastChangeUs,
    };
  }

  private occupySlot(request: SimRequest, nowUs: bigint): void {
    request.admittedAtUs = nowUs;
    this.active.set(request.id, request);
    this.admittedTotal++;
  }
}
