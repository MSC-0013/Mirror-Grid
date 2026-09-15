import type { RuntimeMode, RuntimeCapabilities, RuntimeHandle } from './runtime-mode.js';
import type { RetryPolicy, CircuitBreakerPolicy } from '../dependency/dependency.entity.js';
import type { WorkloadPattern } from '../workload/workload.entity.js';

export interface WorkloadHandle {
  readonly id: string;
}

export interface FaultHandle {
  readonly id: string;
}

export interface RuntimeSample {
  readonly serviceId: string;
  readonly virtualTimeUs: bigint;
  readonly wallTimeMs: number;
  readonly requestsCompleted: number;
  readonly requestsFailed: number;
  readonly latencySamplesUs: number[];
  readonly queueDepth: number;
  readonly activeSlots: number;
  readonly circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

export interface ServiceHealth {
  readonly serviceId: string;
  readonly status:
    | 'STARTING'
    | 'HEALTHY'
    | 'DEGRADED'
    | 'PARTIALLY_AVAILABLE'
    | 'UNHEALTHY'
    | 'FAILED';
  readonly instanceStatuses: Array<{
    index: number;
    status: string;
    containerId?: string;
  }>;
}

export interface ServiceSpec {
  readonly id: string;
  readonly name: string;
  readonly concurrencyLimit: number;
  readonly queueCapacity: number;
  readonly config: Record<string, unknown>;
}

export interface DependencySpec {
  readonly sourceId: string;
  readonly targetId: string;
  readonly timeoutMs: number;
  readonly retryPolicy: RetryPolicy;
  readonly circuitBreakerPolicy: CircuitBreakerPolicy;
}

export interface WorldSpec {
  readonly worldId: string;
  readonly services: ServiceSpec[];
  readonly dependencies: DependencySpec[];
  readonly seed: bigint;
}

export interface WorkloadSpec {
  readonly pattern: WorkloadPattern;
  readonly targetServiceId: string;
  readonly baseRate: number;
  readonly peakRate?: number;
  readonly durationMs?: number;
}

export interface FaultSpec {
  readonly faultId: string;
  readonly type: string;
  readonly targetServiceId: string;
  readonly parameters: Record<string, unknown>;
  readonly ttlMs: number;
}

export interface RuntimeAdapter {
  readonly mode: RuntimeMode;
  readonly capabilities: RuntimeCapabilities;

  provision(spec: WorldSpec): Promise<RuntimeHandle>;
  start(handle: RuntimeHandle): Promise<void>;
  applyWorkload(handle: RuntimeHandle, workload: WorkloadSpec): Promise<WorkloadHandle>;
  applyFault(handle: RuntimeHandle, fault: FaultSpec): Promise<FaultHandle>;
  removeFault(handle: RuntimeHandle, fault: FaultHandle): Promise<void>;
  observe(handle: RuntimeHandle): AsyncIterable<RuntimeSample>;
  health(handle: RuntimeHandle): Promise<ServiceHealth[]>;
  teardown(handle: RuntimeHandle): Promise<void>;
}
