/**
 * Anomaly Detector Engine.
 *
 * Coordinates sliding-window evaluation of registered detectors,
 * records fault lifecycle transitions, and computes exact MTTD/MTTR telemetry.
 */

import type { DetectorSpec } from '../engine/freeze.js';
import {
  DetectorRuleEvaluator,
  type MetricSample,
  type AnomalyEvaluation,
} from './detector-rules.js';
import { MttdCalculator, type DetectorResult } from './mttd-calculator.js';

export interface DetectorEngine {
  registerDetector(spec: DetectorSpec): void;
  evaluateMetrics(sample: MetricSample): readonly AnomalyEvaluation[];
  onFaultInjected(faultId: string, atMicros: bigint): void;
  onFaultCleared(faultId: string, atMicros: bigint): void;
  computeResults(): DetectorResult;
  getActiveEvaluations(): readonly AnomalyEvaluation[];
}

export class SlidingWindowDetectorEngine implements DetectorEngine {
  private readonly detectors = new Map<string, DetectorSpec>();
  private readonly mttdCalculator: MttdCalculator;
  private lastEvaluations: AnomalyEvaluation[] = [];

  constructor(debounceDurationMicros: bigint = 2_000_000n) {
    this.mttdCalculator = new MttdCalculator(debounceDurationMicros);
  }

  public registerDetector(spec: DetectorSpec): void {
    this.detectors.set(spec.id, spec);
  }

  public onFaultInjected(_faultId: string, atMicros: bigint): void {
    this.mttdCalculator.recordFaultInjected(atMicros);
  }

  public onFaultCleared(_faultId: string, atMicros: bigint): void {
    this.mttdCalculator.recordFaultCleared(atMicros);
  }

  public evaluateMetrics(sample: MetricSample): readonly AnomalyEvaluation[] {
    const results: AnomalyEvaluation[] = [];

    for (const spec of this.detectors.values()) {
      const evaluation = DetectorRuleEvaluator.evaluate(spec, sample);
      results.push(evaluation);
    }

    this.lastEvaluations = results;
    this.mttdCalculator.processEvaluations(sample.nowMicros, results);
    return results;
  }

  public computeResults(): DetectorResult {
    return this.mttdCalculator.computeResults();
  }

  public getActiveEvaluations(): readonly AnomalyEvaluation[] {
    return [...this.lastEvaluations];
  }
}
