import type { SubStream } from '../rng/substream.js';

export type WorkloadPatternKind =
  | 'CONSTANT'
  | 'RAMP_UP'
  | 'RAMP_DOWN'
  | 'BURST'
  | 'SPIKE'
  | 'RANDOM';

export interface WorkloadSpec {
  readonly pattern: WorkloadPatternKind;
  /** Steady rate for CONSTANT; start rate for ramps; baseline for BURST/SPIKE/RANDOM. */
  readonly baseRatePerSecond: number;
  /** End rate for ramps; peak for BURST/SPIKE; upper bound for RANDOM. */
  readonly peakRatePerSecond?: number;
  readonly durationUs: bigint;
  /** BURST: period between bursts. SPIKE: time at which the spike occurs. */
  readonly intervalUs?: bigint;
  /** BURST/SPIKE: how long elevated load lasts. */
  readonly pulseWidthUs?: bigint;
}

/**
 * Computes the instantaneous offered rate at a virtual timestamp.
 *
 * Every pattern is a pure function of (spec, elapsedUs) — plus, for RANDOM only, a seeded
 * substream. No wall clock, no accumulated drift: the rate at t is the same value whether
 * it is asked for once or a thousand times, which is what allows a run to be replayed
 * from a snapshot at an arbitrary point.
 */
export class WorkloadGenerator {
  readonly spec: WorkloadSpec;
  private readonly stream: SubStream | undefined;

  constructor(spec: WorkloadSpec, stream?: SubStream) {
    this.spec = spec;
    this.stream = stream;
    if (spec.pattern === 'RANDOM' && !stream) {
      throw new Error('WorkloadGenerator: RANDOM pattern requires a seeded substream');
    }
  }

  get durationUs(): bigint {
    return this.spec.durationUs;
  }

  isComplete(elapsedUs: bigint): boolean {
    return elapsedUs >= this.spec.durationUs;
  }

  rateAt(elapsedUs: bigint): number {
    const { pattern, baseRatePerSecond, durationUs } = this.spec;
    const peak = this.spec.peakRatePerSecond ?? baseRatePerSecond;

    if (elapsedUs >= durationUs) return 0;

    switch (pattern) {
      case 'CONSTANT':
        return baseRatePerSecond;

      case 'RAMP_UP':
        // t=0 -> base, t=duration -> peak. Linear in integer space.
        return interpolate(baseRatePerSecond, peak, elapsedUs, durationUs);

      case 'RAMP_DOWN':
        return interpolate(peak, baseRatePerSecond, elapsedUs, durationUs);

      case 'BURST': {
        const interval = this.spec.intervalUs ?? 10_000_000n;
        const width = this.spec.pulseWidthUs ?? 1_000_000n;
        const phase = interval > 0n ? elapsedUs % interval : 0n;
        return phase < width ? peak : baseRatePerSecond;
      }

      case 'SPIKE': {
        const at = this.spec.intervalUs ?? durationUs / 2n;
        const width = this.spec.pulseWidthUs ?? 1_000_000n;
        return elapsedUs >= at && elapsedUs < at + width ? peak : baseRatePerSecond;
      }

      case 'RANDOM': {
        // Uniform in [base, peak], drawn from the seeded stream — reproducible.
        const span = peak - baseRatePerSecond;
        if (span <= 0) return baseRatePerSecond;
        return baseRatePerSecond + this.stream!.nextIntRange(0, Math.round(span));
      }
    }
  }
}

function interpolate(from: number, to: number, elapsedUs: bigint, durationUs: bigint): number {
  if (durationUs <= 0n) return to;
  // Scale to ppm in integer space, then apply once — avoids accumulating float error.
  const progressPpm = Number((elapsedUs * 1_000_000n) / durationUs);
  const clamped = progressPpm < 0 ? 0 : progressPpm > 1_000_000 ? 1_000_000 : progressPpm;
  return from + ((to - from) * clamped) / 1_000_000;
}
