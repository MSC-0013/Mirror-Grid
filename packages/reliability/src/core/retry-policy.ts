/**
 * RetryPolicy and RetryBudgetCore: Anti-Storm Resilience
 *
 * Implements Linkerd-style Retry Budgets to prevent cascading retry amplification storms,
 * combined with exponential backoff and jitter algorithms.
 *
 * ZERO dependencies, ZERO Date.now(), ZERO timers.
 */

import type { RetryPolicyConfig, RetryBudgetConfig, RetryDecision } from './types.js';

interface RequestSample {
  readonly timestampMicros: bigint;
  readonly isRetry: boolean;
  readonly isSuccess: boolean;
}

export class RetryBudgetCore {
  private readonly config: RetryBudgetConfig;
  private readonly samples: RequestSample[] = [];

  constructor(config: RetryBudgetConfig) {
    this.config = config;
  }

  public recordSuccess(nowMicros: bigint, isRetry = false): void {
    this.prune(nowMicros);
    this.samples.push({
      timestampMicros: nowMicros,
      isRetry,
      isSuccess: true,
    });
  }

  public recordFailure(nowMicros: bigint, isRetry = false): void {
    this.prune(nowMicros);
    this.samples.push({
      timestampMicros: nowMicros,
      isRetry,
      isSuccess: false,
    });
  }

  public canRetry(nowMicros: bigint): boolean {
    this.prune(nowMicros);

    if (this.samples.length === 0) {
      return true;
    }

    let retryCount = 0;
    let initialCount = 0;

    for (const s of this.samples) {
      if (s.isRetry) {
        retryCount++;
      } else {
        initialCount++;
      }
    }

    // Minimum baseline allowance
    const windowSecs = Number(this.config.ttlMicros) / 1_000_000;
    const minAllowance = Math.ceil(this.config.minRetriesPerSec * Math.max(1, windowSecs));

    if (retryCount < minAllowance && initialCount === 0) {
      return true;
    }

    // Max allowed retries = Math.floor(initialCount * retryRatio)
    const allowedRetries = Math.max(
      minAllowance,
      Math.floor(initialCount * this.config.retryRatio),
    );
    return retryCount < allowedRetries;
  }

  public recordRetry(nowMicros: bigint): void {
    this.prune(nowMicros);
    this.samples.push({
      timestampMicros: nowMicros,
      isRetry: true,
      isSuccess: false,
    });
  }

  private prune(nowMicros: bigint): void {
    const minTime = nowMicros > this.config.ttlMicros ? nowMicros - this.config.ttlMicros : 0n;
    while (this.samples.length > 0 && this.samples[0].timestampMicros < minTime) {
      this.samples.shift();
    }
  }
}

export class RetryPolicyCore {
  private readonly config: RetryPolicyConfig;
  private readonly budgetCore?: RetryBudgetCore;

  constructor(config: RetryPolicyConfig) {
    this.config = config;
    if (config.budget) {
      this.budgetCore = new RetryBudgetCore(config.budget);
    }
  }

  public get budget(): RetryBudgetCore | undefined {
    return this.budgetCore;
  }

  /**
   * Evaluates whether a failed call should be retried, computing backoff and checking budget.
   *
   * @param attempt Current attempt index (1 for first attempt, 2 for second, etc.)
   * @param statusCode HTTP status code or RPC status code
   * @param nowMicros Current time in integer microseconds
   * @param prngUniform Normalized random value [0, 1) from deterministic RNG stream
   * @param deadlineAtMicros Optional absolute deadline timestamp
   */
  public decide(
    attempt: number,
    statusCode: number,
    nowMicros: bigint,
    prngUniform = 0.5,
    deadlineAtMicros?: bigint,
  ): RetryDecision {
    if (attempt >= this.config.maxAttempts) {
      return { shouldRetry: false, reason: 'MAX_ATTEMPTS' };
    }

    if (!this.config.retryableStatusCodes.has(statusCode)) {
      return { shouldRetry: false, reason: 'NOT_RETRYABLE' };
    }

    if (this.budgetCore && !this.budgetCore.canRetry(nowMicros)) {
      return { shouldRetry: false, reason: 'BUDGET_EXHAUSTED' };
    }

    // Exponential Backoff: base * 2^(attempt - 1)
    const factor = 1n << BigInt(Math.max(0, attempt - 1));
    let backoffCap = this.config.baseBackoffMicros * factor;
    if (backoffCap > this.config.maxBackoffMicros) {
      backoffCap = this.config.maxBackoffMicros;
    }

    let finalBackoffMicros = backoffCap;

    if (this.config.backoffJitter === 'FULL') {
      // Full Jitter: Uniform(0, backoffCap)
      const uScaled = BigInt(Math.floor(prngUniform * 1_000_000));
      finalBackoffMicros = (backoffCap * uScaled) / 1_000_000n;
    } else if (this.config.backoffJitter === 'DECORRELATED') {
      // Decorrelated Jitter: Uniform(base, prev * 3)
      const uScaled = BigInt(Math.floor(prngUniform * 1_000_000));
      const range =
        backoffCap > this.config.baseBackoffMicros
          ? backoffCap - this.config.baseBackoffMicros
          : 0n;
      finalBackoffMicros = this.config.baseBackoffMicros + (range * uScaled) / 1_000_000n;
    }

    // Check deadline expiration
    if (deadlineAtMicros !== undefined) {
      const remaining = deadlineAtMicros - nowMicros;
      if (remaining <= finalBackoffMicros) {
        return { shouldRetry: false, reason: 'DEADLINE_EXCEEDED' };
      }
    }

    // Deduct from budget
    if (this.budgetCore) {
      this.budgetCore.recordRetry(nowMicros);
    }

    return {
      shouldRetry: true,
      backoffMicros: finalBackoffMicros,
    };
  }
}
