const MASK_64 = 0xffffffffffffffffn;
const GOLDEN_GAMMA = 0x9e3779b97f4a7c15n;

export interface SubStreamSnapshot {
  readonly name: string;
  readonly initialSeed: string;
  readonly state: string;
  readonly drawCount: number;
}

export class SubStream {
  readonly name: string;
  readonly initialSeed: bigint;
  private state: bigint;
  private draws: number = 0;

  constructor(name: string, seed: bigint) {
    this.name = name;
    this.initialSeed = seed;
    this.state = seed === 0n ? 0x9e3779b97f4a7c15n : seed & MASK_64;
  }

  get drawCount(): number {
    return this.draws;
  }

  /**
   * SplitMix64 core generator.
   */
  nextUint64(): bigint {
    this.draws++;
    this.state = (this.state + GOLDEN_GAMMA) & MASK_64;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
    return (z ^ (z >> 31n)) & MASK_64;
  }

  /**
   * Returns a 32-bit unsigned integer [0, 4294967295].
   */
  nextUint32(): number {
    const val64 = this.nextUint64();
    return Number((val64 >> 32n) & 0xffffffffn);
  }

  /**
   * Returns a float in range [0, 1) deterministically computed as uint32 / 2^32.
   */
  nextFloat01(): number {
    return this.nextUint32() / 4294967296;
  }

  /**
   * Returns an integer in range [min, max] inclusive.
   */
  nextIntRange(min: number, max: number): number {
    if (min >= max) return min;
    const range = max - min + 1;
    const sample = this.nextUint32() % range;
    return min + sample;
  }

  /**
   * Fixed-point Bernoulli trial against parts-per-billion (1 ppb = 10^-9).
   * 1,000,000,000 ppb = 100% probability.
   * Compares integer uint64 without float imprecision.
   */
  bernoulliTrial(thresholdPpb: number): boolean {
    if (thresholdPpb <= 0) return false;
    if (thresholdPpb >= 1_000_000_000) return true;

    // Scale threshold to 32-bit integer space [0, 4294967295]
    // 4294967296 / 1_000_000_000 = 4.294967296
    const thresholdUint = Math.floor((thresholdPpb / 1_000_000_000) * 4294967295);
    return this.nextUint32() < thresholdUint;
  }

  getSnapshot(): SubStreamSnapshot {
    return {
      name: this.name,
      initialSeed: this.initialSeed.toString(16),
      state: this.state.toString(16),
      drawCount: this.draws,
    };
  }

  restoreSnapshot(snapshot: SubStreamSnapshot): void {
    if (snapshot.name !== this.name) {
      throw new Error(`SubStream name mismatch: ${snapshot.name} != ${this.name}`);
    }
    this.state = BigInt('0x' + snapshot.state);
    this.draws = snapshot.drawCount;
  }
}
