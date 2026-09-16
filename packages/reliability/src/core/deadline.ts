/**
 * DeadlineContext: Absolute Microsecond Timestamp Propagation
 *
 * Enforces mg-deadline-at headers across RPC and HTTP boundaries.
 * Drops expired or unserviceable requests before invoking downstream work.
 *
 * ZERO dependencies, ZERO Date.now(), ZERO timers.
 */

export const DEADLINE_HEADER = 'mg-deadline-at';

export class DeadlineContext {
  public readonly deadlineAtMicros: bigint;

  constructor(deadlineAtMicros: bigint) {
    this.deadlineAtMicros = deadlineAtMicros;
  }

  public remainingMicros(nowMicros: bigint): bigint {
    return this.deadlineAtMicros - nowMicros;
  }

  public isExpired(nowMicros: bigint): boolean {
    return this.deadlineAtMicros <= nowMicros;
  }

  /**
   * Preemptive shedding: If remaining time is less than expected minimum downstream latency,
   * caller will definitely timeout before receiving response; shed now to save capacity.
   */
  public shouldShedPreemptively(nowMicros: bigint, estimatedLatencyMicros: bigint): boolean {
    const remaining = this.remainingMicros(nowMicros);
    return remaining <= estimatedLatencyMicros;
  }

  public static parse(headerValue: string | string[] | undefined | null): DeadlineContext | null {
    if (!headerValue) return null;
    const str = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (!str) return null;

    try {
      const micros = BigInt(str.trim());
      if (micros <= 0n) return null;
      return new DeadlineContext(micros);
    } catch {
      return null;
    }
  }

  public static format(deadlineAtMicros: bigint): string {
    return deadlineAtMicros.toString();
  }

  public static fromTimeout(nowMicros: bigint, timeoutMicros: bigint): DeadlineContext {
    return new DeadlineContext(nowMicros + timeoutMicros);
  }
}
