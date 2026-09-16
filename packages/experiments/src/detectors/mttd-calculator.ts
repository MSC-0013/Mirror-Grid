/**
 * MTTD (Mean Time to Detect) & MTTR (Mean Time to Recover) Calculator.
 *
 * Implements strict microsecond-precision reliability equations (§104):
 *   MTTD = T_first_detector_trigger - T_fault_injected
 *   MTTR = T_all_detectors_cleared - T_fault_cleared
 *
 * Employs hysteresis debouncing to prevent detector flapping from corrupting MTTR.
 */

export interface DetectorResult {
  readonly mttdMicros: bigint | null;
  readonly mttrMicros: bigint | null;
  readonly faultInjectedAtMicros: bigint | null;
  readonly faultClearedAtMicros: bigint | null;
  readonly firstTriggeredAtMicros: bigint | null;
  readonly allResolvedAtMicros: bigint | null;
  readonly incidentDurationMicros: bigint | null;
  readonly totalTriggers: number;
}

export class MttdCalculator {
  private faultInjectedAtMicros: bigint | null = null;
  private faultClearedAtMicros: bigint | null = null;
  private firstTriggeredAtMicros: bigint | null = null;
  private allResolvedAtMicros: bigint | null = null;
  private candidateResolvedAtMicros: bigint | null = null;
  private totalTriggers = 0;

  constructor(private readonly debounceDurationMicros: bigint = 2_000_000n) {}

  public recordFaultInjected(atMicros: bigint): void {
    if (this.faultInjectedAtMicros === null) {
      this.faultInjectedAtMicros = atMicros;
    }
  }

  public recordFaultCleared(atMicros: bigint): void {
    if (this.faultClearedAtMicros === null) {
      this.faultClearedAtMicros = atMicros;
    }
  }

  public processEvaluations(
    nowMicros: bigint,
    evaluations: readonly { isTriggered: boolean }[],
  ): void {
    const anyTriggered = evaluations.some((e) => e.isTriggered);

    if (anyTriggered) {
      this.totalTriggers++;
      if (this.firstTriggeredAtMicros === null) {
        this.firstTriggeredAtMicros = nowMicros;
      }
      // Reset candidate resolution if an anomaly re-occurs (flapping guard)
      this.candidateResolvedAtMicros = null;
      this.allResolvedAtMicros = null;
    } else {
      // If no detectors are currently triggered and we previously triggered
      if (this.firstTriggeredAtMicros !== null && this.faultClearedAtMicros !== null) {
        if (this.candidateResolvedAtMicros === null) {
          this.candidateResolvedAtMicros = nowMicros;
        } else if (
          this.allResolvedAtMicros === null &&
          nowMicros - this.candidateResolvedAtMicros >= this.debounceDurationMicros
        ) {
          // Hysteresis satisfied: resolved time is when clearing began
          this.allResolvedAtMicros = this.candidateResolvedAtMicros;
        }
      }
    }
  }

  public computeResults(): DetectorResult {
    // If run ended and candidate resolution was active, finalize
    if (this.candidateResolvedAtMicros !== null && this.allResolvedAtMicros === null) {
      this.allResolvedAtMicros = this.candidateResolvedAtMicros;
    }

    const mttdMicros =
      this.firstTriggeredAtMicros !== null && this.faultInjectedAtMicros !== null
        ? this.firstTriggeredAtMicros - this.faultInjectedAtMicros
        : null;

    const mttrMicros =
      this.allResolvedAtMicros !== null && this.faultClearedAtMicros !== null
        ? this.allResolvedAtMicros - this.faultClearedAtMicros
        : null;

    const incidentDurationMicros =
      this.allResolvedAtMicros !== null && this.firstTriggeredAtMicros !== null
        ? this.allResolvedAtMicros - this.firstTriggeredAtMicros
        : null;

    return {
      mttdMicros: mttdMicros !== null && mttdMicros >= 0n ? mttdMicros : 0n,
      mttrMicros: mttrMicros !== null && mttrMicros >= 0n ? mttrMicros : 0n,
      faultInjectedAtMicros: this.faultInjectedAtMicros,
      faultClearedAtMicros: this.faultClearedAtMicros,
      firstTriggeredAtMicros: this.firstTriggeredAtMicros,
      allResolvedAtMicros: this.allResolvedAtMicros,
      incidentDurationMicros,
      totalTriggers: this.totalTriggers,
    };
  }
}
