/**
 * Frozen Experiment Configuration Generator.
 *
 * Implements the Frozen Configuration Pattern (§105):
 * When an experiment is scheduled or run, its entire world topology,
 * workload, scheduled faults, and anomaly detector rules are deep-snapshotted
 * into an immutable structure. Historical replay executes exclusively
 * against this frozen state.
 */

import crypto from 'node:crypto';
import type { FaultSpec } from '@mirrorgrid/reliability';

export interface DetectorSpec {
  readonly id: string;
  readonly name: string;
  readonly type: 'ERROR_RATE' | 'P99_LATENCY' | 'CIRCUIT_TRIPPED' | 'QUEUE_SATURATION';
  readonly targetServiceId?: string;
  readonly targetEdgeId?: string;
  readonly threshold: number;
  readonly windowMicros: bigint;
}

export interface FrozenServiceSpec {
  readonly id: string;
  readonly name: string;
  readonly concurrencyLimit: number;
  readonly queueCapacity: number;
  readonly serviceTimeTable?: string;
}

export interface FrozenEdgeSpec {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly timeoutMs: number;
  readonly retryPolicy?: Record<string, unknown>;
  readonly circuitBreakerPolicy?: Record<string, unknown>;
}

export interface FrozenWorkloadSpec {
  readonly pattern: string;
  readonly baseRate: number;
  readonly peakRate: number;
  readonly durationMicros: bigint;
}

export interface FrozenScheduleSpec {
  readonly baselineMicros: bigint;
  readonly faultMicros: bigint;
  readonly cooldownMicros: bigint;
}

export interface FrozenExperimentConfig {
  readonly experimentId: string;
  readonly worldId: string;
  readonly name: string;
  readonly hypothesis: string;
  readonly version: number;
  readonly seed: string;
  readonly engineVersion: string;
  readonly topology: {
    readonly services: readonly FrozenServiceSpec[];
    readonly edges: readonly FrozenEdgeSpec[];
  };
  readonly workload: FrozenWorkloadSpec;
  readonly faults: readonly FaultSpec[];
  readonly detectors: readonly DetectorSpec[];
  readonly schedule: FrozenScheduleSpec;
}

export class ExperimentFreezer {
  public static freeze(config: FrozenExperimentConfig): FrozenExperimentConfig {
    // Deep clone with sorted keys to guarantee bit-for-bit repeatability
    const sortedServices = [...config.topology.services].sort((a, b) => a.id.localeCompare(b.id));
    const sortedEdges = [...config.topology.edges].sort((a, b) => a.id.localeCompare(b.id));
    const sortedDetectors = [...config.detectors].sort((a, b) => a.id.localeCompare(b.id));
    const sortedFaults = [...config.faults].sort((a, b) => a.id.localeCompare(b.id));

    return {
      experimentId: config.experimentId,
      worldId: config.worldId,
      name: config.name,
      hypothesis: config.hypothesis,
      version: config.version,
      seed: config.seed,
      engineVersion: config.engineVersion,
      topology: {
        services: sortedServices,
        edges: sortedEdges,
      },
      workload: { ...config.workload },
      faults: sortedFaults,
      detectors: sortedDetectors,
      schedule: { ...config.schedule },
    };
  }

  public static computeHash(config: FrozenExperimentConfig): string {
    const replacer = (_key: string, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value;
    const json = JSON.stringify(config, replacer);
    return crypto.createHash('sha256').update(json).digest('hex');
  }
}
