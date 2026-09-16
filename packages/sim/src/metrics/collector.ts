import { SecondBucket, type Quantiles } from './bucket.js';

const ONE_SECOND_US = 1_000_000n;

export interface MetricSampleRow {
  readonly serviceId: string;
  readonly virtualTimeUs: bigint;
  readonly wallTimeMs: number;
  readonly requestsTotal: number;
  readonly requestsFailed: number;
  readonly queueDepth: number;
  readonly activeSlots: number;
  readonly latencySamplesUs: readonly number[];
  readonly latencyHistogram: readonly number[];
  readonly quantiles: Quantiles;
}

export interface CollectorOptions {
  /** LOGICAL mode retains raw samples for exact quantiles. Set false for high-volume modes. */
  readonly retainSamples?: boolean;
  /**
   * Wall clock, injected. Defaults to a constant so the collector introduces NO wall-clock
   * dependency into a deterministic run — wall time is recorded for ordering only and is
   * never hashed. A test can inject a counter and stay fully deterministic.
   */
  readonly wallClockMs?: () => number;
}

/**
 * Accumulates per-service, per-second metric buckets on WORLD_VIRTUAL time.
 *
 * Buckets are keyed by the virtual second, so bucket boundaries are identical whether the
 * run executed under FastDriver in 3 seconds or RealtimeDriver in 10 minutes. That property
 * is what lets the two drivers be compared at all.
 */
export class MetricsCollector {
  private readonly buckets = new Map<string, SecondBucket>();
  private readonly completed: SecondBucket[] = [];
  private readonly retainSamples: boolean;
  private readonly wallClockMs: () => number;

  constructor(options: CollectorOptions = {}) {
    this.retainSamples = options.retainSamples ?? true;
    this.wallClockMs = options.wallClockMs ?? (() => 0);
  }

  private static key(serviceId: string, secondIndex: bigint): string {
    return `${serviceId}@${secondIndex}`;
  }

  private bucketFor(serviceId: string, nowUs: bigint): SecondBucket {
    const secondIndex = nowUs / ONE_SECOND_US;
    const key = MetricsCollector.key(serviceId, secondIndex);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new SecondBucket(
        serviceId,
        secondIndex * ONE_SECOND_US,
        this.wallClockMs(),
        this.retainSamples
      );
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  recordOutcome(
    serviceId: string,
    nowUs: bigint,
    latencyUs: bigint,
    failed: boolean
  ): void {
    this.bucketFor(serviceId, nowUs).record(Number(latencyUs), failed);
  }

  /** Sampled at flush time, not per request — these are gauges, not counters. */
  recordGauges(
    serviceId: string,
    nowUs: bigint,
    queueDepth: number,
    activeSlots: number
  ): void {
    const bucket = this.bucketFor(serviceId, nowUs);
    bucket.queueDepth = queueDepth;
    bucket.activeSlots = activeSlots;
  }

  /** Close every bucket strictly older than the current virtual second. */
  flushCompleted(nowUs: bigint): MetricSampleRow[] {
    const currentSecond = nowUs / ONE_SECOND_US;
    const flushed: MetricSampleRow[] = [];

    for (const [key, bucket] of Array.from(this.buckets.entries()).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    )) {
      if (bucket.virtualTimeUs / ONE_SECOND_US < currentSecond) {
        this.buckets.delete(key);
        this.completed.push(bucket);
        flushed.push(toRow(bucket));
      }
    }
    return flushed;
  }

  /** Close everything, including the in-progress second. Called at run end. */
  flushAll(): MetricSampleRow[] {
    const rows: MetricSampleRow[] = [];
    for (const [key, bucket] of Array.from(this.buckets.entries()).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    )) {
      this.buckets.delete(key);
      this.completed.push(bucket);
      rows.push(toRow(bucket));
    }
    return rows;
  }

  /** Every bucket closed so far, ordered by (serviceId, virtualTime). */
  allCompleted(): MetricSampleRow[] {
    return [...this.completed]
      .sort((a, b) =>
        a.serviceId === b.serviceId
          ? Number(a.virtualTimeUs - b.virtualTimeUs)
          : a.serviceId < b.serviceId
            ? -1
            : 1
      )
      .map(toRow);
  }

  /** Aggregate across the whole run for one service — merges histograms, concatenates samples. */
  aggregateFor(serviceId: string): MetricSampleRow | undefined {
    const rows = this.completed.filter((b) => b.serviceId === serviceId);
    if (rows.length === 0) return undefined;

    const merged = new SecondBucket(serviceId, 0n, 0, this.retainSamples);
    for (const bucket of rows) {
      const failedRemaining = bucket.requestsFailed;
      let failedEmitted = 0;
      for (const sample of bucket.latencySamplesUs) {
        const isFailed = failedEmitted < failedRemaining;
        merged.record(sample, isFailed);
        if (isFailed) failedEmitted++;
      }
      if (bucket.latencySamplesUs.length === 0) {
        merged.requestsTotal += bucket.requestsTotal;
        merged.requestsFailed += bucket.requestsFailed;
      }
    }
    return toRow(merged);
  }
}

function toRow(bucket: SecondBucket): MetricSampleRow {
  return {
    serviceId: bucket.serviceId,
    virtualTimeUs: bucket.virtualTimeUs,
    wallTimeMs: bucket.wallTimeMs,
    requestsTotal: bucket.requestsTotal,
    requestsFailed: bucket.requestsFailed,
    queueDepth: bucket.queueDepth,
    activeSlots: bucket.activeSlots,
    latencySamplesUs: bucket.latencySamplesUs,
    latencyHistogram: bucket.latencyHistogram,
    quantiles: bucket.quantiles(),
  };
}
