import { TokenBucketCore } from '@mirrorgrid/reliability/core';
import { AdaptivePenaltyTracker } from './adaptive.js';

export interface RateLimiterOptions {
  capacity: number; // Maximum burst capacity (e.g. 100)
  refillRatePerSec: number; // Refill tokens per second (e.g. 100/60)
  adaptive?: boolean; // Enable adaptive penalty escalation
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  retryAfterSeconds: number;
  penalized: boolean;
}

interface BucketEntry {
  bucket: TokenBucketCore;
  lastUsedMs: number;
  currentMultiplier: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, BucketEntry>();
  private readonly capacity: number;
  private readonly baseRefillRatePerSec: number;
  private readonly adaptiveEnabled: boolean;
  public readonly adaptiveTracker: AdaptivePenaltyTracker;

  constructor(options: RateLimiterOptions) {
    this.capacity = options.capacity;
    this.baseRefillRatePerSec = Math.max(1, options.refillRatePerSec);
    this.adaptiveEnabled = options.adaptive ?? true;
    this.adaptiveTracker = new AdaptivePenaltyTracker();
  }

  public checkLimit(key: string, tokens = 1, nowMs: number = Date.now()): RateLimitResult {
    const nowMicros = BigInt(nowMs) * 1000n;
    const penaltyMultiplier = this.adaptiveEnabled
      ? this.adaptiveTracker.getPenaltyMultiplier(key, nowMs)
      : 1;

    let entry = this.buckets.get(key);
    // If penalty multiplier changed, recreate bucket with adjusted refill rate
    if (!entry || entry.currentMultiplier !== penaltyMultiplier) {
      const effectiveRefillRate = Math.max(
        1,
        Math.floor(this.baseRefillRatePerSec / penaltyMultiplier),
      );
      const bucket = new TokenBucketCore(
        {
          capacity: this.capacity,
          refillRatePerSec: effectiveRefillRate,
        },
        nowMicros,
      );
      entry = {
        bucket,
        lastUsedMs: nowMs,
        currentMultiplier: penaltyMultiplier,
      };
      this.buckets.set(key, entry);
    }

    entry.lastUsedMs = nowMs;
    const allowed = entry.bucket.tryConsume(tokens, nowMicros);
    const remaining = entry.bucket.availableTokens(nowMicros);

    // Calculate reset time: seconds to refill to capacity
    const tokensNeeded = this.capacity - remaining;
    const effectiveRate = Math.max(1, Math.floor(this.baseRefillRatePerSec / penaltyMultiplier));
    const resetSeconds = Math.max(1, Math.ceil(tokensNeeded / effectiveRate));
    const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil(tokens / effectiveRate));

    return {
      allowed,
      limit: this.capacity,
      remaining,
      resetSeconds,
      retryAfterSeconds,
      penalized: penaltyMultiplier > 1,
    };
  }

  public recordClientError(key: string, nowMs: number = Date.now()): void {
    if (this.adaptiveEnabled) {
      this.adaptiveTracker.recordClientError(key, nowMs);
    }
  }

  public recordSuccess(key: string, nowMs: number = Date.now()): void {
    if (this.adaptiveEnabled) {
      this.adaptiveTracker.recordSuccess(key, nowMs);
    }
  }

  public clear(): void {
    this.buckets.clear();
    this.adaptiveTracker.clear();
  }
}
