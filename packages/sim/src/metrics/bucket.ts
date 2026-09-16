import { LogLinearHistogram } from './histogram.js';

export type QuantileQuality = 'EXACT' | 'ESTIMATED';

export interface Quantiles {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly p999: number;
  /** EXACT when computed from retained raw samples; ESTIMATED when from the histogram. */
  readonly quality: QuantileQuality;
}

/**
 * One second of WORLD_VIRTUAL time for one service.
 *
 * Carries BOTH representations, deliberately:
 *   - `latencySamplesUs` — raw values, retained in LOGICAL mode, giving EXACT quantiles.
 *   - `histogram`        — mergeable, bounded-error, affordable at any volume.
 *
 * Retention tiers (see plan): raw samples live in Postgres for 7 days, after which only the
 * histogram survives and reported quantiles degrade from EXACT to ESTIMATED. The degradation
 * is one-way and always labelled — a report never claims exactness it no longer has.
 */
export class SecondBucket {
  readonly serviceId: string;
  readonly virtualTimeUs: bigint;
  readonly wallTimeMs: number;

  requestsTotal = 0;
  requestsFailed = 0;
  queueDepth = 0;
  activeSlots = 0;

  private readonly samples: number[] = [];
  private readonly histogram = new LogLinearHistogram();
  private readonly retainSamples: boolean;

  constructor(serviceId: string, virtualTimeUs: bigint, wallTimeMs: number, retainSamples = true) {
    this.serviceId = serviceId;
    this.virtualTimeUs = virtualTimeUs;
    this.wallTimeMs = wallTimeMs;
    this.retainSamples = retainSamples;
  }

  record(latencyUs: number, failed: boolean): void {
    const v = latencyUs < 0 ? 0 : Math.trunc(latencyUs);
    this.requestsTotal++;
    if (failed) this.requestsFailed++;
    if (this.retainSamples) this.samples.push(v);
    this.histogram.add(v);
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  get latencySamplesUs(): readonly number[] {
    return this.samples;
  }

  get latencyHistogram(): number[] {
    return this.histogram.toJSON();
  }

  /**
   * Exact quantiles from retained samples when available, otherwise bounded-error
   * estimates from the histogram. The `quality` field says which — never guess.
   */
  quantiles(): Quantiles {
    if (this.retainSamples && this.samples.length > 0) {
      const sorted = [...this.samples].sort((a, b) => a - b);
      return {
        p50: exactQuantile(sorted, 0.5),
        p95: exactQuantile(sorted, 0.95),
        p99: exactQuantile(sorted, 0.99),
        p999: exactQuantile(sorted, 0.999),
        quality: 'EXACT',
      };
    }
    return {
      p50: this.histogram.quantile(0.5),
      p95: this.histogram.quantile(0.95),
      p99: this.histogram.quantile(0.99),
      p999: this.histogram.quantile(0.999),
      quality: 'ESTIMATED',
    };
  }
}

/**
 * Nearest-rank exact quantile. No interpolation: an interpolated quantile is a value that
 * was never observed, and every number this engine reports should be one that happened.
 */
export function exactQuantile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (p <= 0) return sortedAsc[0];
  if (p >= 1) return sortedAsc[sortedAsc.length - 1];
  const rank = Math.ceil(p * sortedAsc.length);
  const index = rank - 1;
  return sortedAsc[index < 0 ? 0 : index >= sortedAsc.length ? sortedAsc.length - 1 : index];
}
