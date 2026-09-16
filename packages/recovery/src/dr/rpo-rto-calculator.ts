/**
 * Disaster Recovery RPO and RTO calculators.
 */

export interface RecoveryObjectives {
  readonly maxRpoMicros: number; // default 2,000,000 (2s)
  readonly maxRtoMs: number;     // default 3,000 (3s)
}

export const DEFAULT_DR_OBJECTIVES: RecoveryObjectives = {
  maxRpoMicros: 2_000_000, // 2.0 seconds
  maxRtoMs: 3_000,         // 3.0 seconds
};

export class RpoRtoCalculator {
  /**
   * Computes Recovery Point Objective (data lag window).
   * RPO = disasterTimestampMicros - latestSnapshotSimTimeMicros.
   */
  static calculateRpo(disasterMicros: number, snapshotMicros: number): number {
    return Math.max(0, disasterMicros - snapshotMicros);
  }

  /**
   * Computes Recovery Time Objective (real elapsed milliseconds).
   */
  static calculateRto(startTimeMs: number, endTimeMs: number): number {
    return Math.max(1, endTimeMs - startTimeMs);
  }

  /**
   * Evaluates compliance against target DR thresholds.
   */
  static evaluateCompliance(
    rpoMicros: number,
    rtoMs: number,
    objectives: RecoveryObjectives = DEFAULT_DR_OBJECTIVES,
  ): { rpoCompliant: boolean; rtoCompliant: boolean; fullyCompliant: boolean } {
    const rpoCompliant = rpoMicros <= objectives.maxRpoMicros;
    const rtoCompliant = rtoMs <= objectives.maxRtoMs;
    return {
      rpoCompliant,
      rtoCompliant,
      fullyCompliant: rpoCompliant && rtoCompliant,
    };
  }
}
