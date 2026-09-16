import { z } from 'zod';

export const DomainEventType = {
  CIRCUIT_TRIPPED: 'CIRCUIT_TRIPPED',
  CIRCUIT_RESET: 'CIRCUIT_RESET',
  FAULT_INJECTED: 'FAULT_INJECTED',
  FAULT_REMOVED: 'FAULT_REMOVED',
  PHASE_CHANGED: 'PHASE_CHANGED',
  EXPERIMENT_STARTED: 'EXPERIMENT_STARTED',
  EXPERIMENT_COMPLETED: 'EXPERIMENT_COMPLETED',
  JOB_FAILED: 'JOB_FAILED',
  ANOMALY_DETECTED: 'ANOMALY_DETECTED',
  METRIC_SAMPLED: 'METRIC_SAMPLED',
} as const;

export type DomainEventType = (typeof DomainEventType)[keyof typeof DomainEventType];

export const CircuitTrippedPayloadSchema = z.object({
  edgeId: z.string(),
  state: z.literal('OPEN'),
  failureRatePpm: z.number(),
  reason: z.string().optional(),
});
export type CircuitTrippedPayload = z.infer<typeof CircuitTrippedPayloadSchema>;

export const FaultInjectedPayloadSchema = z.object({
  faultId: z.string(),
  serviceId: z.string().optional(),
  edgeId: z.string().optional(),
  faultType: z.string(),
  parameters: z.record(z.string(), z.unknown()),
});
export type FaultInjectedPayload = z.infer<typeof FaultInjectedPayloadSchema>;

export const ExperimentLifecyclePayloadSchema = z.object({
  experimentId: z.string(),
  status: z.string(),
  virtualTimeMicros: z.number().optional(),
});
export type ExperimentLifecyclePayload = z.infer<typeof ExperimentLifecyclePayloadSchema>;

export const AnomalyDetectedPayloadSchema = z.object({
  detectorId: z.string(),
  metricName: z.string(),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
  value: z.number(),
  threshold: z.number(),
  message: z.string(),
});
export type AnomalyDetectedPayload = z.infer<typeof AnomalyDetectedPayloadSchema>;
