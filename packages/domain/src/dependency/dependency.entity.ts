export type Criticality = 'REQUIRED' | 'OPTIONAL' | 'BEST_EFFORT';

export const CRITICALITIES: readonly Criticality[] = [
  'REQUIRED',
  'OPTIONAL',
  'BEST_EFFORT',
] as const;

export interface RetryPolicy {
  type: 'EXPONENTIAL' | 'CONSTANT' | 'NONE';
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
  budgetPercent: number;
}

export interface CircuitBreakerPolicy {
  enabled: boolean;
  threshold: number;
  windowMs: number;
  cooldownMs: number;
  halfOpenProbes: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  type: 'EXPONENTIAL',
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 30000,
  jitterFactor: 0.25,
  budgetPercent: 20,
};

export const DEFAULT_CIRCUIT_BREAKER_POLICY: CircuitBreakerPolicy = {
  enabled: true,
  threshold: 5,
  windowMs: 10000,
  cooldownMs: 30000,
  halfOpenProbes: 3,
};

export interface ServiceDependency {
  id: string;
  worldId: string;
  sourceServiceId: string;
  targetServiceId: string;
  timeoutMs: number;
  criticality: Criticality;
  retryPolicy: RetryPolicy;
  circuitBreakerPolicy: CircuitBreakerPolicy;
  createdAt: Date;
  updatedAt: Date;
}
