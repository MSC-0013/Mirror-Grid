/**
 * Log-linear (DDSketch-style) latency histogram over integer microseconds.
 *
 * gamma = 1.02 gives a guaranteed relative error bound of +/-1% on any quantile.
 *
 * IMPORTANT — what this does and does not give you:
 *   MERGEABLE:  yes. Bucket arrays sum across seconds and services and still yield a
 *               valid quantile. Averaging pre-computed percentiles does not.
 *   EXACT:      NO. Bucket counts locate the rank's bucket but not the sample's position
 *               within it. Quantiles are ESTIMATES with a bounded relative error.
 *
 * For exact quantiles in LOGICAL mode, use the raw samples retained on SecondBucket.
 * Anything derived from this class must be labelled ESTIMATED in the API and UI.
 */
const GAMMA = 1.02;
const BUCKET_COUNT = 512;
const LOG_GAMMA = Math.log(GAMMA);

/**
 * Bucket boundaries are derived once, at module load, from a constant. The resulting
 * Int32Array is the contract — its checksum is folded into engine_version so a change in
 * floating-point behaviour across engines is caught rather than silently changing results.
 */
const BOUNDARIES_US: Int32Array = (() => {
  const b = new Int32Array(BUCKET_COUNT + 1);
  b[0] = 0;
  for (let i = 1; i <= BUCKET_COUNT; i++) {
    b[i] = Math.round(Math.pow(GAMMA, i - 1));
  }
  return b;
})();

export function histogramBoundariesUs(): Int32Array {
  return BOUNDARIES_US;
}

export class LogLinearHistogram {
  private readonly counts: Int32Array;
  private total = 0;
  private minUs = Number.MAX_SAFE_INTEGER;
  private maxUs = 0;

  constructor(counts?: Int32Array) {
    if (counts) {
      if (counts.length !== BUCKET_COUNT) {
        throw new Error(`Histogram must have ${BUCKET_COUNT} buckets, got ${counts.length}`);
      }
      this.counts = Int32Array.from(counts);

      // Recover the observed range from the occupied buckets. Without this a histogram
      // restored from Postgres INT[] would carry maxUs = 0 and clamp every quantile to
      // zero — and restoring from storage is the normal path for archived runs.
      let firstOccupied = -1;
      let lastOccupied = -1;
      for (let i = 0; i < BUCKET_COUNT; i++) {
        const c = this.counts[i];
        if (c > 0) {
          if (firstOccupied === -1) firstOccupied = i;
          lastOccupied = i;
          this.total += c;
        }
      }
      if (firstOccupied !== -1) {
        // Bucket i covers (BOUNDARIES[i], BOUNDARIES[i+1]]. The reconstructed range is the
        // widest interval consistent with the counts — it cannot be narrower than the truth.
        this.minUs = BOUNDARIES_US[firstOccupied];
        this.maxUs = BOUNDARIES_US[lastOccupied + 1];
      }
    } else {
      this.counts = new Int32Array(BUCKET_COUNT);
    }
  }

  get count(): number {
    return this.total;
  }

  static bucketIndexFor(valueUs: number): number {
    if (valueUs <= 0) return 0;
    const idx = Math.ceil(Math.log(valueUs) / LOG_GAMMA);
    if (idx < 0) return 0;
    return idx >= BUCKET_COUNT ? BUCKET_COUNT - 1 : idx;
  }

  add(valueUs: number): void {
    const v = valueUs < 0 ? 0 : Math.trunc(valueUs);
    this.counts[LogLinearHistogram.bucketIndexFor(v)]++;
    this.total++;
    if (v < this.minUs) this.minUs = v;
    if (v > this.maxUs) this.maxUs = v;
  }

  merge(other: LogLinearHistogram): void {
    const otherCounts = other.toArray();
    for (let i = 0; i < BUCKET_COUNT; i++) {
      this.counts[i] += otherCounts[i];
    }
    this.total += other.total;
    if (other.minUs < this.minUs) this.minUs = other.minUs;
    if (other.maxUs > this.maxUs) this.maxUs = other.maxUs;
  }

  /**
   * ESTIMATED quantile. Returns the upper boundary of the bucket containing the rank,
   * which is within a factor of gamma (1%) of the true value.
   */
  quantile(p: number): number {
    if (this.total === 0) return 0;
    if (p <= 0) return this.minUs === Number.MAX_SAFE_INTEGER ? 0 : this.minUs;
    if (p >= 1) return this.maxUs;

    const targetRank = Math.ceil(p * this.total);
    let cumulative = 0;
    for (let i = 0; i < BUCKET_COUNT; i++) {
      cumulative += this.counts[i];
      if (cumulative >= targetRank) {
        const upper = BOUNDARIES_US[i + 1];
        // Never report outside the observed range.
        if (upper > this.maxUs) return this.maxUs;
        return upper;
      }
    }
    return this.maxUs;
  }

  toArray(): Int32Array {
    return Int32Array.from(this.counts);
  }

  /** Plain number[] for JSON/Postgres INT[] round-tripping. */
  toJSON(): number[] {
    return Array.from(this.counts);
  }

  static fromArray(counts: ArrayLike<number>): LogLinearHistogram {
    return new LogLinearHistogram(Int32Array.from(counts));
  }
}
