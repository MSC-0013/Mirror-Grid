/**
 * TokenBucketCore: Integer Micro-Token Rate Limiter
 *
 * Implements token bucket algorithm using integer micro-tokens (1 token = 1,000,000 micro-tokens)
 * to avoid floating-point rounding errors and drift over long runtimes.
 *
 * ZERO dependencies, ZERO Date.now(), ZERO timers.
 */

import type { TokenBucketConfig } from './types.js';

export class TokenBucketCore {
  private readonly capacityMicroTokens: bigint;
  private readonly refillRatePerSec: bigint;
  private currentMicroTokens: bigint;
  private lastRefillMicros: bigint;

  constructor(config: TokenBucketConfig, initialNowMicros = 0n) {
    this.capacityMicroTokens = BigInt(config.capacity) * 1_000_000n;
    this.refillRatePerSec = BigInt(config.refillRatePerSec);
    this.currentMicroTokens = this.capacityMicroTokens;
    this.lastRefillMicros = initialNowMicros;
  }

  public get capacity(): number {
    return Number(this.capacityMicroTokens / 1_000_000n);
  }

  public availableTokens(nowMicros: bigint): number {
    this.refill(nowMicros);
    return Number(this.currentMicroTokens / 1_000_000n);
  }

  /**
   * Try to consume a specified number of whole tokens.
   */
  public tryConsume(tokens: number, nowMicros: bigint): boolean {
    this.refill(nowMicros);
    const costMicroTokens = BigInt(tokens) * 1_000_000n;

    if (this.currentMicroTokens >= costMicroTokens) {
      this.currentMicroTokens -= costMicroTokens;
      return true;
    }

    return false;
  }

  private refill(nowMicros: bigint): void {
    if (nowMicros <= this.lastRefillMicros) {
      return;
    }

    const deltaMicros = nowMicros - this.lastRefillMicros;
    // deltaMicros * refillRatePerSec = micro-tokens added!
    const addedMicroTokens = deltaMicros * this.refillRatePerSec;

    this.currentMicroTokens += addedMicroTokens;
    if (this.currentMicroTokens > this.capacityMicroTokens) {
      this.currentMicroTokens = this.capacityMicroTokens;
    }

    this.lastRefillMicros = nowMicros;
  }
}
