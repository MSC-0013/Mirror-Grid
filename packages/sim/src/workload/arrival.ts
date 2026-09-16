import type { SubStream } from '../rng/substream.js';
import type { ICDFTable } from '../icdf/loader.js';

/**
 * Poisson arrival process.
 *
 * Inter-arrival times come from an exponential ICDF table rather than `-ln(U)/lambda`,
 * because `Math.log` is not correctly rounded under IEEE-754 and a one-ULP difference
 * between engines would shift an arrival by a microsecond, reorder two heap events and
 * diverge the entire run. The table is integer microseconds; sampling is a lookup.
 */
export class ArrivalScheduler {
  private readonly table: ICDFTable;
  private readonly stream: SubStream;

  constructor(table: ICDFTable, stream: SubStream) {
    this.table = table;
    this.stream = stream;
  }

  /**
   * Next inter-arrival gap in integer microseconds for a target rate.
   *
   * The table is generated for a mean of 1 second; scaling by the requested rate keeps a
   * single table usable at every rate, so changing the rate does not change which table
   * bytes are hashed into engine_version.
   */
  nextGapUs(ratePerSecond: number): bigint {
    if (ratePerSecond <= 0) {
      return 0n;
    }
    const baseGapUs = this.table.sample(this.stream);
    const scaled = Math.max(1, Math.round(baseGapUs / ratePerSecond));
    return BigInt(scaled);
  }

  /** Deterministic count of arrivals in a window — used by burst and spike patterns. */
  arrivalsInWindow(ratePerSecond: number, windowUs: bigint): number {
    if (ratePerSecond <= 0 || windowUs <= 0n) return 0;
    return Math.max(0, Math.round((ratePerSecond * Number(windowUs)) / 1_000_000));
  }
}
