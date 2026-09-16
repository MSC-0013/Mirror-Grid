/**
 * CircuitBreakerCore: Pure TypeScript State Machine
 *
 * Implements the 3-state Circuit Breaker (CLOSED, OPEN, HALF_OPEN) with a fixed-bucket
 * sliding window failure counter. Evaluated completely deterministically via explicit
 * nowMicros: bigint timestamps.
 *
 * ZERO dependencies, ZERO Date.now(), ZERO timers, ZERO floating-point error rate drift.
 */

import type {
  CircuitState,
  CircuitBreakerConfig,
  CircuitBreakerTransition,
  AdmissionResult,
} from './types.js';

interface Bucket {
  bucketStartMicros: bigint;
  successes: number;
  failures: number;
}

export class CircuitBreakerCore {
  private _state: CircuitState = 'CLOSED';
  private _stateEnteredAtMicros: bigint = 0n;
  private _consecutiveFailures = 0;
  private _consecutiveSuccesses = 0;
  private _activeHalfOpenCalls = 0;

  private readonly buckets: Bucket[] = [];
  private readonly config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig, initialNowMicros = 0n) {
    this.config = config;
    this._stateEnteredAtMicros = initialNowMicros;

    // Initialize fixed window buckets
    for (let i = 0; i < config.windowBucketCount; i++) {
      this.buckets.push({
        bucketStartMicros: 0n,
        successes: 0,
        failures: 0,
      });
    }
  }

  public get state(): CircuitState {
    return this._state;
  }

  public get stateEnteredAtMicros(): bigint {
    return this._stateEnteredAtMicros;
  }

  public get consecutiveFailures(): number {
    return this._consecutiveFailures;
  }

  public get consecutiveSuccesses(): number {
    return this._consecutiveSuccesses;
  }

  public get activeHalfOpenCalls(): number {
    return this._activeHalfOpenCalls;
  }

  /**
   * Parts per million (0 to 1,000,000) failure rate across the active sliding window.
   */
  public get failureRatePpm(): number {
    let totalSuccesses = 0;
    let totalFailures = 0;

    for (const b of this.buckets) {
      totalSuccesses += b.successes;
      totalFailures += b.failures;
    }

    const total = totalSuccesses + totalFailures;
    if (total === 0) return 0;
    return Math.floor((totalFailures * 1_000_000) / total);
  }

  public get totalRequestsInWindow(): number {
    let sum = 0;
    for (const b of this.buckets) {
      sum += b.successes + b.failures;
    }
    return sum;
  }

  /**
   * Evaluates state against current time, potentially transitioning OPEN -> HALF_OPEN.
   */
  public checkState(nowMicros: bigint): CircuitBreakerTransition | null {
    this.pruneBuckets(nowMicros);

    if (this._state === 'OPEN') {
      const elapsed = nowMicros - this._stateEnteredAtMicros;
      if (elapsed >= this.config.sleepWindowMicros) {
        const transition: CircuitBreakerTransition = {
          from: 'OPEN',
          to: 'HALF_OPEN',
          reason: 'SLEEP_WINDOW_EXPIRED',
          atMicros: nowMicros,
          failureRatePpm: this.failureRatePpm,
        };
        this._state = 'HALF_OPEN';
        this._stateEnteredAtMicros = nowMicros;
        this._activeHalfOpenCalls = 0;
        this._consecutiveSuccesses = 0;
        return transition;
      }
    }

    return null;
  }

  /**
   * Try to admit a request through the breaker at time nowMicros.
   */
  public tryAcquire(nowMicros: bigint): AdmissionResult {
    this.checkState(nowMicros);

    if (this._state === 'OPEN') {
      return { allowed: false, reason: 'CIRCUIT_OPEN' };
    }

    if (this._state === 'HALF_OPEN') {
      if (this._activeHalfOpenCalls >= this.config.halfOpenMaxConcurrent) {
        return { allowed: false, reason: 'HALF_OPEN_CONCURRENCY_EXCEEDED' };
      }
      this._activeHalfOpenCalls++;
      return { allowed: true };
    }

    return { allowed: true };
  }

  /**
   * Record a successful request outcome.
   */
  public recordSuccess(nowMicros: bigint): readonly CircuitBreakerTransition[] {
    this.checkState(nowMicros);
    const transitions: CircuitBreakerTransition[] = [];

    const bucket = this.getOrCreateCurrentBucket(nowMicros);
    bucket.successes++;

    this._consecutiveFailures = 0;

    if (this._state === 'HALF_OPEN') {
      if (this._activeHalfOpenCalls > 0) {
        this._activeHalfOpenCalls--;
      }
      this._consecutiveSuccesses++;

      if (this._consecutiveSuccesses >= this.config.consecutiveSuccessThreshold) {
        const t: CircuitBreakerTransition = {
          from: 'HALF_OPEN',
          to: 'CLOSED',
          reason: 'PROBE_SUCCESS',
          atMicros: nowMicros,
          failureRatePpm: this.failureRatePpm,
        };
        this._state = 'CLOSED';
        this._stateEnteredAtMicros = nowMicros;
        this._consecutiveSuccesses = 0;
        this.clearBuckets();
        transitions.push(t);
      }
    }

    return transitions;
  }

  /**
   * Record a failed request outcome.
   */
  public recordFailure(nowMicros: bigint): readonly CircuitBreakerTransition[] {
    this.checkState(nowMicros);
    const transitions: CircuitBreakerTransition[] = [];

    const bucket = this.getOrCreateCurrentBucket(nowMicros);
    bucket.failures++;

    this._consecutiveFailures++;
    this._consecutiveSuccesses = 0;

    if (this._state === 'HALF_OPEN') {
      if (this._activeHalfOpenCalls > 0) {
        this._activeHalfOpenCalls--;
      }
      // Any trial failure in HALF_OPEN trips immediately back to OPEN
      const t: CircuitBreakerTransition = {
        from: 'HALF_OPEN',
        to: 'OPEN',
        reason: 'PROBE_FAILED',
        atMicros: nowMicros,
        failureRatePpm: this.failureRatePpm,
      };
      this._state = 'OPEN';
      this._stateEnteredAtMicros = nowMicros;
      this._activeHalfOpenCalls = 0;
      transitions.push(t);
      return transitions;
    }

    if (this._state === 'CLOSED') {
      const totalRequests = this.totalRequestsInWindow;
      if (totalRequests >= this.config.volumeThreshold) {
        const ratePpm = this.failureRatePpm;
        if (ratePpm >= this.config.failureRateThresholdPpm) {
          const t: CircuitBreakerTransition = {
            from: 'CLOSED',
            to: 'OPEN',
            reason: 'THRESHOLD_EXCEEDED',
            atMicros: nowMicros,
            failureRatePpm: ratePpm,
          };
          this._state = 'OPEN';
          this._stateEnteredAtMicros = nowMicros;
          transitions.push(t);
        }
      }
    }

    return transitions;
  }

  /**
   * Manual override: Force trip to OPEN.
   */
  public trip(nowMicros: bigint, reason = 'MANUAL_OVERRIDE'): CircuitBreakerTransition {
    const prev = this._state;
    this._state = 'OPEN';
    this._stateEnteredAtMicros = nowMicros;
    this._activeHalfOpenCalls = 0;
    return {
      from: prev,
      to: 'OPEN',
      reason,
      atMicros: nowMicros,
      failureRatePpm: this.failureRatePpm,
    };
  }

  /**
   * Manual override: Force reset to CLOSED.
   */
  public reset(nowMicros: bigint): CircuitBreakerTransition {
    const prev = this._state;
    this._state = 'CLOSED';
    this._stateEnteredAtMicros = nowMicros;
    this._activeHalfOpenCalls = 0;
    this._consecutiveFailures = 0;
    this._consecutiveSuccesses = 0;
    this.clearBuckets();
    return {
      from: prev,
      to: 'CLOSED',
      reason: 'MANUAL_RESET',
      atMicros: nowMicros,
      failureRatePpm: 0,
    };
  }

  private getOrCreateCurrentBucket(nowMicros: bigint): Bucket {
    const bucketDuration = this.config.bucketDurationMicros;
    const bucketStart = (nowMicros / bucketDuration) * bucketDuration;

    // Check if we have an existing bucket with this start time
    for (const b of this.buckets) {
      if (b.bucketStartMicros === bucketStart) {
        return b;
      }
    }

    // Find oldest bucket to reuse
    let oldest = this.buckets[0];
    for (let i = 1; i < this.buckets.length; i++) {
      if (this.buckets[i].bucketStartMicros < oldest.bucketStartMicros) {
        oldest = this.buckets[i];
      }
    }

    oldest.bucketStartMicros = bucketStart;
    oldest.successes = 0;
    oldest.failures = 0;
    return oldest;
  }

  private pruneBuckets(nowMicros: bigint): void {
    const windowTotalMicros =
      this.config.bucketDurationMicros * BigInt(this.config.windowBucketCount);
    const minValidMicros = nowMicros > windowTotalMicros ? nowMicros - windowTotalMicros : 0n;

    for (const b of this.buckets) {
      if (b.bucketStartMicros > 0n && b.bucketStartMicros < minValidMicros) {
        b.bucketStartMicros = 0n;
        b.successes = 0;
        b.failures = 0;
      }
    }
  }

  private clearBuckets(): void {
    for (const b of this.buckets) {
      b.bucketStartMicros = 0n;
      b.successes = 0;
      b.failures = 0;
    }
  }
}
