/**
 * Flagship Scenario Definition: "The Cascading Collapse" (§104)
 *
 * Canonical 4-tier microservice architecture demonstrating:
 *   1. Unprotected Run: Retry amplification (>= 2.5x) and cascading collapse
 *      under dependency latency degradation.
 *   2. Protected Run: Fast-tripping circuit breaker (MTTD <= 3s), Linkerd-style
 *      retry budget (amplification <= 1.15x), and clean recovery (MTTR <= 10s).
 */

import type { FrozenExperimentConfig } from '../engine/freeze.js';
import type { FaultSpec } from '@mirrorgrid/reliability';

export interface FlagshipOptions {
  readonly isProtected: boolean;
  readonly baselineDurationMicros?: bigint;
  readonly faultDurationMicros?: bigint;
  readonly cooldownDurationMicros?: bigint;
  readonly seed?: string;
  readonly worldId?: string;
  readonly experimentId?: string;
}

export function createFlagshipScenario(options: FlagshipOptions): FrozenExperimentConfig {
  const worldId = options.worldId ?? 'world-flagship-01';
  const experimentId =
    options.experimentId ??
    (options.isProtected ? 'exp-flagship-protected' : 'exp-flagship-unprotected');
  const seed = options.seed ?? '42';

  const baselineMicros = options.baselineDurationMicros ?? 30_000_000n; // 30s
  const faultMicros = options.faultDurationMicros ?? 30_000_000n; // 30s
  const cooldownMicros = options.cooldownDurationMicros ?? 15_000_000n; // 15s

  const paymentsLatencyFault: FaultSpec = {
    id: 'fault-payments-latency-400ms',
    worldId,
    name: 'Payments Database Latency Injection',
    faultType: 'LATENCY',
    targetServiceId: 'payments',
    parameters: {
      percentage: 100,
      latencyMicros: 400_000n, // +400ms latency
      jitterMicros: 0n,
      distribution: 'FIXED',
    },
    safetyRules: {
      maxDurationMicros: 60_000_000n,
      autoAbortOnBurnRate: false,
    },
  };

  return {
    experimentId,
    worldId,
    name: options.isProtected
      ? 'Flagship Scenario: Protected Resilience (The Shield)'
      : 'Flagship Scenario: Cascading Collapse (Unprotected)',
    hypothesis: options.isProtected
      ? 'With Circuit Breaker and Retry Budget enabled, +400ms Payments latency is isolated within 3s, retry amplification stays under 1.15x, and system recovers within 10s.'
      : 'Without Circuit Breaker or Retry Budget, +400ms Payments latency saturates Orders queue, triggering retry amplification >= 2.5x and cascading gateway failure.',
    version: 1,
    seed,
    engineVersion: '0.1.0',
    topology: {
      services: [
        {
          id: 'gateway',
          name: 'api-gateway',
          concurrencyLimit: 128,
          queueCapacity: 500,
          serviceTimeTable: 'default_service',
        },
        {
          id: 'orders',
          name: 'orders-service',
          concurrencyLimit: 64,
          queueCapacity: 20,
          serviceTimeTable: 'default_service',
        },
        {
          id: 'payments',
          name: 'payments-service',
          concurrencyLimit: 64,
          queueCapacity: 200,
          serviceTimeTable: 'default_service',
        },
        {
          id: 'database',
          name: 'database-cluster',
          concurrencyLimit: 128,
          queueCapacity: 500,
          serviceTimeTable: 'default_service',
        },
      ],
      edges: [
        {
          id: 'edge-gateway-orders',
          sourceId: 'gateway',
          targetId: 'orders',
          timeoutMs: 3000,
          retryPolicy: options.isProtected
            ? {
                enabled: true,
                maxAttempts: 3,
                budgetPercent: 10, // Max 10% retries permitted
              }
            : {
                enabled: true,
                maxAttempts: 3,
                budgetPercent: 100, // Unlimited retries (3 attempts per failure)
              },
        },
        {
          id: 'edge-orders-payments',
          sourceId: 'orders',
          targetId: 'payments',
          timeoutMs: 300,
          circuitBreakerPolicy: options.isProtected
            ? {
                enabled: true,
                failureRateThresholdPpm: 500_000, // 50%
                minimumRequests: 5,
                sleepWindowMicros: 5_000_000n, // 5s sleep before HALF_OPEN
                halfOpenMaxConcurrent: 2,
              }
            : {
                enabled: false,
              },
        },
        {
          id: 'edge-payments-database',
          sourceId: 'payments',
          targetId: 'database',
          timeoutMs: 2000,
        },
      ],
    },
    workload: {
      pattern: 'CONSTANT',
      baseRate: 200, // 200 RPS
      peakRate: 200,
      durationMicros: baselineMicros + faultMicros + cooldownMicros,
    },
    faults: [paymentsLatencyFault],
    detectors: [
      {
        id: 'det-orders-error-rate',
        name: 'Orders High Error Rate Detector',
        type: 'ERROR_RATE',
        targetServiceId: 'orders',
        threshold: 50, // 50% error rate
        windowMicros: 2_000_000n,
      },
      {
        id: 'det-orders-breaker-tripped',
        name: 'Orders Circuit Breaker Tripped Detector',
        type: 'CIRCUIT_TRIPPED',
        targetEdgeId: 'edge-orders-payments',
        threshold: 1,
        windowMicros: 1_000_000n,
      },
      {
        id: 'det-orders-queue-saturation',
        name: 'Orders Queue Saturation Detector',
        type: 'QUEUE_SATURATION',
        targetServiceId: 'orders',
        threshold: 75, // 75% queue full
        windowMicros: 2_000_000n,
      },
    ],
    schedule: {
      baselineMicros,
      faultMicros,
      cooldownMicros,
    },
  };
}
