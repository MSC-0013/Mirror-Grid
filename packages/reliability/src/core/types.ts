/**
 * Core mathematical types and interfaces for reliability primitives.
 * STRICT PURITY: Zero external dependencies, zero global state, zero Date.now().
 */

export interface Clock {
  nowMicros(): bigint;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export type AdmissionResult =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: 'CIRCUIT_OPEN' | 'HALF_OPEN_CONCURRENCY_EXCEEDED';
    };

export interface CircuitBreakerTransition {
  readonly from: CircuitState;
  readonly to: CircuitState;
  readonly reason: string;
  readonly atMicros: bigint;
  readonly failureRatePpm: number;
}

export interface CircuitBreakerConfig {
  readonly failureRateThresholdPpm: number; // e.g. 500,000 = 50%
  readonly volumeThreshold: number; // minimum requests before evaluation
  readonly sleepWindowMicros: bigint; // wait time in OPEN before HALF_OPEN
  readonly halfOpenMaxConcurrent: number; // allowed trial requests in HALF_OPEN
  readonly consecutiveSuccessThreshold: number; // required to re-close circuit
  readonly windowBucketCount: number; // e.g. 10 buckets
  readonly bucketDurationMicros: bigint; // e.g. 1_000_000n (1 second)
}

export interface RetryBudgetConfig {
  readonly ttlMicros: bigint; // rolling window duration
  readonly minRetriesPerSec: number; // baseline minimum allowance
  readonly retryRatio: number; // e.g. 0.10 for max 10% retries
}

export interface RetryPolicyConfig {
  readonly maxAttempts: number; // e.g. 3
  readonly baseBackoffMicros: bigint; // e.g. 50_000n (50ms)
  readonly maxBackoffMicros: bigint; // e.g. 2_000_000n (2s)
  readonly backoffJitter: 'FULL' | 'DECORRELATED' | 'NONE';
  readonly retryableStatusCodes: ReadonlySet<number>; // e.g. [502, 503, 504]
  readonly budget?: RetryBudgetConfig;
}

export type RetryDecision =
  | {
      readonly shouldRetry: false;
      readonly reason: 'MAX_ATTEMPTS' | 'NOT_RETRYABLE' | 'BUDGET_EXHAUSTED' | 'DEADLINE_EXCEEDED';
    }
  | {
      readonly shouldRetry: true;
      readonly backoffMicros: bigint;
    };

export interface BulkheadConfig {
  readonly maxConcurrent: number;
  readonly maxQueueCapacity: number;
  readonly queueTimeoutMicros: bigint;
}

export type BulkheadAdmissionResult =
  | { readonly allowed: true; readonly queued: false; readonly slotId: number }
  | { readonly allowed: true; readonly queued: true; readonly queuePosition: number }
  | { readonly allowed: false; readonly reason: 'BULKHEAD_FULL' | 'QUEUE_TIMEOUT' };

export interface TokenBucketConfig {
  readonly capacity: number;
  readonly refillRatePerSec: number; // integer tokens per second
}
