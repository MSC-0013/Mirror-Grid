/**
 * ChaosSafetyBoundary: Automated Guard Rails for Chaos Engineering
 *
 * Enforces blast-radius caps, leased fault durations, and automated emergency aborts
 * when critical error rates / SLO burn thresholds are breached.
 *
 * ZERO dependencies, ZERO Date.now(), ZERO timers.
 */

export interface SafetyBoundaryConfig {
  readonly maxBlastRadiusPercent: number; // e.g. 30%
  readonly errorRateThresholdPpm: number; // e.g. 500,000 = 50%
  readonly burnDurationThresholdMicros: bigint; // e.g. 30_000_000n = 30s
}

export const DEFAULT_SAFETY_CONFIG: SafetyBoundaryConfig = {
  maxBlastRadiusPercent: 30,
  errorRateThresholdPpm: 500_000,
  burnDurationThresholdMicros: 30_000_000n,
};

export class ChaosSafetyBoundary {
  private readonly config: SafetyBoundaryConfig;
  private burnStartedAtMicros: bigint | null = null;
  private emergencyAbortActive = false;
  private abortReason: string | null = null;

  constructor(config: Partial<SafetyBoundaryConfig> = {}) {
    this.config = { ...DEFAULT_SAFETY_CONFIG, ...config };
  }

  public get isAborted(): boolean {
    return this.emergencyAbortActive;
  }

  public get lastAbortReason(): string | null {
    return this.abortReason;
  }

  /**
   * Evaluates if a proposed or current blast radius is within safe thresholds.
   */
  public checkBlastRadius(
    degradedEdgeCount: number,
    totalEdgeCount: number,
  ): {
    allowed: boolean;
    reason?: string;
    blastRadiusPercent: number;
  } {
    if (totalEdgeCount === 0) {
      return { allowed: true, blastRadiusPercent: 0 };
    }

    const blastRadiusPercent = Math.round((degradedEdgeCount / totalEdgeCount) * 100);

    if (blastRadiusPercent > this.config.maxBlastRadiusPercent) {
      return {
        allowed: false,
        reason: `Blast radius ${blastRadiusPercent}% exceeds safety cap of ${this.config.maxBlastRadiusPercent}%`,
        blastRadiusPercent,
      };
    }

    return { allowed: true, blastRadiusPercent };
  }

  /**
   * Evaluates system safety against current error rates and returns whether an emergency auto-abort
   * must be triggered.
   */
  public evaluateSafety(
    currentErrorRatePpm: number,
    nowMicros: bigint,
  ): {
    safe: boolean;
    abortTriggered: boolean;
    reason?: string;
  } {
    if (this.emergencyAbortActive) {
      return {
        safe: false,
        abortTriggered: true,
        reason: this.abortReason || 'EMERGENCY_ABORT_ACTIVE',
      };
    }

    if (currentErrorRatePpm >= this.config.errorRateThresholdPpm) {
      if (this.burnStartedAtMicros === null) {
        this.burnStartedAtMicros = nowMicros;
      }

      const burnDuration = nowMicros - this.burnStartedAtMicros;
      if (burnDuration >= this.config.burnDurationThresholdMicros) {
        const reason = `CRITICAL_SLO_BURN: Error rate ${currentErrorRatePpm / 10_000}% exceeded threshold for ${burnDuration / 1_000_000n}s`;
        this.triggerEmergencyAbort(reason);
        return {
          safe: false,
          abortTriggered: true,
          reason,
        };
      }
    } else {
      this.burnStartedAtMicros = null;
    }

    return {
      safe: true,
      abortTriggered: false,
    };
  }

  /**
   * Manually or automatically trigger an emergency abort.
   */
  public triggerEmergencyAbort(reason: string): void {
    this.emergencyAbortActive = true;
    this.abortReason = reason;
  }

  /**
   * Reset the emergency abort flag after operator remediation.
   */
  public resetSafety(): void {
    this.emergencyAbortActive = false;
    this.abortReason = null;
    this.burnStartedAtMicros = null;
  }
}
