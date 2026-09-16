/**
 * Adaptive penalty tracking for rate limiting
 * Penalizes abusive clients (e.g. >= 5 client errors in 30s) by slowing refill 4x.
 */

export interface AdaptiveTrackerConfig {
  errorThreshold?: number; // default 5
  windowMs?: number; // default 30_000 (30s)
  cooldownMs?: number; // default 15 * 60 * 1000 (15 min)
  penaltyMultiplier?: number; // default 4
}

export class AdaptivePenaltyTracker {
  private readonly errorTimestamps = new Map<string, number[]>();
  private readonly penalizedUntil = new Map<string, number>();
  private readonly errorThreshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly penaltyMultiplier: number;

  constructor(config: AdaptiveTrackerConfig = {}) {
    this.errorThreshold = config.errorThreshold ?? 5;
    this.windowMs = config.windowMs ?? 30_000;
    this.cooldownMs = config.cooldownMs ?? 15 * 60 * 1000;
    this.penaltyMultiplier = config.penaltyMultiplier ?? 4;
  }

  public recordClientError(
    key: string,
    nowMs: number = Date.now(),
  ): { penalized: boolean; multiplier: number } {
    const list = this.errorTimestamps.get(key) ?? [];
    const recent = list.filter((t) => nowMs - t <= this.windowMs);
    recent.push(nowMs);
    this.errorTimestamps.set(key, recent);

    if (recent.length >= this.errorThreshold) {
      this.penalizedUntil.set(key, nowMs + this.cooldownMs);
      return { penalized: true, multiplier: this.penaltyMultiplier };
    }

    const isPenalized = (this.penalizedUntil.get(key) ?? 0) > nowMs;
    return {
      penalized: isPenalized,
      multiplier: isPenalized ? this.penaltyMultiplier : 1,
    };
  }

  public recordSuccess(key: string, nowMs: number = Date.now()): void {
    const until = this.penalizedUntil.get(key) ?? 0;
    if (nowMs > until) {
      this.errorTimestamps.delete(key);
    }
  }

  public getPenaltyMultiplier(key: string, nowMs: number = Date.now()): number {
    const until = this.penalizedUntil.get(key) ?? 0;
    if (nowMs < until) {
      return this.penaltyMultiplier;
    }
    if (until > 0) {
      this.penalizedUntil.delete(key);
    }
    return 1;
  }

  public isPenalized(key: string, nowMs: number = Date.now()): boolean {
    return (this.penalizedUntil.get(key) ?? 0) > nowMs;
  }

  public clear(): void {
    this.errorTimestamps.clear();
    this.penalizedUntil.clear();
  }
}
