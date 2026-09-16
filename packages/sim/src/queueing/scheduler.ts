import type { VirtualClock } from '../clock/virtual-clock.js';
import { EventPriority } from '../clock/types.js';
import type { SeedableRng } from '../rng/rng.js';
import type { ICDFTable } from '../icdf/loader.js';
import { BoundedConcurrencyService, type SimRequest } from './service-model.js';
import { CascadeDetector } from './cascade.js';

export type RequestStatus = 'SUCCESS' | 'REJECTED' | 'TIMEOUT' | 'DEPENDENCY_FAILED';

export interface RequestOutcome {
  readonly requestId: string;
  readonly serviceId: string;
  readonly status: RequestStatus;
  /** Total residence: admission-to-settle, INCLUDING queue wait. Integer microseconds. */
  readonly latencyUs: bigint;
}

export interface EdgeSpec {
  readonly sourceId: string;
  readonly targetId: string;
  readonly timeoutMs: number;
}

export interface SchedulerServiceSpec {
  readonly id: string;
  readonly concurrencyLimit: number;
  readonly queueCapacity: number;
  readonly serviceTimeTable: ICDFTable;
}

export interface SchedulerOptions {
  readonly clock: VirtualClock;
  readonly rng: SeedableRng;
  readonly services: readonly SchedulerServiceSpec[];
  readonly edges: readonly EdgeSpec[];
  /** Guards against accidental cycles in a topology that slipped validation. */
  readonly maxDepth?: number;
  onOutcome?(outcome: RequestOutcome): void;
}

type Continuation = (status: RequestStatus) => void;

interface Settled {
  value: boolean;
}

/**
 * Dispatches requests across the service graph on the virtual clock.
 *
 * Determinism rules observed throughout:
 *  - Every scheduled event body is SYNCHRONOUS. No promises, so no microtask ordering.
 *  - Every timestamp is integer microseconds (bigint). No floats reach state.
 *  - All randomness comes from named RNG substreams, never from draw order.
 *
 * The timeout mechanism uses a settled-flag guard rather than heap cancellation: the
 * timeout event always fires, and no-ops if the call already settled. Cancelling heap
 * entries would make execution order depend on removal order, which is exactly the kind
 * of subtlety that breaks reproducibility months later.
 */
export class SimScheduler {
  readonly cascade = new CascadeDetector();

  private readonly clock: VirtualClock;
  private readonly rng: SeedableRng;
  private readonly services = new Map<string, BoundedConcurrencyService>();
  private readonly serviceTimeTables = new Map<string, ICDFTable>();
  private readonly edgesBySource = new Map<string, EdgeSpec[]>();
  private readonly maxDepth: number;
  private readonly onOutcome?: (outcome: RequestOutcome) => void;

  /** Continuations for requests parked in an admission queue. */
  private readonly parked = new Map<string, Continuation>();
  private requestCounter = 0n;

  constructor(options: SchedulerOptions) {
    this.clock = options.clock;
    this.rng = options.rng;
    this.maxDepth = options.maxDepth ?? 16;
    this.onOutcome = options.onOutcome;

    for (const spec of options.services) {
      const service = new BoundedConcurrencyService(
        spec.id,
        spec.concurrencyLimit,
        spec.queueCapacity,
      );
      this.services.set(spec.id, service);
      this.serviceTimeTables.set(spec.id, spec.serviceTimeTable);
      this.cascade.register(service);
    }

    // Sort edges by target so dependency invocation order is topology-order, not insertion-order.
    for (const edge of options.edges) {
      const list = this.edgesBySource.get(edge.sourceId) ?? [];
      list.push(edge);
      this.edgesBySource.set(edge.sourceId, list);
    }
    for (const list of this.edgesBySource.values()) {
      list.sort((a, b) => (a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0));
    }
  }

  getService(serviceId: string): BoundedConcurrencyService | undefined {
    return this.services.get(serviceId);
  }

  getServices(): readonly BoundedConcurrencyService[] {
    return Array.from(this.services.keys())
      .sort()
      .map((id) => this.services.get(id)!);
  }

  /** Entry point for externally generated load. */
  submit(serviceId: string, deadlineUs: bigint): void {
    this.invoke(serviceId, deadlineUs, 0, () => {
      /* terminal: outcome already reported via onOutcome */
    });
  }

  /** Sweep deadline-expired queued requests across every service. */
  sweepExpired(nowUs: bigint): void {
    for (const service of this.getServices()) {
      for (const expired of service.expireQueued(nowUs)) {
        const continuation = this.parked.get(expired.id);
        this.parked.delete(expired.id);
        this.report(expired, service.serviceId, 'TIMEOUT', nowUs);
        continuation?.('TIMEOUT');
      }
    }
  }

  private invoke(
    serviceId: string,
    deadlineUs: bigint,
    depth: number,
    onSettle: Continuation,
  ): void {
    const service = this.services.get(serviceId);
    if (!service || depth > this.maxDepth) {
      onSettle('DEPENDENCY_FAILED');
      return;
    }

    const nowUs = this.clock.nowUs();
    const request: SimRequest = {
      id: `r${++this.requestCounter}`,
      deadlineUs,
      enqueuedAtUs: nowUs,
      depth,
    };

    if (deadlineUs <= nowUs) {
      this.report(request, serviceId, 'TIMEOUT', nowUs);
      onSettle('TIMEOUT');
      return;
    }

    const admission = service.tryAdmit(request, nowUs);
    switch (admission.kind) {
      case 'ADMITTED':
        this.beginWork(service, request, onSettle);
        return;
      case 'QUEUED':
        // Parked until a slot frees. This is where latency actually accumulates.
        this.parked.set(request.id, onSettle);
        return;
      case 'REJECTED':
        this.report(request, serviceId, 'REJECTED', nowUs);
        onSettle('REJECTED');
        return;
    }
  }

  /** Local service time elapses, THEN dependencies are called — slot held throughout. */
  private beginWork(
    service: BoundedConcurrencyService,
    request: SimRequest,
    onSettle: Continuation,
  ): void {
    const table = this.serviceTimeTables.get(service.serviceId)!;
    const stream = this.rng.stream(`service:${service.serviceId}:service_time`);
    const serviceTimeUs = BigInt(table.sample(stream));

    this.clock.schedule({
      timeUs: this.clock.nowUs() + serviceTimeUs,
      priority: EventPriority.NORMAL,
      type: 'LOCAL_WORK_DONE',
      targetId: service.serviceId,
      execute: () => {
        this.callDependencies(service, request, 0, onSettle);
      },
    });
  }

  private callDependencies(
    service: BoundedConcurrencyService,
    request: SimRequest,
    index: number,
    onSettle: Continuation,
  ): void {
    const edges = this.edgesBySource.get(service.serviceId) ?? [];

    if (index >= edges.length) {
      this.finish(service, request, 'SUCCESS', onSettle);
      return;
    }

    const edge = edges[index];
    const nowUs = this.clock.nowUs();
    const edgeDeadlineUs = nowUs + BigInt(edge.timeoutMs) * 1000n;
    // A deadline narrows down the tree and never widens — the budget must shrink.
    const childDeadlineUs =
      edgeDeadlineUs < request.deadlineUs ? edgeDeadlineUs : request.deadlineUs;

    const settled: Settled = { value: false };

    this.clock.schedule({
      timeUs: childDeadlineUs,
      priority: EventPriority.HIGH, // TIMEOUT before SERVICE_COMPLETE: ties resolve pessimistically
      type: 'DEP_TIMEOUT',
      targetId: edge.targetId,
      execute: () => {
        if (settled.value) return;
        settled.value = true;
        this.finish(service, request, 'TIMEOUT', onSettle);
      },
    });

    this.invoke(edge.targetId, childDeadlineUs, request.depth + 1, (status) => {
      if (settled.value) return;
      settled.value = true;
      if (status === 'SUCCESS') {
        this.callDependencies(service, request, index + 1, onSettle);
      } else {
        this.finish(service, request, 'DEPENDENCY_FAILED', onSettle);
      }
    });
  }

  /** Release the slot — only now, after the whole span — and promote the next queued request. */
  private finish(
    service: BoundedConcurrencyService,
    request: SimRequest,
    status: RequestStatus,
    onSettle: Continuation,
  ): void {
    const nowUs = this.clock.nowUs();
    this.report(request, service.serviceId, status, nowUs);

    const release = service.release(request.id, nowUs);
    onSettle(status);

    if (release.kind === 'PROMOTED') {
      const promoted = release.request;
      const continuation = this.parked.get(promoted.id);
      this.parked.delete(promoted.id);
      this.beginWork(service, promoted, continuation ?? (() => {}));
    }
  }

  private report(
    request: SimRequest,
    serviceId: string,
    status: RequestStatus,
    nowUs: bigint,
  ): void {
    this.onOutcome?.({
      requestId: request.id,
      serviceId,
      status,
      latencyUs: nowUs - request.enqueuedAtUs,
    });
  }
}
