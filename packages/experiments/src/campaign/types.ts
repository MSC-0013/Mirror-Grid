export interface LoadTestConfig {
  readonly targetRps: number;
  readonly totalRequests: number;
  readonly concurrency?: number;
  readonly simulatedLatencyMicros?: number;
}

export interface LatencyProfile {
  readonly minMs: number;
  readonly maxMs: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p90Ms: number;
  readonly p99Ms: number;
}

export interface LoadTestResult {
  readonly totalRequests: number;
  readonly successfulRequests: number;
  readonly failedRequests: number;
  readonly durationMs: number;
  readonly actualRps: number;
  readonly latencies: LatencyProfile;
}

export interface HeapProfileResult {
  readonly initialHeapBytes: number;
  readonly finalHeapBytes: number;
  readonly deltaBytes: number;
  readonly peakHeapBytes: number;
  readonly isLeakDetected: boolean;
  readonly thresholdBytes: number;
}

export type ScenarioCategory =
  | 'LATENCY'
  | 'RESOURCE'
  | 'FAULT'
  | 'RECOVERY'
  | 'SECURITY'
  | 'NETWORKING';

export interface ChaosScenarioResult {
  readonly scenarioNumber: number;
  readonly name: string;
  readonly category: ScenarioCategory;
  readonly durationMs: number;
  readonly requestsOffered: number;
  readonly requestsSuccessful: number;
  readonly availabilityPercentage: number;
  readonly p99Ms: number;
  readonly status: 'PASSED' | 'FAILED';
  readonly details: Record<string, unknown>;
}

export interface CampaignResult {
  readonly campaignId: string;
  readonly worldId: string;
  readonly totalScenarios: number;
  readonly passedScenarios: number;
  readonly failedScenarios: number;
  readonly totalThroughputRps: number;
  readonly p99LatencyMs: number;
  readonly heapDeltaBytes: number;
  readonly status: 'COMPLETED' | 'FAILED';
  readonly scenarios: readonly ChaosScenarioResult[];
}
