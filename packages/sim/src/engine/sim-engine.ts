import { VirtualClock } from '../clock/virtual-clock.js';
import { EventPriority, type ClockDriver } from '../clock/types.js';
import { FastDriver } from '../clock/fast-driver.js';
import { SeedableRng } from '../rng/rng.js';
import { ICDFRegistry } from '../icdf/registry.js';
import { ICDF_MANIFEST } from '../icdf/manifest.js';
import type { ICDFTable } from '../icdf/loader.js';
import { SimScheduler, type EdgeSpec, type RequestOutcome } from '../queueing/scheduler.js';
import type { ServiceModelSnapshot } from '../queueing/service-model.js';
import { MetricsCollector, type MetricSampleRow } from '../metrics/collector.js';
import { WorkloadGenerator, type WorkloadSpec } from '../workload/generator.js';
import { ArrivalScheduler } from '../workload/arrival.js';
import { computeStateHash, type StateHashResult } from './state-hash.js';
import { HASH_SCHEMA_VERSION, type WorldStateSnapshot } from './world-state.js';

export const ENGINE_VERSION = '0.1.0';

const ONE_SECOND_US = 1_000_000n;

export interface EngineServiceSpec {
  readonly id: string;
  readonly name: string;
  readonly concurrencyLimit: number;
  readonly queueCapacity: number;
  /** Key into the ICDF registry. Defaults to `default_service` (20ms exponential). */
  readonly serviceTimeTable?: string;
}

export interface EngineWorldSpec {
  readonly worldId: string;
  readonly services: readonly EngineServiceSpec[];
  readonly edges: readonly EdgeSpec[];
  /** Where generated load enters the graph. */
  readonly entryServiceId: string;
  /** Client-side budget per request, in milliseconds. */
  readonly requestTimeoutMs?: number;
}

export interface EngineRunOptions {
  readonly seed: bigint;
  readonly workload: WorkloadSpec;
  readonly driver?: ClockDriver;
  /** LOGICAL keeps raw samples for exact quantiles. */
  readonly retainSamples?: boolean;
  onMetrics?(rows: readonly MetricSampleRow[]): void;
}

export interface EngineRunResult {
  readonly worldId: string;
  readonly seed: bigint;
  readonly engineVersion: string;
  readonly virtualDurationUs: bigint;
  readonly stateHash: StateHashResult;
  readonly metrics: readonly MetricSampleRow[];
  /** Per-service end-of-run snapshots, including the exact occupancy integral. */
  readonly services: readonly ServiceModelSnapshot[];
  readonly totals: {
    readonly submitted: number;
    readonly succeeded: number;
    readonly failed: number;
    readonly rejected: number;
    readonly timedOut: number;
  };
}

/**
 * The deterministic discrete-event simulation engine.
 *
 * Determinism invariants held here:
 *  - Every scheduled event body is synchronous. `step()` never awaits, so there is no
 *    microtask ordering to depend on.
 *  - Wall clock appears nowhere in this file. The realtime driver paces advancement; it
 *    does not supply time. `VirtualClock` is the sole authority.
 *  - All randomness comes from named substreams, so adding a new random consumer cannot
 *    perturb existing streams.
 */
export class SimEngine {
  readonly worldId: string;

  private readonly spec: EngineWorldSpec;
  private readonly registry = new ICDFRegistry();

  private clock!: VirtualClock;
  private rng!: SeedableRng;
  private scheduler!: SimScheduler;
  private collector!: MetricsCollector;
  private generator!: WorkloadGenerator;
  private arrivals!: ArrivalScheduler;

  private seed = 0n;
  private submitted = 0;
  private succeeded = 0;
  private failed = 0;
  private rejected = 0;
  private timedOut = 0;
  private stopped = false;

  constructor(spec: EngineWorldSpec) {
    this.spec = spec;
    this.worldId = spec.worldId;

    // Fail at construction, not mid-run, if the generated distribution tables differ from
    // the checked-in manifest. Table generation uses Math.log/exp/sqrt, which are not
    // correctly rounded under IEEE-754 — a different engine build can shift a boundary
    // microsecond and silently change every hash this run produces.
    const verification = this.registry.verifyAgainstManifest(ICDF_MANIFEST);
    if (!verification.ok) {
      throw new Error(
        'ICDF table drift detected — determinism cannot be guaranteed on this platform.\n' +
          verification.mismatches.map((m) => `  - ${m}`).join('\n') +
          '\nIf the change is intended, run: npx tsx packages/sim/tools/gen-icdf-manifest.ts ' +
          'and bump ENGINE_VERSION.',
      );
    }
  }

  private tableFor(spec: EngineServiceSpec): ICDFTable {
    return this.registry.get(spec.serviceTimeTable ?? 'default_service');
  }

  private reset(options: EngineRunOptions): void {
    this.seed = options.seed;
    this.clock = new VirtualClock(0n);
    this.rng = new SeedableRng(options.seed);
    this.collector = new MetricsCollector({ retainSamples: options.retainSamples ?? true });
    this.submitted = 0;
    this.succeeded = 0;
    this.failed = 0;
    this.rejected = 0;
    this.timedOut = 0;
    this.stopped = false;

    this.scheduler = new SimScheduler({
      clock: this.clock,
      rng: this.rng,
      services: this.spec.services.map((s) => ({
        id: s.id,
        concurrencyLimit: s.concurrencyLimit,
        queueCapacity: s.queueCapacity,
        serviceTimeTable: this.tableFor(s),
      })),
      edges: this.spec.edges,
      onOutcome: (outcome) => this.onOutcome(outcome),
    });

    this.generator = new WorkloadGenerator(
      options.workload,
      options.workload.pattern === 'RANDOM' ? this.rng.stream('workload:rate') : undefined,
    );
    this.arrivals = new ArrivalScheduler(
      this.registry.get('interarrival_1s'),
      this.rng.stream('workload:arrival'),
    );
  }

  private onOutcome(outcome: RequestOutcome): void {
    // Only entry-service outcomes count as user-visible requests; downstream hops are
    // internal work and would double-count the same user request.
    const isEntry = outcome.serviceId === this.spec.entryServiceId;
    if (isEntry) {
      switch (outcome.status) {
        case 'SUCCESS':
          this.succeeded++;
          break;
        case 'REJECTED':
          this.rejected++;
          break;
        case 'TIMEOUT':
          this.timedOut++;
          break;
        case 'DEPENDENCY_FAILED':
          this.failed++;
          break;
      }
    }
    this.collector.recordOutcome(
      outcome.serviceId,
      this.clock.nowUs(),
      outcome.latencyUs,
      outcome.status !== 'SUCCESS',
    );
  }

  private scheduleNextArrival(elapsedUs: bigint, timeoutUs: bigint): void {
    if (this.stopped || this.generator.isComplete(elapsedUs)) {
      return;
    }
    const rate = this.generator.rateAt(elapsedUs);
    if (rate <= 0) {
      // Re-check at the next whole second rather than spinning.
      const nextUs = this.clock.nowUs() + ONE_SECOND_US;
      this.clock.schedule({
        timeUs: nextUs,
        priority: EventPriority.LOW,
        type: 'ARRIVAL_PROBE',
        execute: () => this.scheduleNextArrival(nextUs, timeoutUs),
      });
      return;
    }

    const gapUs = this.arrivals.nextGapUs(rate);
    const arriveAtUs = this.clock.nowUs() + (gapUs > 0n ? gapUs : 1n);

    this.clock.schedule({
      timeUs: arriveAtUs,
      priority: EventPriority.NORMAL,
      type: 'ARRIVAL',
      targetId: this.spec.entryServiceId,
      execute: () => {
        this.submitted++;
        this.scheduler.submit(this.spec.entryServiceId, arriveAtUs + timeoutUs);
        this.scheduleNextArrival(arriveAtUs, timeoutUs);
      },
    });
  }

  /** Per-virtual-second: sample gauges, expire deadline-blown queue entries, flush buckets. */
  private scheduleTick(options: EngineRunOptions): void {
    const tickAtUs = this.clock.nowUs() + ONE_SECOND_US;
    this.clock.schedule({
      timeUs: tickAtUs,
      priority: EventPriority.BACKGROUND,
      type: 'TICK',
      execute: () => {
        const nowUs = this.clock.nowUs();
        this.scheduler.sweepExpired(nowUs);

        for (const service of this.scheduler.getServices()) {
          this.collector.recordGauges(
            service.serviceId,
            nowUs,
            service.queueDepth,
            service.activeSlots,
          );
        }

        const flushed = this.collector.flushCompleted(nowUs);
        if (flushed.length > 0) {
          options.onMetrics?.(flushed);
        }

        if (!this.stopped && nowUs < this.generator.durationUs) {
          this.scheduleTick(options);
        }
      },
    });
  }

  async run(options: EngineRunOptions): Promise<EngineRunResult> {
    this.reset(options);

    const timeoutUs = BigInt(this.spec.requestTimeoutMs ?? 3000) * 1000n;
    this.scheduleNextArrival(0n, timeoutUs);
    this.scheduleTick(options);

    const driver = options.driver ?? new FastDriver();
    await driver.start(this.clock);

    // Drain anything still in flight after the workload window closes, so queues empty
    // and the final state reflects a settled system rather than a torn one.
    this.clock.drain();

    // Bring every occupancy integral up to the final clock value, so L is exact over the
    // whole run rather than only up to each service's last state change.
    const endUs = this.clock.nowUs();
    for (const service of this.scheduler.getServices()) {
      service.settleOccupancy(endUs);
    }

    const remaining = this.collector.flushAll();
    if (remaining.length > 0) {
      options.onMetrics?.(remaining);
    }

    return {
      worldId: this.worldId,
      seed: this.seed,
      engineVersion: ENGINE_VERSION,
      virtualDurationUs: this.clock.nowUs(),
      stateHash: this.getStateHash(),
      metrics: this.collector.allCompleted(),
      services: this.scheduler.getServices().map((svc) => svc.getSnapshot()),
      totals: {
        submitted: this.submitted,
        succeeded: this.succeeded,
        failed: this.failed,
        rejected: this.rejected,
        timedOut: this.timedOut,
      },
    };
  }

  stop(): void {
    this.stopped = true;
  }

  snapshotState(): WorldStateSnapshot {
    return {
      engineVersion: ENGINE_VERSION,
      hashSchemaVersion: HASH_SCHEMA_VERSION,
      clockUs: this.clock.nowUs(),
      eventSeqCounter: this.clock.getSnapshot().seqCounter,
      services: this.scheduler.getServices().map((s) => s.getSnapshot()),
      rngStreams: this.rng.getSnapshot(),
    };
  }

  getStateHash(): StateHashResult {
    return computeStateHash(this.snapshotState());
  }

  getMetrics(): MetricSampleRow[] {
    return this.collector.allCompleted();
  }

  getCascadePressure() {
    return this.scheduler.cascade.snapshot();
  }
}
