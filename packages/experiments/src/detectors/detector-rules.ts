/**
 * Anomaly detector evaluation rules for MIRRORGRID experiments.
 * Evaluates error rates, latency percentiles, breaker states, and queue saturation.
 */

import type { DetectorSpec } from '../engine/freeze.js';

export interface ServiceMetricSnapshot {
  readonly serviceId: string;
  readonly requestsTotal: number;
  readonly requestsFailed: number;
  readonly latencyP50Us: bigint;
  readonly latencyP95Us: bigint;
  readonly latencyP99Us: bigint;
  readonly queueDepth: number;
  readonly queueCapacity: number;
  readonly activeSlots: number;
  readonly concurrencyLimit: number;
  readonly circuitState?: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

export interface MetricSample {
  readonly nowMicros: bigint;
  readonly services: readonly ServiceMetricSnapshot[];
  readonly edgeCircuitBreakers?: ReadonlyMap<string, 'CLOSED' | 'OPEN' | 'HALF_OPEN'>;
}

export interface AnomalyEvaluation {
  readonly detectorId: string;
  readonly detectorName: string;
  readonly type: DetectorSpec['type'];
  readonly isTriggered: boolean;
  readonly currentValue: number;
  readonly threshold: number;
  readonly atMicros: bigint;
  readonly reason: string;
}

export class DetectorRuleEvaluator {
  public static evaluate(spec: DetectorSpec, sample: MetricSample): AnomalyEvaluation {
    const targetService = sample.services.find((s) => s.serviceId === spec.targetServiceId);

    switch (spec.type) {
      case 'ERROR_RATE': {
        if (!targetService || targetService.requestsTotal === 0) {
          return {
            detectorId: spec.id,
            detectorName: spec.name,
            type: spec.type,
            isTriggered: false,
            currentValue: 0,
            threshold: spec.threshold,
            atMicros: sample.nowMicros,
            reason: 'Zero requests observed',
          };
        }
        const errorRatio = targetService.requestsFailed / targetService.requestsTotal;
        const errorPercent = errorRatio * 100;
        const isTriggered = errorPercent >= spec.threshold;
        return {
          detectorId: spec.id,
          detectorName: spec.name,
          type: spec.type,
          isTriggered,
          currentValue: Math.round(errorPercent * 100) / 100,
          threshold: spec.threshold,
          atMicros: sample.nowMicros,
          reason: isTriggered
            ? `Error rate ${errorPercent.toFixed(1)}% >= threshold ${spec.threshold}%`
            : `Error rate ${errorPercent.toFixed(1)}% healthy`,
        };
      }

      case 'P99_LATENCY': {
        if (!targetService) {
          return {
            detectorId: spec.id,
            detectorName: spec.name,
            type: spec.type,
            isTriggered: false,
            currentValue: 0,
            threshold: spec.threshold,
            atMicros: sample.nowMicros,
            reason: 'Target service not found',
          };
        }
        const p99Ms = Number(targetService.latencyP99Us) / 1000;
        const isTriggered = p99Ms >= spec.threshold;
        return {
          detectorId: spec.id,
          detectorName: spec.name,
          type: spec.type,
          isTriggered,
          currentValue: Math.round(p99Ms * 100) / 100,
          threshold: spec.threshold,
          atMicros: sample.nowMicros,
          reason: isTriggered
            ? `P99 latency ${p99Ms.toFixed(1)}ms >= threshold ${spec.threshold}ms`
            : `P99 latency ${p99Ms.toFixed(1)}ms within budget`,
        };
      }

      case 'CIRCUIT_TRIPPED': {
        let state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
        if (spec.targetEdgeId && sample.edgeCircuitBreakers) {
          state = sample.edgeCircuitBreakers.get(spec.targetEdgeId) ?? 'CLOSED';
        } else if (targetService?.circuitState) {
          state = targetService.circuitState;
        }

        const isTriggered = state === 'OPEN';
        return {
          detectorId: spec.id,
          detectorName: spec.name,
          type: spec.type,
          isTriggered,
          currentValue: isTriggered ? 1 : 0,
          threshold: spec.threshold,
          atMicros: sample.nowMicros,
          reason: isTriggered ? 'Circuit breaker is OPEN' : `Circuit breaker is ${state}`,
        };
      }

      case 'QUEUE_SATURATION': {
        if (!targetService || targetService.queueCapacity === 0) {
          return {
            detectorId: spec.id,
            detectorName: spec.name,
            type: spec.type,
            isTriggered: false,
            currentValue: 0,
            threshold: spec.threshold,
            atMicros: sample.nowMicros,
            reason: 'Target queue capacity is zero or service absent',
          };
        }
        const saturationRatio = targetService.queueDepth / targetService.queueCapacity;
        const saturationPercent = saturationRatio * 100;
        const isTriggered = saturationPercent >= spec.threshold;
        return {
          detectorId: spec.id,
          detectorName: spec.name,
          type: spec.type,
          isTriggered,
          currentValue: Math.round(saturationPercent * 100) / 100,
          threshold: spec.threshold,
          atMicros: sample.nowMicros,
          reason: isTriggered
            ? `Queue depth ${targetService.queueDepth}/${targetService.queueCapacity} (${saturationPercent.toFixed(1)}%) >= threshold ${spec.threshold}%`
            : `Queue depth ${targetService.queueDepth}/${targetService.queueCapacity} within limit`,
        };
      }
    }
  }
}
