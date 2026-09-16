export interface HistogramPercentiles {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
}

export class HdrHistogram {
  public static readonly DEFAULT_BUCKETS = [
    1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000,
  ];

  public readonly buckets: readonly number[];
  private readonly bucketCounts: number[];
  private count = 0;
  private sum = 0;
  private min = Infinity;
  private max = -Infinity;
  private samples: number[] = [];
  private readonly maxReservoirSize: number;

  constructor(buckets: readonly number[] = HdrHistogram.DEFAULT_BUCKETS, maxReservoir = 10000) {
    this.buckets = [...buckets].sort((a, b) => a - b);
    this.bucketCounts = new Array(this.buckets.length).fill(0);
    this.maxReservoirSize = maxReservoir;
  }

  public record(valueMs: number): void {
    if (valueMs < 0 || !Number.isFinite(valueMs)) return;

    this.count++;
    this.sum += valueMs;
    if (valueMs < this.min) this.min = valueMs;
    if (valueMs > this.max) this.max = valueMs;

    // Increment bucket counts
    for (let i = 0; i < this.buckets.length; i++) {
      if (valueMs <= this.buckets[i]) {
        this.bucketCounts[i]++;
      }
    }

    // Keep reservoir sample for exact percentile validation
    if (this.samples.length < this.maxReservoirSize) {
      this.samples.push(valueMs);
    } else if (Math.random() < this.maxReservoirSize / this.count) {
      const idx = Math.floor(Math.random() * this.maxReservoirSize);
      this.samples[idx] = valueMs;
    }
  }

  public getCount(): number {
    return this.count;
  }

  public getSum(): number {
    return this.sum;
  }

  public getMin(): number {
    return this.count === 0 ? 0 : this.min;
  }

  public getMax(): number {
    return this.count === 0 ? 0 : this.max;
  }

  public getBucketCounts(): { le: number; count: number }[] {
    return this.buckets.map((le, i) => ({
      le,
      count: this.bucketCounts[i],
    }));
  }

  public getPercentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const rank = (p / 100) * (sorted.length - 1);
    const low = Math.floor(rank);
    const high = Math.ceil(rank);
    const weight = rank - low;

    if (low === high) return sorted[low];
    return sorted[low] * (1 - weight) + sorted[high] * weight;
  }

  public getPercentiles(): HistogramPercentiles {
    return {
      p50: Number(this.getPercentile(50).toFixed(2)),
      p90: Number(this.getPercentile(90).toFixed(2)),
      p95: Number(this.getPercentile(95).toFixed(2)),
      p99: Number(this.getPercentile(99).toFixed(2)),
      p999: Number(this.getPercentile(99.9).toFixed(2)),
    };
  }

  public reset(): void {
    this.bucketCounts.fill(0);
    this.count = 0;
    this.sum = 0;
    this.min = Infinity;
    this.max = -Infinity;
    this.samples = [];
  }
}
